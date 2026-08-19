import { z } from 'zod';
import { AccountCodeSchema } from './category.schema.ts';
import { ConfidenceSchema } from './classification.schema.ts';
import { OwnerQuestionGroupSchema } from './question.schema.ts';
import { TransactionSchema } from './transaction.schema.ts';
import { TriageSchema } from './triage.schema.ts';

/**
 * The measurement boundary: the gold set and the report.
 *
 * Gold rows are tagged by source so hand-written labels cannot flatter the
 * system — every rate in the report splits by `provided` (shipped with the
 * exercise, kept verbatim), `added` (labelled here), and `synthetic`
 * (adversarial rows that are not in transactions.csv and carry their own
 * transaction data).
 */

export const GoldSourceSchema = z.enum(['provided', 'added', 'synthetic']);

export const GoldRowSchema = z.strictObject({
  transaction_id: z.string().min(1),
  expected_category: AccountCodeSchema,
  expected_triage: TriageSchema,
  reasoning: z.string().min(1),
  source: GoldSourceSchema,
  /** True where the right answer is genuinely arguable — a divergence on a
   * contested row is a data point, not a defect. */
  contested: z.boolean(),
  /** Synthetic rows only: the transaction itself, since it is not in the CSV. */
  transaction: TransactionSchema.optional(),
});
export type GoldRow = z.infer<typeof GoldRowSchema>;

export const GoldFileSchema = z.strictObject({
  description: z.string().min(1),
  rows: z.array(GoldRowSchema).min(1),
});
export type GoldFile = z.infer<typeof GoldFileSchema>;

/** report.json — the run's evidence, typed. report.md renders the same data. */
export const ReportSchema = z.strictObject({
  generated_at: z.iso.datetime(),
  model: z.string().min(1),
  transactions_classified: z.number().int().min(0),
  failures: z.number().int().min(0),

  /**
   * The headline is deliberately not accuracy. A wrong auto-approve posts a
   * bad row silently; a wrong escalation wastes minutes. These are not the
   * same failure, so the headline is the precision of the auto-approve set
   * and the misses are listed individually, never collapsed to a rate.
   */
  headline: z.strictObject({
    automation_rate: z.number().min(0).max(1),
    auto_approve_precision: z.number().min(0).max(1).nullable(),
    dangerous_misses: z.array(
      z.strictObject({
        transaction_id: z.string().min(1),
        system_category: AccountCodeSchema,
        gold_category: AccountCodeSchema,
        gold_triage: TriageSchema,
        gold_reasoning: z.string(),
        contested: z.boolean(),
      }),
    ),
  }),

  triage_matrix: z.array(
    z.strictObject({
      gold: TriageSchema,
      system: TriageSchema,
      count: z.number().int().min(1),
      /** What this cell costs: silent error, wasted owner time, harmless caution. */
      cost: z.enum(['agreement', 'silent-error', 'wasted-owner-time', 'harmless-caution']),
    }),
  ),

  category: z.strictObject({
    accuracy_overall: z.number().min(0).max(1).nullable(),
    by_source: z.array(
      z.strictObject({
        source: GoldSourceSchema,
        rows: z.number().int().min(0),
        category_accuracy: z.number().min(0).max(1).nullable(),
        triage_accuracy: z.number().min(0).max(1).nullable(),
      }),
    ),
    confusion_pairs: z.array(
      z.strictObject({
        gold: AccountCodeSchema,
        system: AccountCodeSchema,
        count: z.number().int().min(1),
        contested_only: z.boolean(),
      }),
    ),
  }),

  confidence_calibration: z.array(
    z.strictObject({
      confidence: ConfidenceSchema,
      rows: z.number().int().min(0),
      category_accuracy: z.number().min(0).max(1).nullable(),
    }),
  ),

  questions: z.strictObject({
    owner_question_rows: z.number().int().min(0),
    groups: z.number().int().min(0),
    fallback_groups: z.number().int().min(0),
    drafted: z.array(OwnerQuestionGroupSchema),
  }),

  tool_health: z.strictObject({
    calls_total: z.number().int().min(0),
    calls_per_transaction: z.number().min(0),
    injected_lookups: z.number().int().min(0),
    repair_round_counts: z.array(
      z.strictObject({ rounds: z.number().int().min(0), transactions: z.number().int().min(1) }),
    ),
    unresolved_after_budget: z.number().int().min(0),
  }),

  cost_latency: z.strictObject({
    tokens_in: z.number().int().min(0),
    tokens_out: z.number().int().min(0),
    /** Set when EVAL_PRICE_IN / EVAL_PRICE_OUT (USD per 1M tokens) are given. */
    estimated_cost_usd: z.number().min(0).nullable(),
    latency_p50_ms: z.number().min(0),
    latency_p95_ms: z.number().min(0),
  }),

  /** Present when EVAL_REPEAT=2 re-ran the batch to measure agreement. */
  determinism: z
    .strictObject({
      runs: z.number().int().min(2),
      category_agreement: z.number().min(0).max(1),
      triage_agreement: z.number().min(0).max(1),
    })
    .nullable(),
});
export type Report = z.infer<typeof ReportSchema>;
