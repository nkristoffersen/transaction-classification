import { type SignalEntry } from './guidance.schema.ts';
import { prose } from './text.ts';

/**
 * The four signal tables — what the model reports instead of a triage label.
 *
 * Each entry carries the guidance the model reads (description +
 * analysisInstruction) and the policy flags it never sees
 * (`supportsAutoApprove`, `blocksAutoApprove`, `asksOwner`). `triage.ts` reads
 * the flags, so the automation policy is a column in these tables rather than
 * a chain of conditionals, and changing it is an edit to one boolean.
 */

/** What the transaction history says about this exact situation. */
export const HISTORY_SUPPORT = [
  {
    label: 'EXACT_RECURRING',
    description: 'The same counterparty appears repeatedly with one category, and this row fits.',
    analysisInstruction: prose`
      Use when search_history shows this counterparty at least three times with a single category
      and a regular cadence, and this transaction matches the pattern in description and rough
      amount. A counterparty with several categories (like Skatteetaten) is only EXACT_RECURRING
      when the description pins which pattern this row belongs to.
    `,
    supportsAutoApprove: true,
    blocksAutoApprove: false,
    asksOwner: false,
  },
  {
    label: 'EXACT_ONE_OFF',
    description: 'The counterparty has appeared before, once or twice, with one category.',
    analysisInstruction: prose`
      Use when the tool found the counterparty once or twice, in a single category that fits this
      row. Thin evidence is still evidence — but it is not a recurring pattern.
    `,
    supportsAutoApprove: true,
    blocksAutoApprove: false,
    asksOwner: false,
  },
  {
    label: 'SIMILAR_COUNTERPARTY',
    description: 'No exact match, but history has a same-kind merchant with a fitting category.',
    analysisInstruction: prose`
      Use when this exact counterparty is new but history holds a clearly comparable one — another
      hotel, another airline, another ad platform — whose category this row would share. Name the
      comparable counterparty in the evidence.
    `,
    supportsAutoApprove: false,
    blocksAutoApprove: false,
    asksOwner: false,
  },
  {
    label: 'CATEGORY_PATTERN_ONLY',
    description: 'Only the description maps to a known pattern; no comparable counterparty.',
    analysisInstruction: prose`
      Use when the description matches how a category is used in history (e.g. Flyreise) but no
      exact or similar counterparty exists. The weakest form of support that is still support.
    `,
    supportsAutoApprove: false,
    blocksAutoApprove: false,
    asksOwner: false,
  },
  {
    label: 'NONE',
    description: 'No prior transactions and nothing comparable.',
    analysisInstruction: prose`
      Use when search_history returned no prior for the counterparty and nothing in history is
      genuinely comparable. This is the normal answer for transfers, owner draws and one-off
      suppliers — say it plainly rather than stretching a weak analogy.
    `,
    supportsAutoApprove: false,
    blocksAutoApprove: false,
    asksOwner: false,
  },
] as const satisfies readonly SignalEntry[];

/** How clearly the bank data states what the money was for. */
export const PURPOSE_CLARITY = [
  {
    label: 'UNAMBIGUOUS',
    description: 'Counterparty and description leave one plausible account.',
    analysisInstruction: prose`
      Use when no second account is a serious candidate — Husleie kontor from a property company,
      Kortgebyr from the bank.
    `,
    supportsAutoApprove: false,
    blocksAutoApprove: false,
    asksOwner: false,
  },
  {
    label: 'INFERRED_FROM_PATTERN',
    description: 'The row alone would be ambiguous; the history pattern resolves it.',
    analysisInstruction: prose`
      Use when the description is generic (Subscription, Faktura) but the counterparty's history
      settles the account. The inference must be stated in the reasoning.
    `,
    supportsAutoApprove: false,
    blocksAutoApprove: false,
    asksOwner: false,
  },
  {
    label: 'AMBIGUOUS_BETWEEN_ACCOUNTS',
    description: 'Two or more accounts remain plausible; choosing needs accounting judgement.',
    analysisInstruction: prose`
      Use when the candidates are real and picking one is a judgement call an accountant can make
      without asking the owner — name every candidate in the reasoning. If only the owner could
      know, that is UNKNOWABLE_FROM_BANK_DATA instead.
    `,
    supportsAutoApprove: false,
    blocksAutoApprove: true,
    asksOwner: false,
  },
  {
    label: 'UNKNOWABLE_FROM_BANK_DATA',
    description: 'Only the owner can say what this was — no bank data or judgement can.',
    analysisInstruction: prose`
      Use for the rows where the missing fact lives with the owner: what cash was for, whether a
      grocery run fed the office or a household, who a personal-name Vipps paid and why.
    `,
    supportsAutoApprove: false,
    blocksAutoApprove: true,
    asksOwner: true,
  },
] as const satisfies readonly SignalEntry[];

