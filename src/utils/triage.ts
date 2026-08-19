import { ACCOUNT_GUIDANCE } from './category.ts';
import { accountFor } from './category.schema.ts';
import { HISTORY_SUPPORT, MISSING_INFORMATION, PERSONAL_RISK, PURPOSE_CLARITY } from './signal.ts';
import { signalEntry } from './signal.schema.ts';
import { isCashWithdrawal, isPersonalVipps } from './transaction.ts';
import { type Triage, type TriageDecision, type TriageInputs } from './triage.schema.ts';

/**
 * The triage decision — all code, all deterministic.
 *
 * The model reported observations; this derivation turns them into the
 * decision by reading the policy flags on the guidance tables and applying
 * the ordered overrides. Why not ask the model: the automation rate becomes a
 * dial rather than a prompt-wording accident, the policy is testable without
 * an endpoint, and every decision can be audited after the fact.
 */

const RANK: Record<Triage, number> = {
  'auto-approve': 0,
  'accountant-review': 1,
  'owner-question': 2,
};

const atLeast = (current: Triage, floor: Triage): Triage =>
  RANK[floor] > RANK[current] ? floor : current;

export const decideTriage = (inputs: TriageInputs): TriageDecision => {
  const { classification, transaction } = inputs;
  const account = accountFor(classification.category_code);

  const history = signalEntry(HISTORY_SUPPORT, classification.history_support);
  const purpose = signalEntry(PURPOSE_CLARITY, classification.purpose_clarity);
  const personal = signalEntry(PERSONAL_RISK, classification.personal_risk);
  const missing = signalEntry(MISSING_INFORMATION, classification.missing_information);
  const signals = [
    { field: 'history_support', entry: history },
    { field: 'purpose_clarity', entry: purpose },
    { field: 'personal_risk', entry: personal },
    { field: 'missing_information', entry: missing },
  ];

  // The base decision: auto-approve is the conjunction of every gate, and
  // anything short of it defaults to a human eyeballing the row.
  const blocking = signals.filter(({ entry }) => entry.blocksAutoApprove);
  const gates: { passed: boolean; whenFailed: string }[] = [
    {
      passed: history.supportsAutoApprove || account.historyExempt,
      whenFailed: `history support ${history.label} does not carry auto-approve`,
    },
    {
      passed: blocking.length === 0,
      whenFailed: `${blocking.map(({ field, entry }) => `${field}=${entry.label}`).join(', ')} blocks auto-approve`,
    },
    {
      passed: classification.missing_information === 'NONE',
      whenFailed: `missing information: ${classification.missing_information}`,
    },
    {
      passed: classification.confidence === 'HIGH',
      whenFailed: `confidence is ${classification.confidence}`,
    },
    {
      passed: !account.neverAutoApprove,
      whenFailed: `${account.label} is never auto-approved`,
    },
  ];
  const failedGate = gates.find((gate) => !gate.passed);
  let triage: Triage = failedGate === undefined ? 'auto-approve' : 'accountant-review';
  let reason =
    failedGate === undefined
      ? 'Recurring history, clear purpose, nothing missing, high confidence.'
      : failedGate.whenFailed;

  // The ordered overrides. Each records itself; the FIRST to actually raise
  // the decision supplies the headline reason.
  const rules: string[] = [];
  const apply = (label: string, floor: Triage, detail: string): void => {
    rules.push(label);
    const raised = atLeast(triage, floor);
    if (raised !== triage) {
      triage = raised;
      reason = detail;
    }
  };

  if (account.alwaysAsk) {
    apply(
      'ACCOUNT_ALWAYS_ASK',
      'owner-question',
      `The chart of accounts pairs ${account.label} with asking the owner.`,
    );
  }
  const asking = signals.filter(({ entry }) => entry.asksOwner);
  if (asking.length > 0) {
    apply(
      'SIGNAL_ASKS_OWNER',
      'owner-question',
      `Only the owner can resolve ${asking
        .map(({ field, entry }) => `${field}=${entry.label}`)
        .join(', ')}.`,
    );
  }
  if (isCashWithdrawal(transaction) || isPersonalVipps(transaction)) {
    apply(
      'CASH_OR_PERSONAL_P2P',
      'owner-question',
      'Cash withdrawals and payments to private persons always need the owner to state the purpose.',
    );
  }
  if (account.neverAutoApprove) {
    apply(
      'ACCOUNT_NEVER_AUTO',
      'accountant-review',
      `${account.label} may never be posted without a human seeing it.`,
    );
  }
  if (
    Math.abs(transaction.amount_nok) >= inputs.materiality_nok &&
    classification.history_support !== 'EXACT_RECURRING' &&
    // Materiality asks for a recurring pattern an internal transfer can never
    // have — the exemption that waives the history gate waives this too.
    !account.historyExempt
  ) {
    apply(
      'MATERIALITY',
      'accountant-review',
      `|${transaction.amount_nok}| NOK meets the ${inputs.materiality_nok} NOK materiality ` +
        'threshold without an exact recurring history.',
    );
  }
  if (inputs.amount_outside_pattern) {
    apply(
      'AMOUNT_OUTSIDE_PATTERN',
      'accountant-review',
      `|${transaction.amount_nok}| NOK is more than twice this counterparty's largest prior ` +
        'amount — the recurring pattern vouches for its amounts, not for this one.',
    );
  }
  if (transaction.currency !== 'NOK') {
    apply(
      'FOREIGN_CURRENCY',
      'accountant-review',
      `Currency ${transaction.currency}: the FX context needs a human check.`,
    );
  }
  if (inputs.tool_call_missing || inputs.unresolved_issue_count > 0) {
    apply(
      'SYSTEM_DOUBT',
      'accountant-review',
      inputs.tool_call_missing
        ? 'The model never consulted the history itself; code had to inject the lookup.'
        : `${inputs.unresolved_issue_count} cross-check contradiction(s) remain unresolved.`,
    );
  }

  return { triage, reason, rules };
};

