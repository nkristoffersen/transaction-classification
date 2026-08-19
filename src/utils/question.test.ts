import { describe, expect, it } from 'vitest';
import { buildFallbackQuestion, proposeCandidateGroups, validateQuestions } from './question.ts';
import { type QuestionsResponse } from './question.schema.ts';
import { type Transaction } from './transaction.schema.ts';

const row = (id: string, overrides: Partial<Transaction> = {}): Transaction => ({
  id,
  date: '2026-06-02',
  amount_nok: -2345.78,
  counterparty: 'VIPPS LARS HANSEN',
  description: 'Vipps',
  currency: 'NOK',
  ...overrides,
});

const vipps = [
  row('t-00038'),
  row('t-00049', { date: '2026-06-06', amount_nok: -1240 }),
  row('t-00048', { date: '2026-06-26', amount_nok: -680 }),
];
const cash = [
  row('t-00051', { counterparty: 'MINIBANK DNB', description: 'Kontantuttak', amount_nok: -5000 }),
  row('t-00040', {
    counterparty: 'MINIBANK SPAREBANK 1',
    description: 'Kontantuttak',
    amount_nok: -4046.2,
  }),
];

describe('proposeCandidateGroups', () => {
  it('groups repeated counterparties and pools cash withdrawals', () => {
    const groups = proposeCandidateGroups([...vipps, ...cash]);
    expect(groups.get('vipps lars hansen')).toHaveLength(3);
    // Two different ATMs, one purpose-question.
    expect(groups.get('cash-withdrawals')).toHaveLength(2);
  });
});

describe('validateQuestions', () => {
  const goodQuestion =
    'Hei! Vi ser tre Vipps-betalinger til Lars Hansen i juni på 2345, 1240 og 680 kr. ' +
    'Kan du fortelle oss hva disse gjaldt?';

  const response = (groups: QuestionsResponse['groups']): QuestionsResponse => ({
    reasoning: 'same person, one question',
    groups,
  });

  it('accepts a covering partition with a grounded Norwegian question', () => {
    const issues = validateQuestions(
      response([
        { transaction_ids: ['t-00038', 't-00049', 't-00048'], question_norwegian: goodQuestion },
      ]),
      vipps,
    );
    expect(issues).toEqual([]);
  });

  it('flags a dropped transaction — the failure that reads as handled', () => {
    const issues = validateQuestions(
      response([{ transaction_ids: ['t-00038', 't-00049'], question_norwegian: goodQuestion }]),
      vipps,
    );
    expect(issues.some((issue) => issue.message.includes('t-00048'))).toBe(true);
  });

  it('flags duplicated and invented ids', () => {
    const issues = validateQuestions(
      response([
        { transaction_ids: ['t-00038', 't-00038'], question_norwegian: goodQuestion },
        { transaction_ids: ['t-99999', 't-00049', 't-00048'], question_norwegian: goodQuestion },
      ]),
      vipps,
    );
    expect(issues.some((issue) => issue.message.includes('more than one group'))).toBe(true);
    expect(issues.some((issue) => issue.message.includes('t-99999'))).toBe(true);
  });

  it('flags English leaking into the Norwegian', () => {
    const issues = validateQuestions(
      response([
        {
          transaction_ids: ['t-00038', 't-00049', 't-00048'],
          question_norwegian:
            'Hei! Could you please tell us what the payments to Lars Hansen på 2345 kr were for?',
        },
      ]),
      vipps,
    );
    expect(issues.some((issue) => issue.message.includes('English'))).toBe(true);
  });

  it('flags a question with no amount and no anchor', () => {
    const issues = validateQuestions(
      response([
        {
          transaction_ids: ['t-00038', 't-00049', 't-00048'],
          question_norwegian: 'Hei! Kan du si oss hva disse betalingene egentlig gjaldt, mon tro?',
        },
      ]),
      vipps,
    );
    expect(issues.some((issue) => issue.message.includes('amounts'))).toBe(true);
  });

  it('flags a missing question mark and a too-short question', () => {
    const issues = validateQuestions(
      response([
        { transaction_ids: ['t-00038', 't-00049', 't-00048'], question_norwegian: 'Hva er dette.' },
      ]),
      vipps,
    );
    expect(issues.some((issue) => issue.message.includes('question mark'))).toBe(true);
    expect(issues.some((issue) => issue.message.includes('characters'))).toBe(true);
  });
});

describe('buildFallbackQuestion', () => {
  it('produces a question that passes its own validation', () => {
    const question = buildFallbackQuestion(cash);
    const issues = validateQuestions(
      {
        reasoning: 'fallback',
        groups: [{ transaction_ids: ['t-00051', 't-00040'], question_norwegian: question }],
      },
      cash,
    );
    expect(issues).toEqual([]);
  });
});
