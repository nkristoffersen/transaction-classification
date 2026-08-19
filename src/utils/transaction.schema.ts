import { z } from 'zod';

/**
 * The transactions.csv boundary. Every column arrives as a string — including
 * `amount_nok` — so this is one of the two places `z.coerce` is allowed (the
 * other is env). Signed amounts: negative is money out.
 */
export const TransactionSchema = z.strictObject({
  id: z.string().min(1),
  date: z.iso.date(),
  amount_nok: z.coerce.number(),
  counterparty: z.string().min(1),
  description: z.string().min(1),
  currency: z.string().min(1),
});
export type Transaction = z.infer<typeof TransactionSchema>;
