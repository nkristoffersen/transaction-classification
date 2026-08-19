import { z } from 'zod';
import { prose } from './text.ts';

/**
 * The owner-question boundary: what the model returns for the batch
 * post-pass. Reason-before-verdict applies here too — the grouping rationale
 * precedes the groups.
 */
export const QuestionsResponseSchema = z.strictObject({
  reasoning: z.string().min(1).describe(prose`
      Why these transactions group the way they do — which rows share one underlying question and
      which need their own. State this before the groups.
    `),
  groups: z
    .array(
      z.strictObject({
        transaction_ids: z
          .array(z.string().min(1))
          .min(1)
          .describe('The transactions this one question covers.'),
        question_norwegian: z.string().min(1).describe(prose`
            One question to the business owner, in Norwegian (bokmål), covering every transaction
            in this group. Name the amounts and dates or counterparties so the owner knows exactly
            which payments are meant. Polite, concrete, one question mark at the end. Do not ask
            for anything the bank data already shows.
          `),
      }),
    )
    .min(1),
});
export type QuestionsResponse = z.infer<typeof QuestionsResponseSchema>;

/** A validated group, with its assigned id, as published in results.json. */
export const OwnerQuestionGroupSchema = z.strictObject({
  group_id: z.string().min(1),
  transaction_ids: z.array(z.string().min(1)).min(1),
  question_norwegian: z.string().min(1),
});
export type OwnerQuestionGroup = z.infer<typeof OwnerQuestionGroupSchema>;
