import { beforeAll, describe, expect, it } from 'vitest';
import { buildHistoryIndex, loadHistory, searchHistory } from './history.ts';
import { type HistoryIndex } from './history.schema.ts';

describe('history against the real data', () => {
  let index: HistoryIndex;

  beforeAll(async () => {
    const rows = await loadHistory('ai-engineer/data/history.json');
    expect(rows).toHaveLength(150);
    index = buildHistoryIndex(rows);
  });

  it('shows the Skatteetaten three-way split — the case the counterparty cannot decide', () => {
    const result = searchHistory(index, {
      counterparty: 'Skatteetaten',
      description_keyword: null,
      limit: 20,
    });
    expect(result.match_count).toBe(18);
    const categories = new Map(
      result.category_distribution.map((entry) => [entry.category, entry.count]),
    );
    expect(categories.get('salary_tax')).toBe(6);
    expect(categories.get('employer_tax')).toBe(6);
    expect(categories.get('vat_payment')).toBe(6);
  });

  it('narrows the split with a description keyword', () => {
    const result = searchHistory(index, {
      counterparty: 'Skatteetaten',
      description_keyword: 'Forskuddstrekk',
      limit: 20,
    });
    expect(result.match_count).toBe(6);
    expect(result.category_distribution).toEqual([{ category: 'salary_tax', count: 6 }]);
  });

  it('states emptiness loudly for an unseen counterparty', () => {
    const result = searchHistory(index, {
      counterparty: 'NETFLIX',
      description_keyword: null,
      limit: 10,
    });
    expect(result.match_count).toBe(0);
    expect(result.matches).toEqual([]);
    expect(result.note).toContain('NO PRIOR TRANSACTIONS');
    expect(result.amount_range).toBeNull();
    expect(result.cadence_median_days).toBeNull();
  });

  it('reports a monthly cadence for a recurring counterparty', () => {
    const result = searchHistory(index, {
      counterparty: 'Telenor Norge AS',
      description_keyword: null,
      limit: 20,
    });
    expect(result.match_count).toBeGreaterThanOrEqual(3);
    expect(result.cadence_median_days).toBeGreaterThan(20);
    expect(result.cadence_median_days).toBeLessThan(40);
  });

  it('finds a counterparty through containment when the query is partial', () => {
    const result = searchHistory(index, {
      counterparty: 'Telia',
      description_keyword: null,
      limit: 10,
    });
    expect(result.match_count).toBeGreaterThan(0);
    expect(result.match_quality).toBe('contains');
    expect(result.matches.every((match) => /telia/i.test(match.counterparty))).toBe(true);
  });

  it("labels exact matches as this counterparty's own history", () => {
    const result = searchHistory(index, {
      counterparty: 'Telenor Norge AS',
      description_keyword: null,
      limit: 10,
    });
    expect(result.match_quality).toBe('exact');
  });

  // Regression: this shared-surname overlap masqueraded as a 6/6 salary
  // history for a Vipps payment and derailed three repair rounds.
  it('marks shared-word matches as token_overlap and says so in the note', () => {
    const result = searchHistory(index, {
      counterparty: 'VIPPS LARS HANSEN',
      description_keyword: null,
      limit: 10,
    });
    expect(result.match_quality).toBe('token_overlap');
    expect(result.match_count).toBeGreaterThan(0); // INGRID HANSEN, via 'hansen'
    expect(result.note).toContain('SIMILARLY NAMED');
  });

  it('caps returned matches at the limit while counting all of them', () => {
    const result = searchHistory(index, {
      counterparty: 'Skatteetaten',
      description_keyword: null,
      limit: 5,
    });
    expect(result.match_count).toBe(18);
    expect(result.matches).toHaveLength(5);
  });
});
