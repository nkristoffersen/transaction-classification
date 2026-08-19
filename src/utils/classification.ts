import { type Transaction } from './transaction.schema.ts';
import { prose } from './text.ts';

/**
 * Builds the per-transaction request. The system message is three sentences
 * of framing; the user message carries only facts about this transaction. The
 * accounting rules travel in the schema's field descriptions, not here — the
 * schema is the prompt.
 */

export const SYSTEM_MESSAGE = prose`
  You classify bank transactions for a small Norwegian business's accounting. You report
  observations — history evidence, purpose clarity, personal risk, missing information — plus a
  category from the chart of accounts; the triage decision itself is made by code from what you
  report. Always consult the prior transactions through the search_history tool before answering,
  and ground every claim in what it returned.
`;

export const buildUserMessage = (
  transaction: Transaction,
  renderedSchema: string | null,
): string => {
  const facts = [
    `id: ${transaction.id}`,
    `date: ${transaction.date}`,
    `amount_nok: ${transaction.amount_nok} (negative = money out of the business)`,
    `counterparty: ${transaction.counterparty}`,
    `description: ${transaction.description}`,
    `currency: ${transaction.currency}`,
  ].join('\n');

  const instruction = prose`
    First call search_history for the counterparty. If the result shows several categories for it,
    call it again with a description_keyword to see which pattern this row belongs to. Then answer
    with a single JSON object matching the schema — no prose around it.
  `;

  const schemaBlock =
    renderedSchema === null
      ? ''
      : `\n\nThe answer must match this JSON Schema. The field descriptions carry the accounting` +
        ` guidance — read them:\n${renderedSchema}`;

  return `Classify this transaction.\n\n${facts}\n\n${instruction}${schemaBlock}`;
};