/** Whether this row could be private spending rather than business. */
export const PERSONAL_RISK = [
  {
    label: 'NONE',
    description: 'Nothing suggests private spending.',
    analysisInstruction: prose`
      Use for clearly business-shaped rows: invoiced suppliers, taxes, payroll, established
      recurring vendors.
    `,
    supportsAutoApprove: false,
    blocksAutoApprove: false,
    asksOwner: false,
  },
  {
    label: 'PLAUSIBLY_PERSONAL',
    description: 'Could be private, but a business reading exists.',
    analysisInstruction: prose`
      Use when the merchant serves both lives — groceries, a bakery, a weekend-dated flight — and
      the business reading is plausible but unproven.
    `,
    supportsAutoApprove: false,
    blocksAutoApprove: true,
    asksOwner: false,
  },
  {
    label: 'LIKELY_PERSONAL',
    description: 'Reads as private spending.',
    analysisInstruction: prose`
      Use for consumer services with no plausible business purpose — streaming, a gym. Pair with
      personal_expense when confident; the accountant rejects it from there.
    `,
    supportsAutoApprove: false,
    blocksAutoApprove: true,
    asksOwner: false,
  },
] as const satisfies readonly SignalEntry[];

/** What is missing before this row could be posted. */
export const MISSING_INFORMATION = [
  {
    label: 'NONE',
    description: 'Nothing further is needed.',
    analysisInstruction: prose`
      Use when the row can be posted as categorized, with no document or answer outstanding.
    `,
    supportsAutoApprove: false,
    blocksAutoApprove: false,
    asksOwner: false,
  },
  {
    label: 'NEEDS_RECEIPT',
    description: 'A receipt must be attached; the category itself is clear.',
    analysisInstruction: prose`
      Use when the category is settled but bookkeeping needs the receipt on file — typical for card
      purchases of equipment or supplies.
    `,
    supportsAutoApprove: false,
    blocksAutoApprove: true,
    asksOwner: false,
  },
  {
    label: 'NEEDS_PURPOSE',
    description: 'Cannot post without knowing what the money was for.',
    analysisInstruction: prose`
      Use for cash withdrawals and personal-name payments where the purpose is the missing fact —
      the owner has to answer before any category can stand.
    `,
    supportsAutoApprove: false,
    blocksAutoApprove: true,
    asksOwner: true,
  },
  {
    label: 'NEEDS_ATTENDEES',
    description: 'A meal needs who attended and in what context.',
    analysisInstruction: prose`
      Use when a restaurant row is plausibly a client or team meal but compliance needs the
      attendees and occasion recorded.
    `,
    supportsAutoApprove: false,
    blocksAutoApprove: true,
    asksOwner: true,
  },
  {
    label: 'NEEDS_INVOICE',
    description: 'The underlying invoice must be found and verified.',
    analysisInstruction: prose`
      Use for supplier payments referencing an invoice that is not in hand — international
      transfers via Wise are the standing example.
    `,
    supportsAutoApprove: false,
    blocksAutoApprove: true,
    asksOwner: false,
  },
  {
    label: 'NEEDS_ACCOUNT_OWNERSHIP',
    description: 'Must know whose account the counterpart is.',
    analysisInstruction: prose`
      Use when the row is a transfer and the classification hinges on whether the receiving or
      sending account belongs to the business, the owner, or a third party.
    `,
    supportsAutoApprove: false,
    blocksAutoApprove: true,
    asksOwner: true,
  },
] as const satisfies readonly SignalEntry[];
