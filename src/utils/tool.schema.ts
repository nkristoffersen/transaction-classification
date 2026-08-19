import { z } from 'zod';
import { HistorySearchResultSchema } from './history.schema.ts';
import { prose } from './text.ts';

/**
 * The search_history tool contract.
 *
 * The arguments come from the model, which makes them the least trustworthy
 * input in the system — so the same schema is both the tool's advertised
 * parameters and the guard on execution, with the numbers bounded: a model
 * asking for limit 100000 gets a validation error, not a full history scan
 * stuffed into the next prompt.
 */

export const SEARCH_HISTORY_TOOL_NAME = 'search_history';

export const SEARCH_HISTORY_DESCRIPTION = prose`
  Search the business's ~150 prior categorized transactions. Call this before classifying — the
  result is evidence, and your history_evidence field may only cite what a search actually
  returned. Search the counterparty first; when a counterparty maps to several categories (the
  result's category_distribution shows a split), search again with a description_keyword to see
  which pattern this transaction belongs to. An empty result is itself the answer for accounts
  with no history, like transfers and owner draws.
`;

export const SearchHistoryArgsSchema = z.strictObject({
  counterparty: z
    .string()
    .min(1)
    .describe('Counterparty name to search for. Exact spelling is best; matching is fuzzy.'),
  description_keyword: z
    .string()
    .min(1)
    .nullable()
    .default(null)
    .describe(
      'Optional keyword matched against descriptions, e.g. "Forskuddstrekk", "Lønn", "MVA".',
    ),
  limit: z.number().int().min(1).max(50).default(10).describe('Maximum matches to return.'),
});
export type SearchHistoryArgs = z.infer<typeof SearchHistoryArgsSchema>;

/** One executed tool call, for the audit artifact and the cross-checks. */
export const ToolCallRecordSchema = z.strictObject({
  name: z.string().min(1),
  /** The raw arguments as the model sent them. */
  raw_arguments: z.unknown(),
  /** The parsed arguments — null when the parse rejected them. */
  arguments: SearchHistoryArgsSchema.nullable(),
  result: HistorySearchResultSchema.nullable(),
  error: z.string().nullable(),
  /**
   * True when code executed this lookup because the model would not — the
   * fallback that turns a missing tool call into a measurable degradation
   * instead of a failed run.
   */
  injected: z.boolean(),
});
export type ToolCallRecord = z.infer<typeof ToolCallRecordSchema>;
