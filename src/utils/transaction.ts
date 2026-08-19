import { readFile } from 'node:fs/promises';
import { parseCsv } from './csv.ts';
import { TransactionSchema, type Transaction } from './transaction.schema.ts';
import { formatZodError } from './zod.ts';

/** Loads and validates the batch. A bad row is an error, not a skip. */
export const loadTransactions = async (path: string): Promise<Transaction[]> => {
  const text = await readFile(path, 'utf8');
  const rows = parseCsv(text, path);

  return rows.map((row, index) => {
    const parsed = TransactionSchema.safeParse(row);
    if (!parsed.success) {
      throw new Error(`${path}: line ${index + 2}:\n${formatZodError(parsed.error)}`);
    }
    return parsed.data;
  });
};

/**
 * Counterparty normalisation, shared by the history index and the question
 * grouping. Case, punctuation and separators vary between the bank feed and
 * history ("Bolt / Uber", "TRANSFERWISE / WISE"), so matching happens on the
 * normalised form only.
 */
export const normaliseCounterparty = (name: string): string =>
  name
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();

/**
 * Code-decided transaction shapes the triage overrides key on. These are
 * policy detectors, not guesses — each names the literal pattern it matches.
 */

/** Cash withdrawals: MINIBANK counterparties, Kontantuttak descriptions. */
export const isCashWithdrawal = (transaction: Transaction): boolean =>
  /minibank/i.test(transaction.counterparty) || /kontantuttak/i.test(transaction.description);

/**
 * A Vipps payment to a named person rather than a business — two name tokens
 * after VIPPS ("VIPPS LARS HANSEN"), so "Vipps AS" itself does not match.
 */
export const isPersonalVipps = (transaction: Transaction): boolean =>
  /^vipps\s+\p{L}+\s+\p{L}+/iu.test(transaction.counterparty);
