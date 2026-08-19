import { z } from 'zod';
import { ACCOUNT_GUIDANCE } from './category.ts';
import { labelsOf, type AccountEntry } from './guidance.schema.ts';

/**
 * The category boundary: the enum derived from the guidance table, and the
 * parse + reconciliation of the shipped `chart-of-accounts.json`.
 */

/**
 * The account codes as a zod enum. Derived from the table, so the value the
 * model may emit and the instruction for when to emit it come from the same
 * array. The literal union survives (`labelsOf` keeps it), so a `switch` over
 * codes can be exhaustive.
 */
export const AccountCodeSchema = z.enum(labelsOf(ACCOUNT_GUIDANCE));
export type AccountCode = z.infer<typeof AccountCodeSchema>;

/** Lookup by code, for the triage derivation and the cross-checks. */
const BY_CODE = new Map<AccountCode, AccountEntry>(
  ACCOUNT_GUIDANCE.map((entry) => [entry.label, entry]),
);

export const accountFor = (code: AccountCode): AccountEntry => {
  const entry = BY_CODE.get(code);
  if (entry === undefined) throw new Error(`Unknown account code: ${code}`);
  return entry;
};

/** The shipped chart-of-accounts.json. */
export const ChartFileSchema = z.strictObject({
  accounts: z.array(
    z.strictObject({
      code: z.string().min(1),
      name: z.string().min(1),
      description: z.string().min(1),
    }),
  ),
});
export type ChartFile = z.infer<typeof ChartFileSchema>;

/**
 * The guidance table is a hard-coded duplicate of the chart's codes — the
 * price of literal types and per-code guidance (see the repo skill,
 * "Data-driven enums"). This assertion is what that duplication costs to keep
 * honest: any drift between the table and the shipped file fails the run at
 * startup, loudly, before a single token is spent.
 */
export const assertAccountsMatchChart = (chart: ChartFile): void => {
  const table = new Set<string>(labelsOf(ACCOUNT_GUIDANCE));
  const file = new Set(chart.accounts.map((account) => account.code));

  const missing = [...file].filter((code) => !table.has(code));
  const extra = [...table].filter((code) => !file.has(code));

  if (missing.length > 0 || extra.length > 0) {
    const parts = [
      missing.length > 0
        ? `in chart-of-accounts.json but not in ACCOUNT_GUIDANCE: ${missing.join(', ')}`
        : '',
      extra.length > 0
        ? `in ACCOUNT_GUIDANCE but not in chart-of-accounts.json: ${extra.join(', ')}`
        : '',
    ].filter((part) => part !== '');
    throw new Error(`Account table and chart of accounts disagree — ${parts.join('; ')}`);
  }
};
