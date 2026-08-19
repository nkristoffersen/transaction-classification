import { describe, expect, it } from 'vitest';
import {
  isCashWithdrawal,
  isPersonalVipps,
  loadTransactions,
  normaliseCounterparty,
} from './transaction.ts';
import { type Transaction } from './transaction.schema.ts';

const row = (overrides: Partial<Transaction>): Transaction => ({
  id: 't-1',
  date: '2026-06-01',
  amount_nok: -100,
  counterparty: 'X',
  description: 'y',
  currency: 'NOK',
  ...overrides,
});

describe('loadTransactions', () => {
  it('loads the real batch with numeric amounts', async () => {
    const rows = await loadTransactions('ai-engineer/data/transactions.csv');
    expect(rows).toHaveLength(55);
    for (const transaction of rows) {
      expect(typeof transaction.amount_nok).toBe('number');
      expect(Number.isFinite(transaction.amount_nok)).toBe(true);
    }
    // The EUR row must survive the parse with its currency intact.
    expect(rows.find((transaction) => transaction.id === 't-00050')?.currency).toBe('EUR');
  });
});

describe('normaliseCounterparty', () => {
  it('collapses case, punctuation and separators', () => {
    expect(normaliseCounterparty('Bolt / Uber')).toBe('bolt uber');
    expect(normaliseCounterparty('TRANSFERWISE / WISE')).toBe('transferwise wise');
    expect(normaliseCounterparty('Get / Telia Norge AS')).toBe('get telia norge as');
  });

  it('keeps Norwegian letters', () => {
    expect(normaliseCounterparty('ICA NÆR')).toBe('ica nær');
  });
});

describe('policy detectors', () => {
  it('detects cash withdrawals by counterparty or description', () => {
    expect(isCashWithdrawal(row({ counterparty: 'MINIBANK DNB' }))).toBe(true);
    expect(isCashWithdrawal(row({ description: 'Kontantuttak' }))).toBe(true);
    expect(isCashWithdrawal(row({ counterparty: 'DNB Bank', description: 'Kortgebyr' }))).toBe(
      false,
    );
  });

  it('detects Vipps to a named person, not Vipps the company', () => {
    expect(isPersonalVipps(row({ counterparty: 'VIPPS LARS HANSEN' }))).toBe(true);
    expect(isPersonalVipps(row({ counterparty: 'VIPPS ANNE BERG' }))).toBe(true);
    expect(isPersonalVipps(row({ counterparty: 'Vipps AS' }))).toBe(false);
    expect(isPersonalVipps(row({ counterparty: 'Telenor Norge AS' }))).toBe(false);
  });
});
