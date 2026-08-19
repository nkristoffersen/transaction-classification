import { z } from 'zod';
import { ACCOUNT_GUIDANCE } from './category.ts';
import { AccountCodeSchema } from './category.schema.ts';
import { renderGuidance } from './guidance.schema.ts';
import { HISTORY_SUPPORT, MISSING_INFORMATION, PERSONAL_RISK, PURPOSE_CLARITY } from './signal.ts';
import {
  HistorySupportSchema,
  MissingInformationSchema,
  PersonalRiskSchema,
  PurposeClaritySchema,
} from './signal.schema.ts';
import { prose } from './text.ts';

/**
 * The model's output — the schema IS the prompt.
 *
 * All accounting guidance lives in the `.describe()` calls below, rendered
 * from the same tables that produce the enums, so the contract and the
 * guidance cannot drift.
 *
 * FIELD ORDER IS LOAD-BEARING. Constrained decoding emits properties in
 * schema order, so every field where the model selects something is preceded
 * by the field where it must state its reason: evidence before support,
 * reasoning before category, uncertainty before confidence. Reordering these
 * silently breaks reason-before-verdict; `classification.test.ts` pins the
 * order so it cannot happen by accident.
 */

export const ConfidenceSchema = z.enum(['HIGH', 'MEDIUM', 'LOW']);
export type Confidence = z.infer<typeof ConfidenceSchema>;

export const ClassificationSchema = z.strictObject({
  history_evidence: z.string().min(1).describe(prose`
      What the history search actually showed, concretely: which counterparty matched, which
      categories with which counts, the cadence — or that there were no prior transactions. Cite
      only what a search_history result returned; this field is checked against the tool results.
    `),
  history_support: HistorySupportSchema.describe(renderGuidance(HISTORY_SUPPORT)),
  reasoning: z.string().min(1).describe(prose`
      Why the category you are about to choose is right, stated before you choose it. Weigh the
      evidence above; if two accounts were plausible, name both and say what decided it.
    `),
  category_code: AccountCodeSchema.describe(renderGuidance(ACCOUNT_GUIDANCE)),
  purpose_clarity: PurposeClaritySchema.describe(renderGuidance(PURPOSE_CLARITY)),
  personal_risk: PersonalRiskSchema.describe(renderGuidance(PERSONAL_RISK)),
  missing_information: MissingInformationSchema.describe(renderGuidance(MISSING_INFORMATION)),
  uncertainty_note: z
    .string()
    .min(1)
    .nullable()
    .describe('What remains unresolved after your analysis, or null if nothing does.'),
  confidence: ConfidenceSchema.describe(prose`
      How solid this classification is. HIGH only when history and description agree and nothing
      is missing. Never HIGH with category uncertain — an uncertain category is by definition not
      a confident one.
    `),
});
export type Classification = z.infer<typeof ClassificationSchema>;
