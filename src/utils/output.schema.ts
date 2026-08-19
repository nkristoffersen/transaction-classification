import { z } from 'zod';
import { AccountCodeSchema } from './category.schema.ts';
import { ClassificationSchema, ConfidenceSchema } from './classification.schema.ts';
import { OwnerQuestionGroupSchema } from './question.schema.ts';
import { ToolCallRecordSchema } from './tool.schema.ts';
import { TransactionSchema } from './transaction.schema.ts';
import { TriageDecisionSchema, TriageSchema } from './triage.schema.ts';
import { RepairIssueSchema } from './zod.schema.ts';

/**
 * The output boundary: the deliverable, the audit artifact, and the
 * per-transaction pipeline outcome they are both built from. Everything here
 * is parsed before it is written — the last zod boundary in the pipeline,
 * catching a malformed deliverable before it reaches disk.
 */

/** One transaction's full pipeline outcome. The audit's unit of record. */
export const OutcomeSchema = z.strictObject({
  transaction: TransactionSchema,
  classification: ClassificationSchema,
  triage: TriageDecisionSchema,
  tool_calls: z.array(ToolCallRecordSchema),
  repair_attempts: z.number().int().min(0),
  tool_call_missing: z.boolean(),
  unresolved_issues: z.array(RepairIssueSchema),
  tokens_in: z.number().int().min(0),
  tokens_out: z.number().int().min(0),
  duration_ms: z.number().min(0),
});
export type Outcome = z.infer<typeof OutcomeSchema>;

/** One row of results.json — the transaction plus what the system decided. */
export const ResultRowSchema = TransactionSchema.extend({
  category: AccountCodeSchema,
  category_name: z.string().min(1),
  triage: TriageSchema,
  triage_reason: z.string().min(1),
  confidence: ConfidenceSchema,
  reasoning: z.string().min(1),
  /** The owner-question group covering this row, when triage asks the owner. */
  question_group: z.string().nullable(),
});
export type ResultRow = z.infer<typeof ResultRowSchema>;

export const FailureSchema = z.strictObject({
  transaction_id: z.string().min(1),
  attempts: z.number().int().min(0),
  error: z.string().min(1),
  unresolved_issues: z.array(z.string()),
});
export type Failure = z.infer<typeof FailureSchema>;

export const ResultsFileSchema = z.strictObject({
  generated_at: z.iso.datetime(),
  model: z.string().min(1),
  transactions_classified: z.number().int().min(0),
  results: z.array(ResultRowSchema),
  owner_questions: z.array(OwnerQuestionGroupSchema),
  failures: z.array(FailureSchema),
});
export type ResultsFile = z.infer<typeof ResultsFileSchema>;

/**
 * The audit artifact, written beside the deliverable on every run. Enough
 * content is dropped between classification and deliverable — the signals,
 * the tool transcripts, the repair history — that the deliverable alone
 * cannot audit the classification; this file can. Gitignored, diffed between
 * runs, read by nothing.
 */
export const AuditFileSchema = z.strictObject({
  generated_at: z.iso.datetime(),
  model: z.string().min(1),
  temperature: z.number(),
  seed: z.number().int().nullable(),
  schema_in_prompt: z.boolean(),
  outcomes: z.array(OutcomeSchema),
  failures: z.array(FailureSchema),
});
export type AuditFile = z.infer<typeof AuditFileSchema>;
