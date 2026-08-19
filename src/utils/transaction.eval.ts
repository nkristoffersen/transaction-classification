import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { classifyBatch } from './classification.ts';
import { loadEnv } from './env.ts';
import { type Env } from './env.schema.ts';
import { GoldFileSchema, ReportSchema, type GoldRow, type Report } from './eval.schema.ts';
import { buildHistoryIndex, loadHistory } from './history.ts';
import { ClassifierClient } from './llm.ts';
import { type Failure, type Outcome } from './output.schema.ts';
import { draftOwnerQuestions } from './question.ts';
import { type OwnerQuestionGroup } from './question.schema.ts';
import { loadTransactions } from './transaction.ts';
import { type Transaction } from './transaction.schema.ts';
import { type Triage } from './triage.schema.ts';
import { formatZodError } from './zod.ts';

/**
 * The measurement report: the real pipeline, a real model, judged against the
 * gold set — the deliverable behind "show that it works".
 *
 * Tests prove the machinery against a stub; this asks the question a stub
 * cannot answer: given a real model, is the triage any good? It calls the
 * endpoint for real, so it is a separate suite (vitest.eval.config.ts), skips
 * when no endpoint is configured, and writes its evidence to report.md +
 * report.json rather than reducing to one pass/fail.
 *
 * Knobs: EVAL_ONLY=t-00038,... for a quick smoke; EVAL_REPEAT=2 to measure
 * run-to-run agreement; EVAL_MIN_PRECISION / EVAL_MAX_DANGEROUS to tune the
 * graded gates; EVAL_PRICE_IN / EVAL_PRICE_OUT (USD per 1M tokens) for cost.
 */

const evalsConfigured = (source: NodeJS.ProcessEnv = process.env): boolean => {
  if (source['EVAL'] === 'false') return false;
  const hasKey = (source['LLM_API_KEY'] ?? '').trim() !== '';
  const base = (source['LLM_BASE_URL'] ?? '').trim();
  // A local endpoint needs no key; a hosted one does.
  const isLocal = /localhost|127\.0\.0\.1|0\.0\.0\.0|host\.docker\.internal/.test(base);
  return hasKey || (isLocal && base !== '');
};

const percentile = (values: number[], fraction: number): number => {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.ceil(fraction * sorted.length) - 1);
  return sorted[Math.max(0, index)] ?? 0;
};

const rate = (numerator: number, denominator: number): number | null =>
  denominator === 0 ? null : numerator / denominator;

const TRIAGES: Triage[] = ['auto-approve', 'accountant-review', 'owner-question'];

const cellCost = (gold: Triage, system: Triage): Report['triage_matrix'][number]['cost'] => {
  if (gold === system) return 'agreement';
  if (system === 'auto-approve') return 'silent-error';
  if (system === 'owner-question') return 'wasted-owner-time';
  return 'harmless-caution';
};

interface Judged {
  outcome: Outcome;
  gold: GoldRow;
  categoryMatch: boolean;
  triageMatch: boolean;
}

