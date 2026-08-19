import { z } from 'zod';

/**
 * The shared shape of a guidance-table entry, and the two helpers that turn a
 * table into schema material.
 *
 * Every domain table in this repo (`category.ts`, `signal.ts`) is an
 * `as const satisfies` array of these entries. One array yields both the enum
 * value the model may emit and the instruction telling it when to emit that
 * value — so a category cannot exist without its instruction, and the two
 * cannot drift apart, because deleting one deletes the other.
 *
 * This file is imported by the table modules and imports none of them, which
 * is what keeps `category.ts` ← `category.schema.ts` acyclic.
 */

export const GuidanceEntrySchema = z.strictObject({
  /** The enum value the model may emit. */
  label: z.string().min(1),
  /** What the value means. */
  description: z.string().min(1),
  /** When to use it. Becomes prompt guidance via `renderGuidance`. */
  analysisInstruction: z.string().min(1),
});
export type GuidanceEntry = z.infer<typeof GuidanceEntrySchema>;

/**
 * An account in the chart, plus the policy the model never sees. The
 * description and instruction face outward as guidance; the flags stay behind
 * as code-side policy, so changing what may be auto-approved is an edit to one
 * boolean rather than to a prompt.
 */
export const AccountEntrySchema = GuidanceEntrySchema.extend({
  /** Display name, as in chart-of-accounts.json. */
  name: z.string().min(1),
  /**
   * Which direction the money normally flows for this account. `either` for
   * accounts that legitimately go both ways (VAT refunds, transfers). The
   * consistency cross-check treats a contradiction as a repair issue.
   */
  sign: z.enum(['money_out', 'money_in', 'either']),
  /** This account may never be posted without a human seeing it. */
  neverAutoApprove: z.boolean(),
  /** This account always goes to the owner (the chart pairs it explicitly). */
  alwaysAsk: z.boolean(),
});
export type AccountEntry = z.infer<typeof AccountEntrySchema>;

/**
 * A signal-table entry. The three flags are stated explicitly on every entry
 * — uniform columns are what let `triage.ts` read policy from the tables
 * instead of switching on string literals, and what make `--explain-triage`
 * printable as one table.
 */
export const SignalEntrySchema = GuidanceEntrySchema.extend({
  /** This value counts toward auto-approve (meaningful on history support). */
  supportsAutoApprove: z.boolean(),
  /** Selecting this value rules auto-approve out. */
  blocksAutoApprove: z.boolean(),
  /** Selecting this value means the owner has to be asked. */
  asksOwner: z.boolean(),
});
export type SignalEntry = z.infer<typeof SignalEntrySchema>;

/**
 * Extracts the enum values from a table, preserving the literal union rather
 * than widening to `string`. That preservation is what lets a `switch` over
 * the labels be exhaustive at compile time.
 */
export const labelsOf = <T extends readonly { label: string }[]>(
  table: T,
): [T[number]['label'], ...T[number]['label'][]] =>
  table.map((entry) => entry.label) as [T[number]['label'], ...T[number]['label'][]];

/** Renders a table into the guidance block that becomes a field description. */
export const renderGuidance = (table: readonly (GuidanceEntry & { name?: string })[]): string =>
  table
    .map(
      (entry) =>
        `${entry.label}${entry.name === undefined ? '' : ` (${entry.name})`} — ` +
        `${entry.description} When to use: ${entry.analysisInstruction}`,
    )
    .join('\n');
