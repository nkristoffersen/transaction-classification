import { writeFile } from 'node:fs/promises';
import { accountFor } from './category.schema.ts';
import { type Env } from './env.schema.ts';
import {
  AuditFileSchema,
  ResultsFileSchema,
  type AuditFile,
  type Failure,
  type Outcome,
  type ResultRow,
  type ResultsFile,
} from './output.schema.ts';
import { type OwnerQuestionGroup } from './question.schema.ts';
import { formatZodError } from './zod.ts';

/**
 * Assembling and writing the deliverable (`results.json` + `results.csv`)
 * and the audit artifact (`results-raw.json`). Both are zod-parsed before
 * writing — a malformed deliverable should fail the run, not reach a reviewer.
 */

export const buildResultRow = (
  outcome: Outcome,
  questionGroupFor: Map<string, string>,
): ResultRow => ({
  ...outcome.transaction,
  category: outcome.classification.category_code,
  category_name: accountFor(outcome.classification.category_code).name,
  triage: outcome.triage.triage,
  triage_reason: outcome.triage.reason,
  confidence: outcome.classification.confidence,
  reasoning: outcome.classification.reasoning,
  question_group: questionGroupFor.get(outcome.transaction.id) ?? null,
});

export const buildResultsFile = (
  outcomes: Outcome[],
  ownerQuestions: OwnerQuestionGroup[],
  failures: Failure[],
  model: string,
  generatedAt: string,
): ResultsFile => {
  const questionGroupFor = new Map<string, string>();
  for (const group of ownerQuestions) {
    for (const id of group.transaction_ids) {
      questionGroupFor.set(id, group.group_id);
    }
  }

  return {
    generated_at: generatedAt,
    model,
    transactions_classified: outcomes.length,
    results: outcomes.map((outcome) => buildResultRow(outcome, questionGroupFor)),
    owner_questions: ownerQuestions,
    failures,
  };
};

const csvCell = (value: string | number | null): string => {
  const text = value === null ? '' : String(value);
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
};

/** The same rows, flat, for whoever reaches for a spreadsheet first. */
export const renderResultsCsv = (file: ResultsFile): string => {
  const columns = [
    'id',
    'date',
    'amount_nok',
    'counterparty',
    'description',
    'currency',
    'category',
    'triage',
    'confidence',
    'question_group',
    'triage_reason',
  ] as const;
  const header = columns.join(',');
  const rows = file.results.map((row) => columns.map((column) => csvCell(row[column])).join(','));
  return [header, ...rows].join('\n') + '\n';
};

export const writeResultsFile = async (path: string, file: ResultsFile): Promise<void> => {
  const parsed = ResultsFileSchema.safeParse(file);
  if (!parsed.success) {
    throw new Error(
      `results file failed its own schema before writing:\n${formatZodError(parsed.error)}`,
    );
  }
  await writeFile(path, `${JSON.stringify(parsed.data, null, 2)}\n`, 'utf8');
  await writeFile(csvPathFor(path), renderResultsCsv(parsed.data), 'utf8');
};

export const csvPathFor = (outputPath: string): string =>
  outputPath.replace(/\.json$/, '') + '.csv';

/** results.json -> results-raw.json, beside the deliverable it explains. */
export const auditPathFor = (outputPath: string): string =>
  outputPath.replace(/\.json$/, '') + '-raw.json';

export const buildAuditFile = (
  outcomes: Outcome[],
  failures: Failure[],
  env: Env,
  schemaInPrompt: boolean,
  generatedAt: string,
): AuditFile => ({
  generated_at: generatedAt,
  model: env.LLM_MODEL,
  temperature: env.LLM_TEMPERATURE,
  seed: env.LLM_SEED,
  schema_in_prompt: schemaInPrompt,
  outcomes,
  failures,
});

export const writeAuditFile = async (path: string, file: AuditFile): Promise<void> => {
  const parsed = AuditFileSchema.safeParse(file);
  if (!parsed.success) {
    throw new Error(
      `audit file failed its own schema before writing:\n${formatZodError(parsed.error)}`,
    );
  }
  await writeFile(path, `${JSON.stringify(parsed.data, null, 2)}\n`, 'utf8');
};
