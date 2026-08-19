import { type ClassifierClient } from './llm.ts';
import {
  QuestionsResponseSchema,
  type OwnerQuestionGroup,
  type QuestionsResponse,
} from './question.schema.ts';
import { normaliseCounterparty, isCashWithdrawal } from './transaction.ts';
import { type Transaction } from './transaction.schema.ts';
import { prose } from './text.ts';
import { type RepairIssue } from './zod.schema.ts';

/**
 * Question grouping: code proposes, the model partitions and drafts, code
 * validates. The same person is not asked three separate questions when one
 * will do — three Vipps payments to the same name are one question.
 */

/** Candidate groups by kind, as a hint to the model. Cash sticks together. */
export const proposeCandidateGroups = (rows: Transaction[]): Map<string, Transaction[]> => {
  const groups = new Map<string, Transaction[]>();
  for (const row of rows) {
    const key = isCashWithdrawal(row)
      ? 'cash-withdrawals'
      : normaliseCounterparty(row.counterparty);
    const bucket = groups.get(key);
    if (bucket === undefined) {
      groups.set(key, [row]);
    } else {
      bucket.push(row);
    }
  }
  return groups;
};

export const QUESTION_SYSTEM_MESSAGE = prose`
  You draft questions from an accountant to a Norwegian business owner about bank transactions
  that cannot be categorized without the owner's answer. You group transactions so the owner is
  asked as few questions as possible, and you write in polite, concrete Norwegian bokmål.
`;

export const buildQuestionUserMessage = (
  rows: Transaction[],
  candidates: Map<string, Transaction[]>,
  renderedSchema: string | null,
): string => {
  const facts = rows
    .map(
      (row) =>
        `${row.id}: ${row.date} | ${row.amount_nok} NOK | ${row.counterparty} | ${row.description}`,
    )
    .join('\n');

  const hint = [...candidates.entries()]
    .map(([key, group]) => `${key}: ${group.map((row) => row.id).join(', ')}`)
    .join('\n');

  const instruction = prose`
    Partition ALL of these transactions into groups where one question covers the whole group, and
    draft that question in Norwegian. Every transaction id must appear in exactly one group. The
    candidate grouping below is a hint by counterparty — merge or split it where that serves the
    owner better (for example, rows that share one errand). Name each group's amounts and dates or
    counterparties in its question. Return a single JSON object matching the schema.
  `;

  const schemaBlock =
    renderedSchema === null ? '' : `\n\nThe answer must match this JSON Schema:\n${renderedSchema}`;

  return (
    `Transactions needing an owner question:\n\n${facts}\n\n` +
    `Candidate groups (hint):\n${hint}\n\n${instruction}${schemaBlock}`
  );
};

const NORWEGIAN_MONTHS = [
  'januar',
  'februar',
  'mars',
  'april',
  'mai',
  'juni',
  'juli',
  'august',
  'september',
  'oktober',
  'november',
  'desember',
];

/**
 * English function words that should not survive into a Norwegian question.
 * Whole words only — "og" inside "dialog" is not a hit, and shared words like
 * "under" are deliberately absent.
 */
const ENGLISH_STOPWORDS = /\b(the|and|this|that|please|what|which|was|were|with|for|from|your)\b/i;

/** Formats an amount the ways a question might legitimately write it. */
const amountVariants = (amount: number): string[] => {
  const whole = String(Math.trunc(Math.abs(amount)));
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return [whole, grouped];
};

/**
 * The partition and language checks. Both feed the repair loop; the failure
 * mode being guarded is a transaction silently dropped from the questions —
 * which reads as handled and is not.
 */
