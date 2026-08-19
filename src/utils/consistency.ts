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

export const checkClassification = (
  value: Classification,
  transaction: Transaction,
  toolCalls: ToolCallRecord[],
): RepairIssue[] => {
  const issues: RepairIssue[] = [];
  const results = successfulResults(toolCalls);
  const anyMatches = results.some((result) => result.match_count > 0);

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
    const recurring = results.some((result) => (result.category_distribution[0]?.count ?? 0) >= 3);
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
  if (value.history_support === 'EXACT_ONE_OFF' && !anyMatches) {
    issues.push(
      issue(
        'history_support',
        'EXACT_ONE_OFF claims a prior transaction, but every search returned zero matches.',
      ),
    );
  }

  // The evidence text claims emptiness the results contradict.
  if (/no prior|ingen tidligere/i.test(value.history_evidence) && anyMatches) {
    issues.push(
      issue(
        'history_evidence',
        'The evidence says there were no prior transactions, but a search returned matches.',
      ),
    );
  }

  // An unambiguous history majority, contradicted without being named.
  const representative = results.reduce<HistorySearchResult | null>(
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
