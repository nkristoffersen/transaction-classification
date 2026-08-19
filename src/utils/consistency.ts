import { accountFor } from './category.schema.ts';
import { type Classification } from './classification.schema.ts';
import { type HistorySearchResult } from './history.schema.ts';
import { type ToolCallRecord } from './tool.schema.ts';
import { type Transaction } from './transaction.schema.ts';
import { prose } from './text.ts';
import { type RepairIssue } from './zod.schema.ts';

/**
 * Consistency cross-checks: schema-valid but wrong.
 *
 * This is the case plain validation cannot reach, and the reason the signal
 * drivers are enums rather than prose — code can check claims against the
 * tool results and the transaction itself. Each finding feeds the same repair
 * loop as a schema fault, distinguished by `source: 'consistency'`.
 *
 * Where a check has two honest ways out, the message names both rather than
 * dictating one: a history majority against the chosen category might mean
 * the category is wrong, or that this row genuinely departs from the pattern
 * — in which case the reasoning has to say so.
 */

const issue = (path: string, message: string): RepairIssue => ({
  path,
  message,
  source: 'consistency',
});

/** The successful search results this conversation produced. */
const successfulResults = (toolCalls: ToolCallRecord[]): HistorySearchResult[] =>
  toolCalls.flatMap((record) => (record.result === null ? [] : [record.result]));

/**
 * Only exact and containment matches are THIS counterparty's own history.
 * A token-overlap match (a shared surname, a shared "Norge") must never bind
 * a cross-check: a measured run rejected a correct `uncertain` on a Vipps row
 * for three repair rounds because "VIPPS LARS HANSEN" fuzzy-matched INGRID
 * HANSEN's six salary rows. The model held its ground; the check was wrong.
 */
const isOwnHistory = (result: HistorySearchResult): boolean =>
  result.match_quality === 'exact' || result.match_quality === 'contains';

export const checkClassification = (
  value: Classification,
  transaction: Transaction,
  toolCalls: ToolCallRecord[],
): RepairIssue[] => {
  const issues: RepairIssue[] = [];
  const results = successfulResults(toolCalls);
  const ownResults = results.filter(isOwnHistory);
  const anyOwnMatches = ownResults.some((result) => result.match_count > 0);

  // Defence in depth: the llm loop demands a tool call, but an answer that
  // somehow arrives without one is still not acceptable evidence.
  if (toolCalls.length === 0) {
    issues.push(
      issue(
        'history_evidence',
        'No search_history call was made. The history must be consulted before classifying.',
      ),
    );
  }

  // Claimed support the tool results do not carry.
  if (value.history_support === 'EXACT_RECURRING') {
    const recurring = ownResults.some(
      (result) => (result.category_distribution[0]?.count ?? 0) >= 3,
    );
    if (!recurring) {
      issues.push(
        issue(
          'history_support',
          prose`
            EXACT_RECURRING requires a search result showing at least three prior transactions in
            one category for this counterparty, and none of your searches returned that. Either
            search again more precisely or downgrade the support level.
          `,
        ),
      );
    }
  }
  if (value.history_support === 'EXACT_ONE_OFF' && !anyOwnMatches) {
    issues.push(
      issue(
        'history_support',
        'EXACT_ONE_OFF claims a prior transaction, but every search returned zero matches.',
      ),
    );
  }

  // The evidence text claims emptiness the results contradict. Fuzzy-tier
  // matches do not contradict it: "no prior transactions" is a fair statement
  // when only similarly named counterparties matched.
  if (/no prior|ingen tidligere/i.test(value.history_evidence) && anyOwnMatches) {
    issues.push(
      issue(
        'history_evidence',
        'The evidence says there were no prior transactions, but a search returned matches.',
      ),
    );
  }

  // An unambiguous history majority, contradicted without being named. Only
  // this counterparty's own history can constitute a majority.
  const representative = ownResults.reduce<HistorySearchResult | null>(
    (best, result) => (result.match_count > (best?.match_count ?? 0) ? result : best),
    null,
  );
  if (representative !== null && representative.match_count >= 3) {
    const top = representative.category_distribution[0];
    if (
      top !== undefined &&
      top.count / representative.match_count >= 0.8 &&
      top.category !== value.category_code &&
      !value.reasoning.toLowerCase().includes(top.category)
    ) {
      issues.push(
        issue(
          'category_code',
          prose`
            History categorizes this counterparty as ${top.category} in ${top.count} of
            ${representative.match_count} prior transactions, and you chose
            ${value.category_code} without addressing that. Either follow the history, or state
            in the reasoning why this transaction departs from it — naming ${top.category}.
          `,
        ),
      );
    }
  }

  // Sign contradiction against the account's direction.
  const account = accountFor(value.category_code);
  if (account.sign === 'money_out' && transaction.amount_nok > 0) {
    issues.push(
      issue(
        'category_code',
        prose`
          ${value.category_code} is money out of the business, but this amount is positive
          (money in). A positive amount cannot be this account.
        `,
      ),
    );
  }
  if (account.sign === 'money_in' && transaction.amount_nok < 0) {
    issues.push(
      issue(
        'category_code',
        prose`
          ${value.category_code} is money into the business, but this amount is negative
          (money out). A negative amount cannot be this account.
        `,
      ),
    );
  }

  // The description cue decides between salary and owner draw — the guidance
  // states it, and code makes it binding. Measured: "OVERFØRING KARI NORDMANN
  // / Privat" auto-approved as salary because her six Lønn rows matched on
  // the name; the description said otherwise the whole time.
  if (value.category_code === 'salary' && /\bprivat\b/i.test(transaction.description)) {
    issues.push(
      issue(
        'category_code',
        prose`
          The description says Privat, and Privat is owner_draw even when the person is on
          payroll — Lønn is what marks a salary. Reclassify or state why this Privat transfer is
          nonetheless salary.
        `,
      ),
    );
  }
  if (value.category_code === 'owner_draw' && /\bl\u00f8nn\b/i.test(transaction.description)) {
    issues.push(
      issue(
        'category_code',
        prose`
          The description says L\u00f8nn, and L\u00f8nn is salary even when paid to the owner — Privat is
          what marks an owner draw. Reclassify or state why this L\u00f8nn payment is nonetheless a
          draw.
        `,
      ),
    );
  }

  // Choosing a specific account is itself the claim that the purpose WAS
  // inferable from bank data — UNKNOWABLE_FROM_BANK_DATA belongs to rows
  // whose account only the owner can name, which is what `uncertain` is for.
  // Measured: seven rows (Netflix among them) paired a confident category
  // with UNKNOWABLE and were routed to the owner an accountant never needed.
  if (
    value.purpose_clarity === 'UNKNOWABLE_FROM_BANK_DATA' &&
    value.category_code !== 'uncertain'
  ) {
    issues.push(
      issue(
        'purpose_clarity',
        prose`
          You chose ${value.category_code}, which means the purpose was inferable from the bank
          data after all. UNKNOWABLE_FROM_BANK_DATA is only for rows where no category can be
          chosen without the owner. Either downgrade the clarity (AMBIGUOUS_BETWEEN_ACCOUNTS or
          better), or change the category to uncertain.
        `,
      ),
    );
  }

  // The chart of accounts pairs uncertain with asking the owner; a confident
  // uncertainty is a contradiction in terms.
  if (value.category_code === 'uncertain' && value.confidence === 'HIGH') {
    issues.push(
      issue(
        'confidence',
        'Category uncertain cannot carry HIGH confidence — if the category is uncertain, so is the classification.',
      ),
    );
  }

  return issues;
};
