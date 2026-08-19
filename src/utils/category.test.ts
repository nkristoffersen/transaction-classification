import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { ACCOUNT_GUIDANCE } from './category.ts';
import {
  accountFor,
  AccountCodeSchema,
  assertAccountsMatchChart,
  ChartFileSchema,
} from './category.schema.ts';
import { AccountEntrySchema } from './guidance.schema.ts';

describe('ACCOUNT_GUIDANCE', () => {
  it('every entry parses as a full AccountEntry', () => {
    for (const entry of ACCOUNT_GUIDANCE) {
      expect(() => AccountEntrySchema.parse(entry)).not.toThrow();
    }
  });

  it('matches the shipped chart of accounts exactly', async () => {
    const raw = await readFile('ai-engineer/data/chart-of-accounts.json', 'utf8');
    const chart = ChartFileSchema.parse(JSON.parse(raw));
    expect(() => assertAccountsMatchChart(chart)).not.toThrow();
  });

  it('fails loudly when the chart and the table drift', () => {
    const chart = ChartFileSchema.parse({
      accounts: [{ code: 'salary', name: 'Salary', description: 'x' }],
    });
    expect(() => assertAccountsMatchChart(chart)).toThrow(/ACCOUNT_GUIDANCE/);
  });

  it('pairs uncertain with always-ask, per the chart description', () => {
    const uncertain = accountFor('uncertain');
    expect(uncertain.alwaysAsk).toBe(true);
    expect(uncertain.neverAutoApprove).toBe(true);
  });

  it('marks the accounts that may never auto-approve', () => {
    const flagged = ACCOUNT_GUIDANCE.filter((entry) => entry.neverAutoApprove).map(
      (entry) => entry.label,
    );
    expect(flagged).toEqual([
      'supplier_invoice',
      'owner_draw',
      'loan_transfer',
      'personal_expense',
      'uncertain',
    ]);
  });

  it('knows which accounts are money in, and which go both ways', () => {
    expect(accountFor('customer_payment').sign).toBe('money_in');
    // VAT refunds arrive as positive amounts, so vat_payment must be `either`.
    expect(accountFor('vat_payment').sign).toBe('either');
    expect(accountFor('transfer').sign).toBe('either');
    expect(accountFor('salary').sign).toBe('money_out');
  });

  it('rejects a code outside the chart', () => {
    expect(AccountCodeSchema.safeParse('office_snacks').success).toBe(false);
  });
});
