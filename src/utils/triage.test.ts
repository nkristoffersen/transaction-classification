import { describe, expect, it } from 'vitest';
import { type Classification } from './classification.schema.ts';
import { decideTriage, explainTriage } from './triage.ts';
import { type Transaction } from './transaction.schema.ts';
import { type TriageInputs } from './triage.schema.ts';

const transaction = (overrides: Partial<Transaction> = {}): Transaction => ({
  id: 't-1',
  date: '2026-06-22',
  amount_nok: -749,
  counterparty: 'Telenor Norge AS',
  description: 'Mobilabonnement',
  currency: 'NOK',
  ...overrides,
});

const classification = (overrides: Partial<Classification> = {}): Classification => ({
  history_evidence: '6 prior, all utilities.',
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

const inputs = (overrides: {
  classification?: Partial<Classification>;
  transaction?: Partial<Transaction>;
  tool_call_missing?: boolean;
  unresolved_issue_count?: number;
}): TriageInputs => ({
  classification: classification(overrides.classification ?? {}),
  transaction: transaction(overrides.transaction ?? {}),
  tool_call_missing: overrides.tool_call_missing ?? false,
  unresolved_issue_count: overrides.unresolved_issue_count ?? 0,
  materiality_nok: 20_000,
});

describe('decideTriage', () => {
  it('auto-approves the recurring, clear, confident case', () => {
    const decision = decideTriage(inputs({}));
    expect(decision.triage).toBe('auto-approve');
    expect(decision.rules).toEqual([]);
  });

  it('sends uncertain to the owner — the chart pairs them explicitly', () => {
    const decision = decideTriage(
      inputs({
        classification: {
          category_code: 'uncertain',
          history_support: 'NONE',
          purpose_clarity: 'UNKNOWABLE_FROM_BANK_DATA',
          confidence: 'LOW',
        },
      }),
    );
    expect(decision.triage).toBe('owner-question');
    expect(decision.rules).toContain('ACCOUNT_ALWAYS_ASK');
  });

  it('asks the owner when a signal says only the owner can answer', () => {
    const decision = decideTriage(
      inputs({
        classification: {
          category_code: 'meals',
          missing_information: 'NEEDS_ATTENDEES',
          confidence: 'MEDIUM',
        },
      }),
    );
    expect(decision.triage).toBe('owner-question');
    expect(decision.rules).toContain('SIGNAL_ASKS_OWNER');
  });

  it('asks the owner about cash withdrawals whatever the model said', () => {
    const decision = decideTriage(
      inputs({
        classification: { category_code: 'office_supplies' },
        transaction: { counterparty: 'MINIBANK DNB', description: 'Kontantuttak' },
      }),
    );
    expect(decision.triage).toBe('owner-question');
    expect(decision.rules).toContain('CASH_OR_PERSONAL_P2P');
  });

  it('keeps personal_expense with an accountant, not the owner', () => {
    const decision = decideTriage(
      inputs({
        classification: {
          category_code: 'personal_expense',
          history_support: 'NONE',
          personal_risk: 'LIKELY_PERSONAL',
          confidence: 'MEDIUM',
        },
        transaction: { counterparty: 'NETFLIX', description: 'Subscription' },
      }),
    );
    expect(decision.triage).toBe('accountant-review');
    expect(decision.rules).toContain('ACCOUNT_NEVER_AUTO');
  });

  it('floors large amounts without recurring history at accountant-review', () => {
    const decision = decideTriage(
      inputs({
        classification: {
          category_code: 'professional_services',
          history_support: 'EXACT_ONE_OFF',
        },
        transaction: { amount_nok: -43_097.15, counterparty: 'PwC Norge' },
      }),
    );
    expect(decision.triage).toBe('accountant-review');
    expect(decision.rules).toContain('MATERIALITY');
  });

  it('does not let materiality touch an exact recurring pattern', () => {
    const decision = decideTriage(
      inputs({
        classification: { category_code: 'salary' },
        transaction: { amount_nok: -42_000, counterparty: 'KARI NORDMANN', description: 'Lønn' },
      }),
    );
    expect(decision.triage).toBe('auto-approve');
  });

  it('floors foreign currency at accountant-review', () => {
    const decision = decideTriage(inputs({ transaction: { currency: 'EUR' } }));
    expect(decision.triage).toBe('accountant-review');
    expect(decision.rules).toContain('FOREIGN_CURRENCY');
  });

  it('floors system doubt at accountant-review', () => {
    expect(decideTriage(inputs({ tool_call_missing: true })).triage).toBe('accountant-review');
    expect(decideTriage(inputs({ unresolved_issue_count: 2 })).triage).toBe('accountant-review');
  });

  it('never lets a floor lower an owner-question', () => {
    const decision = decideTriage(
      inputs({
        classification: {
          category_code: 'uncertain',
          history_support: 'NONE',
          confidence: 'LOW',
        },
        transaction: { currency: 'EUR' },
      }),
    );
    expect(decision.triage).toBe('owner-question');
  });

  it('names the deciding rule in the reason', () => {
    const decision = decideTriage(
      inputs({
        classification: { category_code: 'uncertain', history_support: 'NONE', confidence: 'LOW' },
      }),
    );
    expect(decision.reason).toContain('uncertain');
  });
});

describe('explainTriage', () => {
  it('prints the live policy, computed rather than quoted', () => {
    const text = explainTriage(20_000);
    expect(text).toContain('EXACT_RECURRING');
    expect(text).toContain('supports-auto');
    expect(text).toContain('uncertain');
    expect(text).toContain('always-ask-owner');
    expect(text).toContain('20000');
  });
});
