import { type AccountEntry } from './guidance.schema.ts';
import { prose } from './text.ts';

/**
 * The chart of accounts as a guidance table.
 *
 * This is the single source of the `category_code` enum, of the guidance text
 * the model reads for each code, and of the policy flags the triage derivation
 * reads (`sign`, `neverAutoApprove`, `alwaysAsk`). The `satisfies` check makes
 * an account added without an `analysisInstruction` a compile error.
 *
 * `chart-of-accounts.json` stays the shipped input; `category.schema.ts`
 * asserts at startup that its codes and this table's labels are the same set,
 * so the duplication fails loudly at boot rather than silently at runtime.
 *
 * To change how a category is assigned, edit its entry here. To change what
 * may be auto-approved, edit the flags — the model never sees them.
 */

export const ACCOUNT_GUIDANCE = [
  {
    label: 'salary',
    name: 'Salary',
    description: 'Wages paid to employees, including the owner if on payroll.',
    analysisInstruction: prose`
      A payment to a person's name with a description like Lønn, matching that person's cadence and
      amount in history. Always money out. The same person can legitimately receive both salary and
      an owner draw — the description decides, not the name: Lønn is salary even when paid to the
      owner, Privat is owner_draw even when paid to someone on payroll.
    `,
    sign: 'money_out',
    neverAutoApprove: false,
    alwaysAsk: false,
    historyExempt: false,
  },
  {
    label: 'salary_tax',
    name: 'Salary withholding tax',
    description: 'Forskuddstrekk paid to Skatteetaten on behalf of employees.',
    analysisInstruction: prose`
      Skatteetaten is three different accounts and the counterparty cannot tell them apart — only
      the description can. Use this one when the description says Forskuddstrekk or skattetrekk.
      Arbeidsgiveravgift is employer_tax; MVA or merverdiavgift is vat_payment. If the description
      names none of the three, do not guess between them.
    `,
    sign: 'money_out',
    neverAutoApprove: false,
    alwaysAsk: false,
    historyExempt: false,
  },
  {
    label: 'employer_tax',
    name: "Employer's contribution",
    description: 'Arbeidsgiveravgift paid to Skatteetaten.',
    analysisInstruction: prose`
      Only when the description says Arbeidsgiveravgift. The counterparty being Skatteetaten is not
      enough — Forskuddstrekk is salary_tax and MVA is vat_payment.
    `,
    sign: 'money_out',
    neverAutoApprove: false,
    alwaysAsk: false,
    historyExempt: false,
  },
  {
    label: 'vat_payment',
    name: 'VAT payment',
    description: 'Merverdiavgift (MVA) paid to or refunded from Skatteetaten.',
    analysisInstruction: prose`
      Only when the description says MVA or merverdiavgift. Refunds arrive as positive amounts — a
      positive Skatteetaten MVA row is still vat_payment, never customer_payment.
    `,
    sign: 'either',
    neverAutoApprove: false,
    alwaysAsk: false,
    historyExempt: false,
  },
  {
    label: 'rent',
    name: 'Office rent',
    description: 'Rent for office or workspace.',
    analysisInstruction: prose`
      Husleie to a property company (Eiendom in the name is a strong cue), recurring monthly at an
      identical amount.
    `,
    sign: 'money_out',
    neverAutoApprove: false,
    alwaysAsk: false,
    historyExempt: false,
  },
  {
    label: 'utilities',
    name: 'Utilities',
    description: 'Electricity, internet, mobile, water.',
    analysisInstruction: prose`
      Strøm, internett or mobilabonnement from a known utility or telecom (Fjordkraft, Tibber,
      Telenor, Telia). Recurring, though electricity varies by season.
    `,
    sign: 'money_out',
    neverAutoApprove: false,
    alwaysAsk: false,
    historyExempt: false,
  },
  {
    label: 'software',
    name: 'Software & SaaS',
    description: 'Subscriptions to software tools (e.g. Figma, Slack, AWS, GitHub).',
    analysisInstruction: prose`
      A named software vendor or cloud provider, usually a small recurring card charge. A bare
      "Subscription" from an unfamiliar merchant is not automatically software — check the history,
      and if the merchant could as easily be a consumer service, say so rather than defaulting
      here.
    `,
    sign: 'money_out',
    neverAutoApprove: false,
    alwaysAsk: false,
    historyExempt: false,
  },
  {
    label: 'hardware',
    name: 'Hardware & equipment',
    description: 'Computers, monitors, phones, office equipment.',
    analysisInstruction: prose`
      Datautstyr or elektronikk from an electronics retailer (Power, Elkjøp, Apple Store). One-off
      amounts rather than subscriptions.
    `,
    sign: 'money_out',
    neverAutoApprove: false,
    alwaysAsk: false,
    historyExempt: false,
  },
  {
    label: 'travel',
    name: 'Travel & lodging',
    description: 'Flights, trains, hotels, taxis on business trips.',
    analysisInstruction: prose`
      Airlines, rail, hotels and ride-hailing (SAS, Norwegian, Vy, Scandic, Bolt/Uber, Airbnb).
      Whether the trip might be private is personal-risk's question, not a reason to change the
      category.
    `,
    sign: 'money_out',
    neverAutoApprove: false,
    alwaysAsk: false,
    historyExempt: false,
  },
  {
    label: 'meals',
    name: 'Meals & entertainment',
    description: 'Client dinners, team lunches, coffee meetings.',
    analysisInstruction: prose`
      Restaurants, cafés and coffee shops — Kundemiddag and Lunsj are strong cues. Grocery stores
      (Dagligvarer) and bakeries do NOT belong here by default: bank data cannot show whether that
      was office catering or a private shop, so those rows are uncertain unless history proves a
      pattern.
    `,
    sign: 'money_out',
    neverAutoApprove: false,
    alwaysAsk: false,
    historyExempt: false,
  },
  {
    label: 'office_supplies',
    name: 'Office supplies',
    description: 'Stationery, pens, printer ink, kitchen supplies.',
    analysisInstruction: prose`
      Consumables for the office, small amounts. Electronics belong in hardware, groceries are not
      automatically kitchen supplies.
    `,
    sign: 'money_out',
    neverAutoApprove: false,
    alwaysAsk: false,
    historyExempt: false,
  },
  {
    label: 'marketing',
    name: 'Marketing & advertising',
    description: 'Ads, sponsorships, promotional materials, events.',
    analysisInstruction: prose`
      Ad platforms and campaigns — Meta, Google Ads, LinkedIn, Annonsering. Amounts vary month to
      month; the counterparty is the signal, not the amount.
    `,
    sign: 'money_out',
    neverAutoApprove: false,
    alwaysAsk: false,
    historyExempt: false,
  },
  {
    label: 'professional_services',
    name: 'Professional services',
    description: 'Lawyers, accountants, consultants, freelancers (with invoice).',
    analysisInstruction: prose`
      A named firm — Advokat, Konsulent, revisor (e.g. law firms, PwC). Large invoiced amounts are
      normal here; an unfamiliar firm with only a bare invoice number is supplier_invoice instead.
    `,
    sign: 'money_out',
    neverAutoApprove: false,
    alwaysAsk: false,
    historyExempt: false,
  },
  {
    label: 'bank_fees',
    name: 'Bank fees & interest',
    description: 'Account fees, card fees, interest charges.',
    analysisInstruction: prose`
      Small charges from the bank itself — Kortgebyr, kontogebyr, renter. The counterparty is a
      bank and the amount is small and recurring.
    `,
    sign: 'money_out',
    neverAutoApprove: false,
    alwaysAsk: false,
    historyExempt: false,
  },
  {
    label: 'insurance',
    name: 'Insurance',
    description: 'Business insurance premiums.',
    analysisInstruction: prose`
      Forsikring from an insurer (e.g. Storebrand), typically a recurring premium. Personal
      insurance products would be personal_expense, but assume business unless something says
      otherwise.
    `,
    sign: 'money_out',
    neverAutoApprove: false,
    alwaysAsk: false,
    historyExempt: false,
  },
  {
    label: 'supplier_invoice',
    name: 'Supplier invoice (uncategorized)',
    description:
      "Generic supplier payment — use when the supplier is known but category isn't clear yet.",
    analysisInstruction: prose`
      A named business counterparty with an invoice reference (Faktura) but no history and no
      category the description can pin down. International transfers via Wise to a foreign supplier
      usually land here. This is a holding category: it is correct precisely because the real
      category is not yet knowable, so it always goes past an accountant.
    `,
    sign: 'money_out',
    neverAutoApprove: true,
    alwaysAsk: false,
    historyExempt: false,
  },
  {
    label: 'customer_payment',
    name: 'Customer payment received',
    description: 'Incoming payment from a customer for an invoice.',
    analysisInstruction: prose`
      A positive amount from a known customer, usually with a Faktura reference. Positive amount is
      necessary but not sufficient: money arriving from the business's own account (Egen konto) is
      transfer, and a Skatteetaten refund is vat_payment.
    `,
    sign: 'money_in',
    neverAutoApprove: false,
    alwaysAsk: false,
    historyExempt: false,
  },
  {
    label: 'owner_draw',
    name: 'Owner draw / capital',
    description: 'Money moved between the business and the owner personally (not salary).',
    analysisInstruction: prose`
      A transfer to or from the owner as a person — Privat in the description is the cue. Not
      salary: Lønn is salary even for the owner. Goes both directions, since the owner can also put
      capital in.
    `,
    sign: 'either',
    neverAutoApprove: true,
    alwaysAsk: false,
    historyExempt: false,
  },
  {
    label: 'loan_transfer',
    name: 'Loan / financing',
    description: 'Loan disbursement or repayment, including credit lines.',
    analysisInstruction: prose`
      Payments to or from a lender — lån, nedbetaling, kreditt. Rare enough that history will not
      help; the counterparty being a bank is not sufficient, since bank_fees also come from banks.
    `,
    sign: 'either',
    neverAutoApprove: true,
    alwaysAsk: false,
    historyExempt: false,
  },
  {
    label: 'transfer',
    name: 'Internal transfer',
    description: "Money moved between the business's own accounts. Not income or expense.",
    analysisInstruction: prose`
      Overføring with Egen konto or the business's own account number in the description. Must
      never be categorized as a payment received, however positive the amount — an internal
      transfer booked as income overstates revenue.
    `,
    sign: 'either',
    neverAutoApprove: false,
    alwaysAsk: false,
    // Internal transfers have no history by nature; when the description says
    // Egen konto and every other gate passes, that emptiness is not doubt.
    historyExempt: true,
  },
  {
    label: 'personal_expense',
    name: 'Personal expense (to flag)',
    description: "Looks personal, not business. Use only if you're confident.",
    analysisInstruction: prose`
      A consumer service with no plausible business purpose — streaming (Netflix), a gym
      membership (Treningssenter). Use only when confident it is personal; a row that is merely
      ambiguous is uncertain, not personal_expense.
    `,
    sign: 'money_out',
    neverAutoApprove: true,
    alwaysAsk: false,
    historyExempt: false,
  },
  {
    label: 'uncertain',
    name: 'Uncertain',
    description:
      "You couldn't confidently assign a category. Always pair with owner-question triage.",
    analysisInstruction: prose`
      Use when the bank data alone cannot decide between two or more accounts and no history
      resolves it. This is not a failure — it is the correct answer for a personal-name Vipps with
      no context, a cash withdrawal (Kontantuttak/MINIBANK), or a grocery store with no
      established pattern. Never pair it with HIGH confidence.
    `,
    sign: 'either',
    neverAutoApprove: true,
    alwaysAsk: true,
    historyExempt: false,
  },
] as const satisfies readonly AccountEntry[];
