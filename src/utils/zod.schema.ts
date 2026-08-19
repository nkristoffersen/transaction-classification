import { z } from 'zod';

/** A problem with a classification, from either zod or a semantic cross-check. */
export const RepairIssueSchema = z.strictObject({
  path: z.string().min(1),
  message: z.string().min(1),
  /** `schema` from zod validation, `consistency` from a domain cross-check. */
  source: z.enum(['schema', 'consistency']),
});
export type RepairIssue = z.infer<typeof RepairIssueSchema>;
