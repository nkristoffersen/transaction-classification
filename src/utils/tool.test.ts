import { beforeAll, describe, expect, it } from 'vitest';
import { buildHistoryIndex, loadHistory } from './history.ts';
import { type HistoryIndex } from './history.schema.ts';
import { executeSearchHistory, searchHistoryToolDefinition } from './tool.ts';

describe('executeSearchHistory', () => {
  let index: HistoryIndex;

  beforeAll(async () => {
    index = buildHistoryIndex(await loadHistory('ai-engineer/data/history.json'));
  });

  it('executes a valid call and records it', () => {
    const record = executeSearchHistory(index, { counterparty: 'Telenor Norge AS' });
    expect(record.error).toBeNull();
    expect(record.arguments?.limit).toBe(10); // default filled by the parse
    expect(record.result?.match_count).toBeGreaterThan(0);
    expect(record.injected).toBe(false);
  });

  it('rejects model-authored arguments outside the bounds', () => {
    const record = executeSearchHistory(index, { counterparty: 'X', limit: 100_000 });
    expect(record.result).toBeNull();
    expect(record.error).toContain('Invalid arguments');
  });

  it('rejects unknown keys — the schema is closed', () => {
    const record = executeSearchHistory(index, { counterparty: 'X', fetch_everything: true });
    expect(record.error).toContain('Invalid arguments');
  });

  it('marks an injected fallback lookup as such', () => {
    const record = executeSearchHistory(index, { counterparty: 'Telenor Norge AS' }, true);
    expect(record.injected).toBe(true);
  });
});

describe('searchHistoryToolDefinition', () => {
  it('advertises the same schema that guards execution', () => {
    const definition = searchHistoryToolDefinition();
    expect(definition.name).toBe('search_history');
    const properties = definition.input_schema['properties'] as Record<string, unknown>;
    expect(Object.keys(properties)).toEqual(['counterparty', 'description_keyword', 'limit']);
  });
});
