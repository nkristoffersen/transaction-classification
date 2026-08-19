import { describe, expect, it } from 'vitest';
import { type Classification } from './classification.schema.ts';
import { checkClassification } from './consistency.ts';
import { type HistorySearchResult } from './history.schema.ts';
import { type ToolCallRecord } from './tool.schema.ts';
import { type Transaction } from './transaction.schema.ts';

const transaction = (overrides: Partial<Transaction> = {}): Transaction => ({
  id: 't-1',
  date: '2026-06-01',
  amount_nok: -749,
  counterparty: 'Telenor Norge AS',
  description: 'Mobilabonnement',
  currency: 'NOK',
  ...overrides,
});

const classification = (overrides: Partial<Classification> = {}): Classification => ({
  history_evidence: '6 prior Telenor transactions, all utilities, monthly.',
  history_support: 'EXACT_RECURRING',
  reasoning: 'Recurring telecom subscription.',
  category_code: 'utilities',
  purpose_clarity: 'UNAMBIGUOUS',
  personal_risk: 'NONE',
  missing_information: 'NONE',
  uncertainty_note: null,
  confidence: 'HIGH',
  ...overrides,
});

const searchResult = (overrides: Partial<HistorySearchResult> = {}): HistorySearchResult => ({
  query: { counterparty: 'Telenor Norge AS', description_keyword: null },
  match_count: 6,
  match_quality: 'exact',
  category_distribution: [{ category: 'utilities', count: 6 }],
  matches: [],
  amount_range: { min: -749, max: -749 },
  cadence_median_days: 30,
  note: '6 prior transaction(s) found.',
  ...overrides,
});

const call = (result: HistorySearchResult | null): ToolCallRecord => ({
  name: 'search_history',
  raw_arguments: {},
  arguments: null,
  result,
  injected: false,
  error: result === null ? 'failed' : null,
});

describe('checkClassification', () => {
  it('passes a grounded, consistent classification', () => {
    expect(checkClassification(classification(), transaction(), [call(searchResult())])).toEqual(
      [],
    );
  });

  it('flags an answer produced with zero tool calls', () => {
    const issues = checkClassification(classification(), transaction(), []);
    expect(issues.some((issue) => issue.message.includes('search_history'))).toBe(true);
  });

  it('flags EXACT_RECURRING that no search result carries', () => {
    const issues = checkClassification(classification(), transaction(), [
      call(
        searchResult({
          match_count: 1,
          category_distribution: [{ category: 'utilities', count: 1 }],
        }),
      ),
    ]);
    expect(issues.some((issue) => issue.path === 'history_support')).toBe(true);
  });

  it('flags EXACT_ONE_OFF against empty results', () => {
    const issues = checkClassification(
      classification({ history_support: 'EXACT_ONE_OFF' }),
      transaction(),
      [call(searchResult({ match_count: 0, category_distribution: [] }))],
    );
    expect(issues.some((issue) => issue.path === 'history_support')).toBe(true);
  });

  it('flags a "no prior" claim the results contradict', () => {
    const issues = checkClassification(
      classification({ history_evidence: 'There were no prior transactions.' }),
      transaction(),
      [call(searchResult())],
    );
    expect(issues.some((issue) => issue.path === 'history_evidence')).toBe(true);
  });

  it('flags a category against an unambiguous majority when the reasoning ignores it', () => {
    const issues = checkClassification(
      classification({ category_code: 'software', reasoning: 'Feels like software.' }),
      transaction(),
      [call(searchResult())],
    );
    expect(issues.some((issue) => issue.path === 'category_code')).toBe(true);
  });

  it('accepts departing from the majority when the reasoning names it', () => {
    const issues = checkClassification(
      classification({
        category_code: 'software',
        history_support: 'EXACT_ONE_OFF',
        reasoning:
          'History says utilities for this counterparty, but this row is a software bundle sold by the telecom.',
      }),
      transaction(),
      [call(searchResult())],
    );
    expect(issues.filter((issue) => issue.path === 'category_code')).toEqual([]);
  });

  it('flags a money-out account on a positive amount', () => {
    const issues = checkClassification(classification(), transaction({ amount_nok: 749 }), [
      call(searchResult()),
    ]);
    expect(issues.some((issue) => issue.message.includes('positive'))).toBe(true);
  });

  it('flags customer_payment on money out', () => {
    const issues = checkClassification(
      classification({
        category_code: 'customer_payment',
        history_support: 'NONE',
        history_evidence: 'no matches for this counterparty',
      }),
      transaction(),
      [call(searchResult({ match_count: 0, category_distribution: [] }))],
    );
    expect(issues.some((issue) => issue.message.includes('negative'))).toBe(true);
  });

  // Regression: "VIPPS LARS HANSEN" once token-matched INGRID HANSEN's six
  // salary rows, and the cross-checks spent three repair rounds rejecting a
  // correct `uncertain`. Fuzzy-tier matches must bind nothing.
  it('lets fuzzy-tier matches bind nothing: no majority, no emptiness contradiction', () => {
    const fuzzy = searchResult({
      query: { counterparty: 'VIPPS LARS HANSEN', description_keyword: null },
      match_quality: 'token_overlap',
      category_distribution: [{ category: 'salary', count: 6 }],
    });
    const issues = checkClassification(
      classification({
        category_code: 'uncertain',
        history_support: 'NONE',
        history_evidence: 'No prior transactions for this counterparty; only similar names.',
        purpose_clarity: 'UNKNOWABLE_FROM_BANK_DATA',
        confidence: 'LOW',
      }),
      transaction({ counterparty: 'VIPPS LARS HANSEN', description: 'Vipps' }),
      [call(fuzzy)],
    );
    expect(issues).toEqual([]);
  });

  it('rejects EXACT_RECURRING resting on a fuzzy-tier match', () => {
    const fuzzy = searchResult({ match_quality: 'token_overlap' });
    const issues = checkClassification(
      classification({ category_code: 'salary', history_support: 'EXACT_RECURRING' }),
      transaction({ counterparty: 'VIPPS LARS HANSEN' }),
      [call(fuzzy)],
    );
    expect(issues.some((entry) => entry.path === 'history_support')).toBe(true);
  });

  it('flags uncertain paired with HIGH confidence', () => {
    const issues = checkClassification(
      classification({ category_code: 'uncertain', history_support: 'NONE' }),
      transaction(),
      [call(searchResult({ match_count: 0, category_distribution: [] }))],
    );
    expect(issues.some((issue) => issue.path === 'confidence')).toBe(true);
  });
});
