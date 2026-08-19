import { describe, expect, it } from 'vitest';
import { buildUserMessage, SYSTEM_MESSAGE } from './classification.ts';
import { ClassificationSchema } from './classification.schema.ts';
import { type Transaction } from './transaction.schema.ts';

const transaction: Transaction = {
  id: 't-00025',
  date: '2026-06-01',
  amount_nok: -10_567.99,
  counterparty: 'Power AS',
  description: 'Datautstyr',
  currency: 'NOK',
};

describe('ClassificationSchema', () => {
  /**
   * FIELD ORDER IS LOAD-BEARING. Constrained decoding emits properties in
   * schema order, so reasoning must precede the category and uncertainty must
   * precede confidence. This test is what makes an accidental reorder a red
   * build instead of a silent quality regression.
   */
  it('keeps reason-before-verdict order', () => {
    expect(Object.keys(ClassificationSchema.shape)).toEqual([
      'history_evidence',
      'history_support',
      'reasoning',
      'category_code',
      'purpose_clarity',
      'personal_risk',
      'missing_information',
      'uncertainty_note',
      'confidence',
    ]);
  });

  it('rejects an invented key — the schema is closed', () => {
    const value = {
      history_evidence: 'x',
      history_support: 'NONE',
      reasoning: 'y',
      category_code: 'utilities',
      purpose_clarity: 'UNAMBIGUOUS',
      personal_risk: 'NONE',
      missing_information: 'NONE',
      uncertainty_note: null,
      confidence: 'HIGH',
      triage: 'auto-approve', // the model deciding what code decides
    };
    const parsed = ClassificationSchema.safeParse(value);
    expect(parsed.success).toBe(false);
  });

  it('carries the guidance in its descriptions', () => {
    const description = ClassificationSchema.shape.category_code.description ?? '';
    expect(description).toContain('Forskuddstrekk');
    expect(description).toContain('When to use');
  });
});

describe('buildUserMessage', () => {
  it('carries only facts, and marks the sign convention', () => {
    const message = buildUserMessage(transaction, null);
    expect(message).toContain('t-00025');
    expect(message).toContain('-10567.99');
    expect(message).toContain('negative = money out');
    expect(message).toContain('Power AS');
    // No accounting rules in the message — they live in the schema.
    expect(message).not.toContain('Forskuddstrekk');
  });

  it('renders the schema into the message only when asked', () => {
    expect(buildUserMessage(transaction, null)).not.toContain('JSON Schema');
    expect(buildUserMessage(transaction, '{"type":"object"}')).toContain('JSON Schema');
  });
});

describe('SYSTEM_MESSAGE', () => {
  it('frames without ruling — the rules travel with the schema', () => {
    expect(SYSTEM_MESSAGE).toContain('search_history');
    expect(SYSTEM_MESSAGE).not.toContain('Skatteetaten');
  });
});