const buildReport = (options: {
  env: Env;
  outcomes: Outcome[];
  failures: Failure[];
  gold: GoldRow[];
  questions: OwnerQuestionGroup[];
  repeat: Outcome[] | null;
  generatedAt: string;
}): Report => {
  const { env, outcomes, failures, gold, questions, repeat, generatedAt } = options;
  const goldById = new Map(gold.map((row) => [row.transaction_id, row]));

  const judged: Judged[] = outcomes.flatMap((outcome) => {
    const row = goldById.get(outcome.transaction.id);
    if (row === undefined) return [];
    return [
      {
        outcome,
        gold: row,
        categoryMatch: outcome.classification.category_code === row.expected_category,
        triageMatch: outcome.triage.triage === row.expected_triage,
      },
    ];
  });

  // 1-2: the headline. Of the rows the system would post unreviewed, how many
  // does gold agree with — and each one it would post wrongly, by name.
  const autoRows = judged.filter((entry) => entry.outcome.triage.triage === 'auto-approve');
  const autoCorrect = autoRows.filter((entry) => entry.categoryMatch && entry.triageMatch);
  const dangerous = autoRows
    .filter((entry) => entry.gold.expected_triage !== 'auto-approve')
    .map((entry) => ({
      transaction_id: entry.outcome.transaction.id,
      system_category: entry.outcome.classification.category_code,
      gold_category: entry.gold.expected_category,
      gold_triage: entry.gold.expected_triage,
      gold_reasoning: entry.gold.reasoning,
      contested: entry.gold.contested,
    }));

  // 3: the 3x3, cells labelled by what they cost.
  const matrixCounts = new Map<string, number>();
  for (const entry of judged) {
    const key = `${entry.gold.expected_triage}|${entry.outcome.triage.triage}`;
    matrixCounts.set(key, (matrixCounts.get(key) ?? 0) + 1);
  }
  const triage_matrix = TRIAGES.flatMap((goldTriage) =>
    TRIAGES.flatMap((systemTriage) => {
      const count = matrixCounts.get(`${goldTriage}|${systemTriage}`) ?? 0;
      if (count === 0) return [];
      return [
        {
          gold: goldTriage,
          system: systemTriage,
          count,
          cost: cellCost(goldTriage, systemTriage),
        },
      ];
    }),
  );

  // 5: category accuracy, split by gold source so my own labels cannot
  // flatter the system, plus the confusion pairs that actually occurred.
  const by_source = (['provided', 'added', 'synthetic'] as const).map((source) => {
    const rows = judged.filter((entry) => entry.gold.source === source);
    return {
      source,
      rows: rows.length,
      category_accuracy: rate(rows.filter((entry) => entry.categoryMatch).length, rows.length),
      triage_accuracy: rate(rows.filter((entry) => entry.triageMatch).length, rows.length),
    };
  });
  const confusionCounts = new Map<string, { count: number; allContested: boolean }>();
  for (const entry of judged) {
    if (entry.categoryMatch) continue;
    const key = `${entry.gold.expected_category}|${entry.outcome.classification.category_code}`;
    const existing = confusionCounts.get(key) ?? { count: 0, allContested: true };
    confusionCounts.set(key, {
      count: existing.count + 1,
      allContested: existing.allContested && entry.gold.contested,
    });
  }
  const confusion_pairs = [...confusionCounts.entries()]
    .sort((a, b) => b[1].count - a[1].count)
    .map(([key, value]) => {
      const [goldCategory, systemCategory] = key.split('|');
      return {
        gold: goldCategory as GoldRow['expected_category'],
        system: systemCategory as GoldRow['expected_category'],
        count: value.count,
        contested_only: value.allContested,
      };
    });

  // 6: is the confidence field information or decoration?
  const confidence_calibration = (['HIGH', 'MEDIUM', 'LOW'] as const).map((confidence) => {
    const rows = judged.filter((entry) => entry.outcome.classification.confidence === confidence);
    return {
      confidence,
      rows: rows.length,
      category_accuracy: rate(rows.filter((entry) => entry.categoryMatch).length, rows.length),
    };
  });

  // 8: tool health — the numbers that say whether the tool design survives
  // this model.
  const repairCounts = new Map<number, number>();
  for (const outcome of outcomes) {
    repairCounts.set(outcome.repair_attempts, (repairCounts.get(outcome.repair_attempts) ?? 0) + 1);
  }
  const callsTotal = outcomes.reduce(
    (sum, outcome) => sum + outcome.tool_calls.filter((record) => !record.injected).length,
    0,
  );

  // 9: cost and latency.
  const tokensIn = outcomes.reduce((sum, outcome) => sum + outcome.tokens_in, 0);
  const tokensOut = outcomes.reduce((sum, outcome) => sum + outcome.tokens_out, 0);
  const priceIn = Number(process.env['EVAL_PRICE_IN'] ?? '');
  const priceOut = Number(process.env['EVAL_PRICE_OUT'] ?? '');
  const durations = outcomes.map((outcome) => outcome.duration_ms);

  // 10: run-to-run agreement, when a repeat run was requested.
  let determinism: Report['determinism'] = null;
  if (repeat !== null) {
    const second = new Map(repeat.map((outcome) => [outcome.transaction.id, outcome]));
    const paired = outcomes.flatMap((outcome) => {
      const other = second.get(outcome.transaction.id);
      return other === undefined ? [] : [{ first: outcome, other }];
    });
    determinism = {
      runs: 2,
      category_agreement:
        rate(
          paired.filter(
            (pair) =>
              pair.first.classification.category_code === pair.other.classification.category_code,
          ).length,
          paired.length,
        ) ?? 1,
      triage_agreement:
        rate(
          paired.filter((pair) => pair.first.triage.triage === pair.other.triage.triage).length,
          paired.length,
        ) ?? 1,
    };
  }

  const ownerRows = outcomes.filter((outcome) => outcome.triage.triage === 'owner-question');

  return {
    generated_at: generatedAt,
    model: env.LLM_MODEL,
    transactions_classified: outcomes.length,
    failures: failures.length,
    headline: {
      automation_rate: outcomes.length === 0 ? 0 : autoRows.length / outcomes.length,
      auto_approve_precision: rate(autoCorrect.length, autoRows.length),
      dangerous_misses: dangerous,
    },
    triage_matrix,
    category: {
      accuracy_overall: rate(judged.filter((entry) => entry.categoryMatch).length, judged.length),
      by_source,
      confusion_pairs,
    },
    confidence_calibration,
    questions: {
      owner_question_rows: ownerRows.length,
      groups: questions.length,
      fallback_groups: questions.filter((group) => group.group_id.startsWith('q-fallback-')).length,
      drafted: questions,
    },
    tool_health: {
      calls_total: callsTotal,
      calls_per_transaction: outcomes.length === 0 ? 0 : callsTotal / outcomes.length,
      injected_lookups: outcomes.filter((outcome) => outcome.tool_call_missing).length,
      repair_round_counts: [...repairCounts.entries()]
        .sort((a, b) => a[0] - b[0])
        .map(([rounds, transactions]) => ({ rounds, transactions })),
      unresolved_after_budget: outcomes.filter((outcome) => outcome.unresolved_issues.length > 0)
        .length,
    },
    cost_latency: {
      tokens_in: tokensIn,
      tokens_out: tokensOut,
      estimated_cost_usd:
        Number.isFinite(priceIn) && Number.isFinite(priceOut) && (priceIn > 0 || priceOut > 0)
          ? (tokensIn / 1_000_000) * priceIn + (tokensOut / 1_000_000) * priceOut
          : null,
      latency_p50_ms: percentile(durations, 0.5),
      latency_p95_ms: percentile(durations, 0.95),
    },
    determinism,
  };
};

