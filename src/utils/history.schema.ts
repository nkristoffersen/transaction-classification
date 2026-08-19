import { z } from 'zod';
import { AccountCodeSchema } from './category.schema.ts';
import { TransactionSchema } from './transaction.schema.ts';

/**
 * The history.json boundary, and the shape of what `search_history` returns.
 *
 * The tool result is model-facing JSON, so its shape is part of the prompt
 * surface: compact, explicit about emptiness, and carrying the aggregates the
 * model would otherwise have to compute (badly) itself.
 */

/** History is a transaction plus a known category — so it composes. */
export const HistoricalTransactionSchema = TransactionSchema.extend({
  category: AccountCodeSchema,
});
export type HistoricalTransaction = z.infer<typeof HistoricalTransactionSchema>;

export const HistoryFileSchema = z.array(HistoricalTransactionSchema);

/** One aggregate line of a search result. */
export const CategoryCountSchema = z.strictObject({
  category: AccountCodeSchema,
  count: z.number().int().min(1),
});

/** What a search_history call returns to the model. */
export const HistorySearchResultSchema = z.strictObject({
  /** Echo of what was searched, so a transcript reads on its own. */
  query: z.strictObject({
    counterparty: z.string(),
    description_keyword: z.string().nullable(),
  }),
  match_count: z.number().int().min(0),
  /**
   * The categories the matches carry, with counts. The distribution IS the
   * answer for most rows — a single dominant category is support, a split
   * (like Skatteetaten's three-way) is a warning that the description must
   * decide.
   */
  category_distribution: z.array(CategoryCountSchema),
  /** The matched rows themselves, capped at the requested limit. */
  matches: z.array(HistoricalTransactionSchema),
  amount_range: z.strictObject({ min: z.number(), max: z.number() }).nullable(),
  /** Median days between consecutive matches — cadence, where it exists. */
  cadence_median_days: z.number().nullable(),
  /**
   * Stated loudly when empty: "no prior transactions" is the normal answer
   * for the accounts that need a human, and the model must see it as a fact
   * rather than infer it from an empty array.
   */
  note: z.string(),
});
export type HistorySearchResult = z.infer<typeof HistorySearchResultSchema>;

// The search index: keyed maps over the loaded history
// (skill carve-out 3: runtime Maps never cross a boundary).
export interface HistoryIndex {
  all: HistoricalTransaction[];
  byNormalisedCounterparty: Map<string, HistoricalTransaction[]>;
}
