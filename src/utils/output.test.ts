import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  auditPathFor,
  buildResultsFile,
  csvPathFor,
  renderResultsCsv,
  writeResultsFile,
} from './output.ts';
import { ResultsFileSchema, type Outcome } from './output.schema.ts';

const outcome = (id: string, triage: Outcome['triage']['triage']): Outcome => ({
  transaction: {
    id,
    date: '2026-06-01',
    amount_nok: -749,
    counterparty: 'Telenor "Norge" AS',
    description: 'Mobil, abonnement',
    currency: 'NOK',
  },
  classification: {
    history_evidence: '6 prior, all utilities.',
    history_support: 'EXACT_RECURRING',
    reasoning: 'Recurring telecom subscription.',
    category_code: 'utilities',
    purpose_clarity: 'UNAMBIGUOUS',
    personal_risk: 'NONE',
    missing_information: 'NONE',
    uncertainty_note: null,
    confidence: 'HIGH',
  },
  triage: { triage, reason: 'because', rules: [] },
  tool_calls: [],
  repair_attempts: 0,
  tool_call_missing: false,
  unresolved_issues: [],
  tokens_in: 100,
  tokens_out: 50,
  duration_ms: 1200,
});

describe('buildResultsFile', () => {
  it('links owner-question rows to their group', () => {
    const file = buildResultsFile(
      [outcome('t-1', 'owner-question'), outcome('t-2', 'auto-approve')],
      [{ group_id: 'q-001', transaction_ids: ['t-1'], question_norwegian: 'Hva gjaldt dette?' }],
      [],
      'test-model',
      '2026-08-19T12:00:00.000Z',
    );
    expect(ResultsFileSchema.safeParse(file).success).toBe(true);
    expect(file.results[0]?.question_group).toBe('q-001');
    expect(file.results[1]?.question_group).toBeNull();
    expect(file.results[0]?.category_name).toBe('Utilities');
  });
});

describe('renderResultsCsv', () => {
  it('escapes quotes and commas', () => {
    const file = buildResultsFile(
      [outcome('t-1', 'auto-approve')],
      [],
      [],
      'test-model',
      '2026-08-19T12:00:00.000Z',
    );
    const csv = renderResultsCsv(file);
    expect(csv.split('\n')[0]).toContain('id,date,amount_nok');
    expect(csv).toContain('"Telenor ""Norge"" AS"');
    expect(csv).toContain('"Mobil, abonnement"');
  });
});

describe('writeResultsFile', () => {
  let dir: string;
  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'results-'));
  });
  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('writes json + csv, parsing before write', async () => {
    const path = join(dir, 'results.json');
    const file = buildResultsFile(
      [outcome('t-1', 'auto-approve')],
      [],
      [],
      'test-model',
      '2026-08-19T12:00:00.000Z',
    );
    await writeResultsFile(path, file);

    const written = ResultsFileSchema.parse(JSON.parse(await readFile(path, 'utf8')));
    expect(written.transactions_classified).toBe(1);
    const csv = await readFile(csvPathFor(path), 'utf8');
    expect(csv).toContain('t-1');
  });

  it('refuses to write a malformed file', async () => {
    const path = join(dir, 'bad.json');
    const file = buildResultsFile([], [], [], 'test-model', '2026-08-19T12:00:00.000Z');
    // Corrupt it after building: an id-less row must not reach disk.
    (file.results as unknown[]).push({ nonsense: true });
    await expect(writeResultsFile(path, file)).rejects.toThrow(/schema/);
  });
});

describe('paths', () => {
  it('derives the audit and csv paths from the output path', () => {
    expect(auditPathFor('results.json')).toBe('results-raw.json');
    expect(csvPathFor('results.json')).toBe('results.csv');
    expect(auditPathFor('/app/out/results.json')).toBe('/app/out/results-raw.json');
  });
});