const pct = (value: number | null): string =>
  value === null ? 'n/a' : `${(value * 100).toFixed(0)}%`;

const renderMarkdown = (report: Report): string => {
  const lines: string[] = [];
  lines.push(`# Measurement report`);
  lines.push('');
  lines.push(`- generated: ${report.generated_at}`);
  lines.push(`- model: ${report.model}`);
  lines.push(
    `- transactions classified: ${report.transactions_classified}, failures: ${report.failures}`,
  );
  lines.push('');

  lines.push('## Headline: can the auto-approve lane be trusted?');
  lines.push('');
  lines.push(`- automation rate: ${pct(report.headline.automation_rate)}`);
  lines.push(
    `- auto-approve precision (gold agrees on category AND triage): ` +
      `${pct(report.headline.auto_approve_precision)}`,
  );
  lines.push(
    `- dangerous misses (auto-approved, gold wanted a human): ` +
      `${report.headline.dangerous_misses.length}`,
  );
  for (const miss of report.headline.dangerous_misses) {
    lines.push(
      `  - ${miss.transaction_id}: system said ${miss.system_category}/auto-approve, gold says ` +
        `${miss.gold_category}/${miss.gold_triage}${miss.contested ? ' (contested)' : ''} — ` +
        miss.gold_reasoning,
    );
  }
  lines.push('');

  lines.push('## Triage matrix (gold vs system, labelled by cost)');
  lines.push('');
  lines.push('| gold → system | count | cost |');
  lines.push('|---|---|---|');
  for (const cell of report.triage_matrix) {
    lines.push(`| ${cell.gold} → ${cell.system} | ${cell.count} | ${cell.cost} |`);
  }
  lines.push('');

  lines.push('## Category accuracy');
  lines.push('');
  lines.push(`- overall: ${pct(report.category.accuracy_overall)}`);
  lines.push('');
  lines.push('| gold source | rows | category | triage |');
  lines.push('|---|---|---|---|');
  for (const source of report.category.by_source) {
    lines.push(
      `| ${source.source} | ${source.rows} | ${pct(source.category_accuracy)} | ` +
        `${pct(source.triage_accuracy)} |`,
    );
  }
  if (report.category.confusion_pairs.length > 0) {
    lines.push('');
    lines.push('Confusion pairs that actually occurred:');
    for (const pair of report.category.confusion_pairs) {
      lines.push(
        `- gold ${pair.gold} → system ${pair.system} ×${pair.count}` +
          `${pair.contested_only ? ' (contested rows only)' : ''}`,
      );
    }
  }
  lines.push('');

  lines.push('## Confidence calibration');
  lines.push('');
  lines.push('| self-reported | rows | category accuracy |');
  lines.push('|---|---|---|');
  for (const bucket of report.confidence_calibration) {
    lines.push(`| ${bucket.confidence} | ${bucket.rows} | ${pct(bucket.category_accuracy)} |`);
  }
  const high = report.confidence_calibration.find((bucket) => bucket.confidence === 'HIGH');
  const medium = report.confidence_calibration.find((bucket) => bucket.confidence === 'MEDIUM');
  if (
    high?.category_accuracy != null &&
    medium?.category_accuracy != null &&
    high.category_accuracy <= medium.category_accuracy
  ) {
    lines.push('');
    lines.push(
      'HIGH is not more accurate than MEDIUM on this run — the confidence field is decoration ' +
        'here, and the triage gate on HIGH deserves a rethink.',
    );
  }
  lines.push('');

  lines.push('## Owner questions');
  lines.push('');
  lines.push(
    `- ${report.questions.owner_question_rows} transactions → ${report.questions.groups} ` +
      `question(s); fallback used on ${report.questions.fallback_groups} group(s)`,
  );
  for (const group of report.questions.drafted) {
    lines.push(`- **${group.group_id}** (${group.transaction_ids.join(', ')}):`);
    lines.push(`  > ${group.question_norwegian}`);
  }
  lines.push('');

  lines.push('## Tool health');
  lines.push('');
  lines.push(
    `- search_history calls: ${report.tool_health.calls_total} ` +
      `(${report.tool_health.calls_per_transaction.toFixed(2)} per transaction)`,
  );
  lines.push(
    `- injected fallback lookups (model never called): ${report.tool_health.injected_lookups}`,
  );
  lines.push(
    `- repair rounds: ${report.tool_health.repair_round_counts
      .map((entry) => `${entry.rounds}×${entry.transactions}`)
      .join(', ')}`,
  );
  lines.push(
    `- unresolved contradictions after budget: ${report.tool_health.unresolved_after_budget}`,
  );
  lines.push('');

  lines.push('## Cost and latency');
  lines.push('');
  lines.push(
    `- tokens: ${report.cost_latency.tokens_in} in / ${report.cost_latency.tokens_out} out`,
  );
  lines.push(
    `- estimated cost: ${
      report.cost_latency.estimated_cost_usd === null
        ? 'n/a (set EVAL_PRICE_IN / EVAL_PRICE_OUT, USD per 1M tokens)'
        : `$${report.cost_latency.estimated_cost_usd.toFixed(4)}`
    }`,
  );
  lines.push(
    `- latency per transaction: p50 ${report.cost_latency.latency_p50_ms.toFixed(0)}ms, ` +
      `p95 ${report.cost_latency.latency_p95_ms.toFixed(0)}ms`,
  );
  lines.push('');

  lines.push('## Determinism');
  lines.push('');
  if (report.determinism === null) {
    lines.push('- not measured this run (set EVAL_REPEAT=2)');
  } else {
    lines.push(
      `- across ${report.determinism.runs} identical runs: category agreement ` +
        `${pct(report.determinism.category_agreement)}, triage agreement ` +
        `${pct(report.determinism.triage_agreement)}`,
    );
  }
  lines.push('');

  return lines.join('\n');
};