/**
 * The derivation printed as data — computed from the live tables rather than
 * quoted from documentation, so it cannot drift. Runs without an endpoint.
 */
export const explainTriage = (materialityNok: number): string => {
  const lines: string[] = [];

  lines.push('Base decision (all gates must pass for auto-approve):');
  lines.push('  history_support carries auto-approve (waived for history-exempt accounts)');
  lines.push('  no signal blocks auto-approve');
  lines.push('  missing_information = NONE');
  lines.push('  confidence = HIGH');
  lines.push('  account is not flagged never-auto-approve');
  lines.push('Anything short of that: accountant-review, unless a rule below asks the owner.');
  lines.push('');

  lines.push('Signal policy (from the tables in signal.ts — flags the model never sees):');
  const tables = [
    ['history_support', HISTORY_SUPPORT],
    ['purpose_clarity', PURPOSE_CLARITY],
    ['personal_risk', PERSONAL_RISK],
    ['missing_information', MISSING_INFORMATION],
  ] as const;
  for (const [name, table] of tables) {
    lines.push(`  ${name}`);
    for (const entry of table) {
      const flags = [
        entry.supportsAutoApprove ? 'supports-auto' : '',
        entry.blocksAutoApprove ? 'blocks-auto' : '',
        entry.asksOwner ? 'asks-owner' : '',
      ]
        .filter((flag) => flag !== '')
        .join(', ');
      lines.push(`    ${entry.label.padEnd(28)} ${flags === '' ? '-' : flags}`);
    }
  }
  lines.push('');

  lines.push('Account policy (from category.ts):');
  for (const entry of ACCOUNT_GUIDANCE) {
    if (!entry.neverAutoApprove && !entry.alwaysAsk && !entry.historyExempt) continue;
    const flags = [
      entry.neverAutoApprove ? 'never-auto-approve' : '',
      entry.alwaysAsk ? 'always-ask-owner' : '',
      entry.historyExempt ? 'history-exempt' : '',
    ]
      .filter((flag) => flag !== '')
      .join(', ');
    lines.push(`  ${entry.label.padEnd(24)} ${flags}`);
  }
  lines.push('');

  lines.push('Ordered overrides (first to raise the decision names itself in triage_reason):');
  lines.push('  1 ACCOUNT_ALWAYS_ASK      -> owner-question');
  lines.push('  2 SIGNAL_ASKS_OWNER       -> owner-question');
  lines.push(
    '  3 CASH_OR_PERSONAL_P2P    -> owner-question   (MINIBANK/Kontantuttak, VIPPS <person>)',
  );
  lines.push('  4 ACCOUNT_NEVER_AUTO      -> at least accountant-review');
  lines.push(
    `  5 MATERIALITY             -> at least accountant-review   (|amount| >= ${materialityNok} NOK` +
      ' without EXACT_RECURRING; waived for history-exempt accounts)',
  );
  lines.push(
    '  6 AMOUNT_OUTSIDE_PATTERN  -> at least accountant-review   (|amount| > 2x largest own-history amount)',
  );
  lines.push('  7 FOREIGN_CURRENCY        -> at least accountant-review');
  lines.push(
    '  8 SYSTEM_DOUBT            -> at least accountant-review   (injected lookup or unresolved cross-check)',
  );

  return lines.join('\n');
};
