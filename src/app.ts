import { readFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { assertAccountsMatchChart, ChartFileSchema } from './utils/category.schema.ts';
import { buildUserMessage, classifyBatch, SYSTEM_MESSAGE } from './utils/classification.ts';
import { ClassificationSchema } from './utils/classification.schema.ts';
import { describeEnv, loadEnv } from './utils/env.ts';
import { buildHistoryIndex, loadHistory } from './utils/history.ts';
import { ClassifierClient } from './utils/llm.ts';
import {
  auditPathFor,
  buildAuditFile,
  buildResultsFile,
  csvPathFor,
  writeAuditFile,
  writeResultsFile,
} from './utils/output.ts';
import { draftOwnerQuestions } from './utils/question.ts';
import { searchHistoryToolDefinition } from './utils/tool.ts';
import { explainTriage } from './utils/triage.ts';
import { loadTransactions } from './utils/transaction.ts';
import { type Transaction } from './utils/transaction.schema.ts';
import { formatZodError } from './utils/zod.ts';

// Paths resolve flag first, then environment, then the shipped default. No
// flag carries a parseArgs default, because a default here would be
// indistinguishable from the user passing the same value and would silently
// win over the environment.
const { values: flags } = parseArgs({
  options: {
    only: { type: 'string' },
    'dry-run': { type: 'boolean', default: false },
    'explain-triage': { type: 'boolean', default: false },
    transactions: { type: 'string' },
    history: { type: 'string' },
    chart: { type: 'string' },
    out: { type: 'string' },
    help: { type: 'boolean', default: false },
  },
  allowPositionals: false,
});

const printHelp = (): void => {
  process.stdout.write(`
Transaction classification and triage.

  npm start                              classify every transaction into results.json
  npm start -- --only t-00038,t-00040    a subset (history index still uses the full file)
  npm start -- --dry-run                 print the exact request, call nothing
  npm start -- --explain-triage          print the triage derivation, call nothing

Input and output:

  --transactions path.csv                the batch to classify   (env TRANSACTIONS_CSV)
  --history path.json                    prior categorized rows  (env HISTORY_JSON)
  --chart path.json                      chart of accounts       (env CHART_JSON)
  --out path.json                        results                 (env OUTPUT_PATH)

A flag beats the environment, which beats the shipped default. Under Docker the
paths are container paths, so mount the directory first.

Configuration is read from .env; see .env.example.
`);
};

const selectTransactions = (rows: Transaction[], only: string | undefined): Transaction[] => {
  if (only === undefined) return rows;

  const wanted = new Set(
    only
      .split(',')
      .map((id) => id.trim().toLowerCase())
      .filter((id) => id !== ''),
  );
  const selected = rows.filter((row) => wanted.has(row.id.toLowerCase()));

  const missing = [...wanted].filter((id) => !rows.some((row) => row.id.toLowerCase() === id));
  if (missing.length > 0) {
    throw new Error(`--only names transactions that are not in the input: ${missing.join(', ')}`);
  }
  return selected;
};

/** Prints exactly what would be sent, without sending it. */
const dryRun = (selected: Transaction[], client: ClassifierClient): void => {
  process.stdout.write(
    `\nDry run: ${selected.length} transaction(s). Schema in prompt: ` +
      `${client.includeSchemaInPrompt ? 'yes' : 'no'}.\n`,
  );

  const first = selected[0];
  if (first === undefined) return;

  process.stdout.write(`\n=== Request for ${first.id} ===\n`);
  process.stdout.write(`\n--- system ---\n${SYSTEM_MESSAGE}\n`);
  process.stdout.write(
    `\n--- user ---\n${buildUserMessage(
      first,
      client.renderedSchemaFor(ClassificationSchema, 'classification'),
    )}\n`,
  );
  process.stdout.write(`\n--- tool definition ---\n`);
  process.stdout.write(`${JSON.stringify(searchHistoryToolDefinition(), null, 2)}\n`);
  process.stdout.write(`\n--- response_format ---\n`);
  process.stdout.write(
    `${JSON.stringify(client.responseFormatFor(ClassificationSchema, 'classification'), null, 2)}\n`,
  );
};

const main = async (): Promise<number> => {
  if (flags.help === true) {
    printHelp();
    return 0;
  }

  const env = loadEnv();

  if (flags['explain-triage'] === true) {
    process.stdout.write(`\n${explainTriage(env.MATERIALITY_NOK)}\n\n`);
    return 0;
  }

  const transactionsCsv = flags.transactions ?? env.TRANSACTIONS_CSV;
  const historyJson = flags.history ?? env.HISTORY_JSON;
  const chartJson = flags.chart ?? env.CHART_JSON;
  const outputPath = flags.out ?? env.OUTPUT_PATH;

  // Startup reconciliation: the guidance table and the shipped chart must be
  // the same set of codes, or the run stops before any tokens are spent.
  const chartParsed = ChartFileSchema.safeParse(JSON.parse(await readFile(chartJson, 'utf8')));
  if (!chartParsed.success) {
    throw new Error(`${chartJson}:\n${formatZodError(chartParsed.error)}`);
  }
  assertAccountsMatchChart(chartParsed.data);

  const history = await loadHistory(historyJson);
  const transactions = await loadTransactions(transactionsCsv);
  const index = buildHistoryIndex(history);
  const selected = selectTransactions(transactions, flags.only);

  const client = new ClassifierClient(env);

  if (flags['dry-run'] === true) {
    dryRun(selected, client);
    return 0;
  }

  process.stderr.write(`\n${describeEnv(env)}\n\n`);
  process.stderr.write(
    `Classifying ${selected.length} of ${transactions.length} transactions ` +
      `against ${history.length} history rows.\n`,
  );

  const { outcomes, failures } = await classifyBatch({
    client,
    env,
    index,
    transactions: selected,
    onProgress: (event) => {
      if (event.phase === 'done') {
        process.stderr.write(`  [${event.completed}/${event.total}] ${event.id}\n`);
      } else if (event.phase === 'retry') {
        process.stderr.write(`  [transport retry ${event.attempt}] ${event.id}\n`);
      }
    },
  });

  // The batch post-pass: one call for all owner questions, grouped.
  const ownerRows = outcomes
    .filter((outcome) => outcome.triage.triage === 'owner-question')
    .map((outcome) => outcome.transaction);
  const ownerQuestions = await draftOwnerQuestions(client, ownerRows);

  const generatedAt = new Date().toISOString();
  const file = buildResultsFile(outcomes, ownerQuestions, failures, env.LLM_MODEL, generatedAt);
  await writeResultsFile(outputPath, file);

  // Always, not behind a flag. Its whole purpose is explaining a run after
  // the fact, and a run worth explaining is rarely one you thought to ask
  // about beforehand. It is gitignored, so the cost is disk.
  const auditPath = auditPathFor(outputPath);
  await writeAuditFile(
    auditPath,
    buildAuditFile(outcomes, failures, env, client.includeSchemaInPrompt, generatedAt),
  );

  const byTriage = new Map<string, number>();
  for (const outcome of outcomes) {
    byTriage.set(outcome.triage.triage, (byTriage.get(outcome.triage.triage) ?? 0) + 1);
  }
  const toolCallTotal = outcomes.reduce(
    (sum, outcome) => sum + outcome.tool_calls.filter((record) => !record.injected).length,
    0,
  );
  const injected = outcomes.filter((outcome) => outcome.tool_call_missing).length;
  const tokensIn = outcomes.reduce((sum, outcome) => sum + outcome.tokens_in, 0);
  const tokensOut = outcomes.reduce((sum, outcome) => sum + outcome.tokens_out, 0);

  process.stderr.write(`\nWrote ${file.results.length} results to ${outputPath}`);
  process.stderr.write(` (+ ${csvPathFor(outputPath)})\n`);
  process.stderr.write(`Full classifications for audit: ${auditPath}\n`);
  process.stderr.write(
    `Triage: ${['auto-approve', 'accountant-review', 'owner-question']
      .map((triage) => `${triage} ${byTriage.get(triage) ?? 0}`)
      .join(', ')}\n`,
  );
  process.stderr.write(
    `Owner questions: ${ownerQuestions.length} group(s) covering ${ownerRows.length} transaction(s)` +
      `${ownerQuestions.some((group) => group.group_id.startsWith('q-fallback-')) ? ' (fallback used)' : ''}\n`,
  );
  process.stderr.write(
    `Tool calls: ${toolCallTotal} across ${outcomes.length} transactions; ` +
      `injected fallback on ${injected}\n`,
  );
  process.stderr.write(`Tokens: ${tokensIn} in, ${tokensOut} out\n`);

  if (failures.length > 0) {
    // Nothing is invented to fill the gap: an unclassifiable transaction is
    // an acknowledged hole, not a fabricated row.
    process.stderr.write(`\n${failures.length} transaction(s) could not be classified:\n`);
    for (const failure of failures) {
      process.stderr.write(`  ${failure.transaction_id}: ${failure.error}\n`);
    }
    return 1;
  }

  return 0;
};

try {
  process.exitCode = await main();
} catch (error) {
  process.stderr.write(`\n${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