// ---------------------------------------------------------------------------

const configured = evalsConfigured();

describe.skipIf(!configured)('measurement report against a real model', () => {
  if (!configured) {
    it.skip('skipped: set LLM_API_KEY (or point LLM_BASE_URL at a local server)', () => {});
  }

  let report: Report;
  let failures: Failure[];

  beforeAll(async () => {
    const env = loadEnv();
    const goldParsed = GoldFileSchema.safeParse(
      JSON.parse(await readFile('data/gold.json', 'utf8')),
    );
    if (!goldParsed.success) {
      throw new Error(`data/gold.json:\n${formatZodError(goldParsed.error)}`);
    }
    const gold = goldParsed.data.rows;

    const real = await loadTransactions(env.TRANSACTIONS_CSV);
    const synthetic = gold.flatMap((row) =>
      row.transaction === undefined ? [] : [row.transaction],
    );
    let batch: Transaction[] = [...real, ...synthetic];

    // A deliberate coverage cut for smoke runs, so it is logged.
    const only = (process.env['EVAL_ONLY'] ?? '')
      .split(',')
      .map((id) => id.trim())
      .filter((id) => id !== '');
    if (only.length > 0) {
      batch = batch.filter((transaction) => only.includes(transaction.id));
      process.stderr.write(
        `\n  EVAL_ONLY is set: evaluating ${batch.length} transactions. ` +
          'Coverage-dependent numbers will not be meaningful.\n',
      );
    }

    const index = buildHistoryIndex(await loadHistory(env.HISTORY_JSON));
    const client = new ClassifierClient(env);

    const started = Date.now();
    process.stderr.write(
      `\n  ${env.LLM_MODEL}: classifying ${batch.length} transactions at ` +
        `concurrency ${env.CONCURRENCY}\n`,
    );
    const onProgress = (event: {
      phase: string;
      id: string;
      completed: number;
      total: number;
    }): void => {
      if (event.phase === 'done') {
        const elapsed = ((Date.now() - started) / 1000).toFixed(0);
        process.stderr.write(`    [${event.completed}/${event.total}] ${event.id}  ${elapsed}s\n`);
      }
    };

    const run = await classifyBatch({ client, env, index, transactions: batch, onProgress });
    failures = run.failures;

    let repeat: Outcome[] | null = null;
    if (Number(process.env['EVAL_REPEAT'] ?? '1') >= 2) {
      process.stderr.write('  repeat run for determinism...\n');
      const second = await classifyBatch({ client, env, index, transactions: batch, onProgress });
      repeat = second.outcomes;
    }

    const ownerRows = run.outcomes
      .filter((outcome) => outcome.triage.triage === 'owner-question')
      .map((outcome) => outcome.transaction);
    const questions = await draftOwnerQuestions(client, ownerRows);

    report = buildReport({
      env,
      outcomes: run.outcomes,
      failures,
      gold,
      questions,
      repeat,
      generatedAt: new Date().toISOString(),
    });

    const dir = process.env['REPORT_DIR'] ?? '.';
    const parsed = ReportSchema.parse(report);
    await writeFile(join(dir, 'report.json'), `${JSON.stringify(parsed, null, 2)}\n`, 'utf8');
    await writeFile(join(dir, 'report.md'), renderMarkdown(parsed), 'utf8');
    process.stderr.write(`\n${renderMarkdown(parsed)}\n`);
    process.stderr.write(`  wrote ${join(dir, 'report.md')} and ${join(dir, 'report.json')}\n`);
  });

  it('classifies every transaction — an unclassified row is an acknowledged hole', () => {
    expect(failures).toEqual([]);
  });

  it('holds the auto-approve precision bar (EVAL_MIN_PRECISION, default 0.8)', () => {
    const minimum = Number(process.env['EVAL_MIN_PRECISION'] ?? '0.8');
    const precision = report.headline.auto_approve_precision;
    if (precision === null) return; // nothing auto-approved: nothing to hold
    expect(precision).toBeGreaterThanOrEqual(minimum);
  });

  it('stays within the dangerous-miss budget on uncontested rows (EVAL_MAX_DANGEROUS, default 0)', () => {
    const budget = Number(process.env['EVAL_MAX_DANGEROUS'] ?? '0');
    const uncontested = report.headline.dangerous_misses.filter((miss) => !miss.contested);
    expect(uncontested.length).toBeLessThanOrEqual(budget);
  });

  it('covers every owner-question row with exactly one question', () => {
    const covered = new Set(report.questions.drafted.flatMap((group) => group.transaction_ids));
    expect(covered.size).toBe(report.questions.owner_question_rows);
  });
});
