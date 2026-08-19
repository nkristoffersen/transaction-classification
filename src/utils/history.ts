import { readFile } from 'node:fs/promises';
import {
  HistoryFileSchema,
  type HistoricalTransaction,
  type HistoryIndex,
  type HistorySearchResult,
} from './history.schema.ts';
import { normaliseCounterparty } from './transaction.ts';
import { formatZodError } from './zod.ts';

/**
 * Loading, indexing and searching the prior categorized transactions.
 *
 * The zod parse doubles as the referential check: `category` is the
 * AccountCode enum, so a history row categorized outside the chart of
 * accounts fails the load rather than silently seeding bad guidance.
 */

export const loadHistory = async (path: string): Promise<HistoricalTransaction[]> => {
  const text = await readFile(path, 'utf8');
  const parsed = HistoryFileSchema.safeParse(JSON.parse(text));
  if (!parsed.success) {
    throw new Error(`${path}:\n${formatZodError(parsed.error)}`);
  }
  return parsed.data;
};

export const buildHistoryIndex = (rows: HistoricalTransaction[]): HistoryIndex => {
  const byNormalisedCounterparty = new Map<string, HistoricalTransaction[]>();
  for (const row of rows) {
    const key = normaliseCounterparty(row.counterparty);
    const bucket = byNormalisedCounterparty.get(key);
    if (bucket === undefined) {
      byNormalisedCounterparty.set(key, [row]);
    } else {
      bucket.push(row);
    }
  }
  return { all: rows, byNormalisedCounterparty };
};

/**
 * Matching, in tiers of decreasing strictness: exact normalised equality,
 * then substring containment either way ("Telia" finds "Get / Telia Norge
 * AS"), then token overlap on tokens long enough to mean something. The tier
 * that first yields matches wins — a fuzzy tier never dilutes an exact hit.
 */
const matchCounterparty = (
  index: HistoryIndex,
  normalisedQuery: string,
): { rows: HistoricalTransaction[]; quality: HistorySearchResult['match_quality'] } => {
  const exact = index.byNormalisedCounterparty.get(normalisedQuery);
  if (exact !== undefined) return { rows: exact, quality: 'exact' };

  const containment: HistoricalTransaction[] = [];
  for (const [key, rows] of index.byNormalisedCounterparty) {
    if (key.includes(normalisedQuery) || normalisedQuery.includes(key)) {
      containment.push(...rows);
    }
  }
  if (containment.length > 0) return { rows: containment, quality: 'contains' };

  const queryTokens = new Set(normalisedQuery.split(' ').filter((token) => token.length > 2));
  if (queryTokens.size === 0) return { rows: [], quality: 'none' };

  const overlapping: HistoricalTransaction[] = [];
  for (const [key, rows] of index.byNormalisedCounterparty) {
    const keyTokens = key.split(' ');
    if (keyTokens.some((token) => queryTokens.has(token))) {
      overlapping.push(...rows);
    }
  }
  return { rows: overlapping, quality: overlapping.length > 0 ? 'token_overlap' : 'none' };
};

const median = (values: number[]): number | null => {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const low = sorted[mid - (sorted.length % 2 === 0 ? 1 : 0)];
  const high = sorted[mid];
  if (low === undefined || high === undefined) return null;
  return (low + high) / 2;
};

const DAY_MS = 24 * 60 * 60 * 1000;

/** The tool's implementation. Deterministic, code-owned, fully testable. */
export const searchHistory = (
  index: HistoryIndex,
  query: { counterparty: string; description_keyword: string | null; limit: number },
): HistorySearchResult => {
  const normalisedQuery = normaliseCounterparty(query.counterparty);
  const matched = matchCounterparty(index, normalisedQuery);
  let matches = matched.rows;

  if (query.description_keyword !== null) {
    const keyword = query.description_keyword.toLowerCase();
    matches = matches.filter((row) => row.description.toLowerCase().includes(keyword));
  }

  matches = [...matches].sort((a, b) => a.date.localeCompare(b.date));

  const counts = new Map<HistoricalTransaction['category'], number>();
  for (const row of matches) {
    counts.set(row.category, (counts.get(row.category) ?? 0) + 1);
  }

  const intervals: number[] = [];
  for (let i = 1; i < matches.length; i++) {
    const prev = matches[i - 1];
    const curr = matches[i];
    if (prev === undefined || curr === undefined) continue;
    intervals.push((Date.parse(curr.date) - Date.parse(prev.date)) / DAY_MS);
  }

  const amounts = matches.map((row) => row.amount_nok);

  const quality = matches.length === 0 ? 'none' : matched.quality;

  return {
    query: {
      counterparty: query.counterparty,
      description_keyword: query.description_keyword,
    },
    match_count: matches.length,
    match_quality: quality,
    category_distribution: [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([category, count]) => ({ category, count })),
    matches: matches.slice(-query.limit),
    amount_range:
      amounts.length === 0 ? null : { min: Math.min(...amounts), max: Math.max(...amounts) },
    cadence_median_days: median(intervals),
    note:
      matches.length === 0
        ? 'NO PRIOR TRANSACTIONS for this counterparty or keyword. That is a fact, not a gap: ' +
          'accounts like transfers, owner draws and one-off suppliers have no history by nature.'
        : quality === 'token_overlap'
          ? `${matches.length} transaction(s) from SIMILARLY NAMED counterparties (shared word ` +
            "only). This is NOT this counterparty's own history — at most comparable-merchant " +
            'evidence.'
          : `${matches.length} prior transaction(s) found.`,
  };
};