export const validateQuestions = (
  response: QuestionsResponse,
  expected: Transaction[],
): RepairIssue[] => {
  const issues: RepairIssue[] = [];
  const byId = new Map(expected.map((row) => [row.id, row]));

  // Exactly a partition: every id once, nothing invented.
  const seen = new Map<string, number>();
  for (const group of response.groups) {
    for (const id of group.transaction_ids) {
      seen.set(id, (seen.get(id) ?? 0) + 1);
    }
  }
  const missing = expected.filter((row) => !seen.has(row.id)).map((row) => row.id);
  const duplicated = [...seen.entries()].filter(([, count]) => count > 1).map(([id]) => id);
  const invented = [...seen.keys()].filter((id) => !byId.has(id));

  if (missing.length > 0) {
    issues.push({
      path: 'groups',
      message: `These transactions are missing from every group: ${missing.join(', ')}. Every listed transaction needs a question.`,
      source: 'consistency',
    });
  }
  if (duplicated.length > 0) {
    issues.push({
      path: 'groups',
      message: `These transactions appear in more than one group: ${duplicated.join(', ')}.`,
      source: 'consistency',
    });
  }
  if (invented.length > 0) {
    issues.push({
      path: 'groups',
      message: `These ids are not in the input: ${invented.join(', ')}.`,
      source: 'consistency',
    });
  }

  // The Norwegian, per group.
  response.groups.forEach((group, index) => {
    const path = `groups.${index}.question_norwegian`;
    const question = group.question_norwegian.trim();
    const members = group.transaction_ids
      .map((id) => byId.get(id))
      .filter((row): row is Transaction => row !== undefined);

    if (!question.endsWith('?')) {
      issues.push({
        path,
        message: 'The question must end with a question mark.',
        source: 'consistency',
      });
    }
    if (question.length < 40 || question.length > 400) {
      issues.push({
        path,
        message: `The question is ${question.length} characters; keep it between 40 and 400.`,
        source: 'consistency',
      });
    }
    const stopword = ENGLISH_STOPWORDS.exec(question);
    if (stopword !== null) {
      issues.push({
        path,
        message: `"${stopword[0]}" is English — the question must be entirely in Norwegian.`,
        source: 'consistency',
      });
    }
    if (members.length > 0) {
      const mentionsAmount = members.some((row) =>
        amountVariants(row.amount_nok).some((variant) => question.includes(variant)),
      );
      if (!mentionsAmount) {
        issues.push({
          path,
          message: prose`
            The question names none of the group's amounts. Name at least one amount so the owner
            knows which payments are meant.
          `,
          source: 'consistency',
        });
      }
      const mentionsAnchor =
        NORWEGIAN_MONTHS.some((month) => question.toLowerCase().includes(month)) ||
        members.some((row) =>
          normaliseCounterparty(row.counterparty)
            .split(' ')
            .filter((token) => token.length > 3)
            .some((token) => question.toLowerCase().includes(token)),
        );
      if (!mentionsAnchor) {
        issues.push({
          path,
          message: prose`
            The question mentions neither a date nor a counterparty. Anchor it with one, so the
            owner can find the payment.
          `,
          source: 'consistency',
        });
      }
    }
  });

  return issues;
};

const NORWEGIAN_MONTH_OF = (isoDate: string): string => {
  const index = Number(isoDate.slice(5, 7)) - 1;
  return NORWEGIAN_MONTHS[index] ?? isoDate;
};

const formatAmount = (amount: number): string =>
  String(Math.trunc(Math.abs(amount))).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');

/**
 * A deterministic, code-authored question for a group the model could not
 * cover. States only facts from the bank data, so nothing is invented; it is
 * duller than a drafted question, and that is the acceptable cost of
 * guaranteeing every owner-question row actually carries a question.
 */
export const buildFallbackQuestion = (rows: Transaction[]): string => {
  const listed = rows
    .map(
      (row) =>
        `${formatAmount(row.amount_nok)} kr til ${row.counterparty} den ` +
        `${Number(row.date.slice(8, 10))}. ${NORWEGIAN_MONTH_OF(row.date)}`,
    )
    .join(', ');
  return `Hei! Kan du fortelle oss hva ${rows.length === 1 ? 'betalingen' : 'betalingene'} på ${listed} gjaldt?`;
};

/**
 * The batch post-pass: one model call proposes the partition and drafts the
 * Norwegian; code validates both through the same repair loop. Coverage is
 * repaired in code afterwards — any row the model's partition still misses
 * gets a fallback question, because a dropped transaction reads as handled
 * and is not. Fallback groups are visible by their `q-fallback-` prefix.
 */
export const draftOwnerQuestions = async (
  client: ClassifierClient,
  rows: Transaction[],
  signal?: AbortSignal,
): Promise<OwnerQuestionGroup[]> => {
  if (rows.length === 0) return [];

  const candidates = proposeCandidateGroups(rows);
  const byId = new Map(rows.map((row) => [row.id, row]));

  let drafted: QuestionsResponse['groups'];
  try {
    const result = await client.generateStructured<QuestionsResponse>(
      {
        schema: QuestionsResponseSchema,
        schemaName: 'owner_questions',
        system: QUESTION_SYSTEM_MESSAGE,
        user: buildQuestionUserMessage(
          rows,
          candidates,
          client.renderedSchemaFor(QuestionsResponseSchema, 'owner_questions'),
        ),
        tools: [],
        crossCheck: (value) => validateQuestions(value, rows),
        label: 'owner-questions',
      },
      signal,
    );
    // Groups referencing only real ids survive, even from a disputed response.
    drafted = result.value.groups.filter((group) =>
      group.transaction_ids.every((id) => byId.has(id)),
    );
  } catch {
    // Structural failure after the budget: every row falls back below.
    drafted = [];
  }

  const groups: OwnerQuestionGroup[] = drafted.map((group, index) => ({
    group_id: `q-${String(index + 1).padStart(3, '0')}`,
    transaction_ids: [...new Set(group.transaction_ids)],
    question_norwegian: group.question_norwegian,
  }));

  // Coverage repair: whatever the partition missed gets the code-authored
  // question, grouped by the same candidate key the model was hinted with.
  const covered = new Set(groups.flatMap((group) => group.transaction_ids));
  const uncovered = rows.filter((row) => !covered.has(row.id));
  if (uncovered.length > 0) {
    let fallbackIndex = 0;
    for (const [, members] of proposeCandidateGroups(uncovered)) {
      fallbackIndex++;
      groups.push({
        group_id: `q-fallback-${String(fallbackIndex).padStart(3, '0')}`,
        transaction_ids: members.map((row) => row.id),
        question_norwegian: buildFallbackQuestion(members),
      });
    }
  }

  return groups;
};
