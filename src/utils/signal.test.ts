import { describe, expect, it } from 'vitest';
import { SignalEntrySchema } from './guidance.schema.ts';
import { HISTORY_SUPPORT, MISSING_INFORMATION, PERSONAL_RISK, PURPOSE_CLARITY } from './signal.ts';
import { signalEntry } from './signal.schema.ts';

const TABLES = [HISTORY_SUPPORT, PURPOSE_CLARITY, PERSONAL_RISK, MISSING_INFORMATION];

describe('signal tables', () => {
  it('every entry parses as a full SignalEntry', () => {
    for (const table of TABLES) {
      for (const entry of table) {
        expect(() => SignalEntrySchema.parse(entry)).not.toThrow();
      }
    }
  });

  it('only exact history support carries auto-approve', () => {
    const supporting = HISTORY_SUPPORT.filter((entry) => entry.supportsAutoApprove).map(
      (entry) => entry.label,
    );
    expect(supporting).toEqual(['EXACT_RECURRING', 'EXACT_ONE_OFF']);
  });

  it('asks the owner exactly where only the owner can answer', () => {
    const asking = TABLES.flatMap((table) =>
      table.filter((entry) => entry.asksOwner).map((entry) => entry.label),
    );
    expect(asking).toEqual([
      'UNKNOWABLE_FROM_BANK_DATA',
      'NEEDS_PURPOSE',
      'NEEDS_ATTENDEES',
      'NEEDS_ACCOUNT_OWNERSHIP',
    ]);
  });

  it('every asks-owner value also blocks auto-approve', () => {
    for (const table of TABLES) {
      for (const entry of table) {
        if (entry.asksOwner) expect(entry.blocksAutoApprove).toBe(true);
      }
    }
  });

  it('signalEntry finds an entry and throws on an unknown label', () => {
    expect(signalEntry(HISTORY_SUPPORT, 'NONE').label).toBe('NONE');
    expect(() =>
      signalEntry(HISTORY_SUPPORT, 'MADE_UP' as (typeof HISTORY_SUPPORT)[number]['label']),
    ).toThrow(/Unknown signal label/);
  });
});
