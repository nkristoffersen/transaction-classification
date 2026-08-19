import { z } from 'zod';
import { ClassificationSchema } from './classification.schema.ts';
import { TransactionSchema } from './transaction.schema.ts';

/**
 * The triage boundary. The three values are fixed by the brief — not a
 * guidance table — so this enum is written once, here, and reused by the
 * pipeline, the eval and the tests. Never re-type these strings.
 */
export const TriageSchema = z.enum(['auto-approve', 'accountant-review', 'owner-question']);
export type Triage = z.infer<typeof TriageSchema>;

/** Everything the code-owned derivation reads. The model appears only via its classification. */
export const TriageInputsSchema = z.strictObject({
  classification: ClassificationSchema,
  transaction: TransactionSchema,
  /** Code executed the history lookup because the model would not. */
  tool_call_missing: z.boolean(),
  /**
   * |amount| exceeds twice the largest amount this counterparty's own history
   * carries — computed in code from the exact-tier tool results. A recurring
   * pattern vouches for the pattern's amounts, not for ten times them.
   */
  amount_outside_pattern: z.boolean(),
  /** Cross-check contradictions still standing after the repair budget. */
  unresolved_issue_count: z.number().int().min(0),
  /** From env MATERIALITY_NOK. */
  materiality_nok: z.number().positive(),
});
export type TriageInputs = z.infer<typeof TriageInputsSchema>;

export const TriageDecisionSchema = z.strictObject({
  triage: TriageSchema,
  /** Human-readable: the first rule that decided the outcome. */
  reason: z.string().min(1),
  /** Every rule that fired, in order — the audit trail of the decision. */
  rules: z.array(z.string().min(1)),
});
export type TriageDecision = z.infer<typeof TriageDecisionSchema>;
