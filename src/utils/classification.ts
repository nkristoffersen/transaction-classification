import { ClassificationSchema, type Classification } from './classification.schema.ts';
import { checkClassification } from './consistency.ts';
import { type Env } from './env.schema.ts';
import { type HistoryIndex } from './history.schema.ts';
import { isFatalAuthError, isRetryableTransportError, type ClassifierClient } from './llm.ts';
import { type Outcome, type Failure } from './output.schema.ts';
import { runPool } from './queue.ts';
import { type ProgressEvent } from './queue.schema.ts';
import { executeSearchHistory, searchHistoryToolDefinition } from './tool.ts';
import { SEARCH_HISTORY_TOOL_NAME } from './tool.schema.ts';
import { StructuredFailure } from './llm.ts';
import { decideTriage } from './triage.ts';
import { type Transaction } from './transaction.schema.ts';
import { prose } from './text.ts';

/**
 * Builds the per-transaction request and runs the pipeline over the batch.
 * The system message is three sentences of framing; the user message carries
 * only facts about this transaction. The accounting rules travel in the
 * schema's field descriptions, not here — the schema is the prompt.
 *
 * The CLI and the eval both drive `classifyBatch`, so the eval measures the
 * real pipeline rather than a reimplementation of it.
 */

export const SYSTEM_MESSAGE = prose`
  You classify bank transactions for a small Norwegian business's accounting. You report
  observations — history evidence, purpose clarity, personal risk, missing information — plus a
  category from the chart of accounts; the triage decision itself is made by code from what you
  report. Always consult the prior transactions through the search_history tool before answering,
  and ground every claim in what it returned.
`;

export const buildUserMessage = (
  transaction: Transaction,
  renderedSchema: string | null,
): string => {
  const facts = [
    `id: ${transaction.id}`,
    `date: ${transaction.date}`,
    `amount_nok: ${transaction.amount_nok} (negative = money out of the business)`,
    `counterparty: ${transaction.counterparty}`,
    `description: ${transaction.description}`,
    `currency: ${transaction.currency}`,
  ].join('\n');

  const instruction = prose`
    First call search_history for the counterparty. If the result shows several categories for it,
    call it again with a description_keyword to see which pattern this row belongs to. Then answer
    with a single JSON object matching the schema — no prose around it.
  `;

  const schemaBlock =
    renderedSchema === null
      ? ''
      : `\n\nThe answer must match this JSON Schema. The field descriptions carry the accounting` +
        ` guidance — read them:\n${renderedSchema}`;

  return `Classify this transaction.\n\n${facts}\n\n${instruction}${schemaBlock}`;
};

/** Classifies one transaction: tool loop, parse, cross-checks, triage. */
export const classifyOne = async (
  options: {
    client: ClassifierClient;
    env: Env;
    index: HistoryIndex;
    transaction: Transaction;
  },
  signal?: AbortSignal,
): Promise<Outcome> => {
  const { client, env, index, transaction } = options;
  const started = Date.now();

  const result = await client.generateStructured<Classification>(
    {
      schema: ClassificationSchema,
      schemaName: 'classification',
      system: SYSTEM_MESSAGE,
      user: buildUserMessage(
        transaction,
        client.renderedSchemaFor(ClassificationSchema, 'classification'),
      ),
      tools: [searchHistoryToolDefinition()],
      executeTool: (name, rawArguments) =>
        name === SEARCH_HISTORY_TOOL_NAME
          ? executeSearchHistory(index, rawArguments)
          : {
              name,
              raw_arguments: rawArguments,
              arguments: null,
              result: null,
              injected: false,
              error: `Unknown tool "${name}". Only ${SEARCH_HISTORY_TOOL_NAME} exists.`,
            },
      injectDefaultTool: () =>
        executeSearchHistory(index, { counterparty: transaction.counterparty }, true),
      crossCheck: (value, toolCalls) => checkClassification(value, transaction, toolCalls),
      label: transaction.id,
    },
    signal,
  );

  // The largest amount this counterparty's own history carries, from the
  // exact-tier search results. Fuzzy tiers vouch for nothing here either.
  const ownRanges = result.toolCalls.flatMap((record) =>
    record.result !== null &&
    (record.result.match_quality === 'exact' || record.result.match_quality === 'contains') &&
    record.result.amount_range !== null
      ? [record.result.amount_range]
      : [],
  );
  const largestKnown = Math.max(
    0,
    ...ownRanges.flatMap((range) => [Math.abs(range.min), Math.abs(range.max)]),
  );
  const amountOutsidePattern =
    largestKnown > 0 && Math.abs(transaction.amount_nok) > 2 * largestKnown;

  const triage = decideTriage({
    classification: result.value,
    transaction,
    tool_call_missing: result.toolCallMissing,
    amount_outside_pattern: amountOutsidePattern,
    unresolved_issue_count: result.unresolvedIssues.length,
    materiality_nok: env.MATERIALITY_NOK,
  });

  return {
    transaction,
    classification: result.value,
    triage,
    tool_calls: result.toolCalls,
    repair_attempts: result.repairAttempts,
    tool_call_missing: result.toolCallMissing,
    unresolved_issues: result.unresolvedIssues,
    tokens_in: result.tokensIn,
    tokens_out: result.tokensOut,
    duration_ms: Date.now() - started,
  };
};

/** The batch run itself, shared verbatim by the CLI and the eval. */
export const classifyBatch = async (options: {
  client: ClassifierClient;
  env: Env;
  index: HistoryIndex;
  transactions: Transaction[];
  onProgress?: (event: ProgressEvent) => void;
}): Promise<{ outcomes: Outcome[]; failures: Failure[] }> => {
  const { client, env, index, transactions, onProgress } = options;

  const settled = await runPool(
    transactions,
    (transaction) => transaction.id,
    (transaction, signal) => classifyOne({ client, env, index, transaction }, signal),
    {
      concurrency: env.CONCURRENCY,
      maxRetries: env.MAX_TRANSPORT_RETRIES,
      isRetryable: isRetryableTransportError,
      isFatal: isFatalAuthError,
      ...(onProgress === undefined ? {} : { onProgress }),
    },
  );

  const outcomes: Outcome[] = [];
  const failures: Failure[] = [];

  for (const outcome of settled) {
    if (outcome.status === 'fulfilled') {
      outcomes.push(outcome.value);
      continue;
    }
    const unresolved = outcome.error instanceof StructuredFailure ? outcome.error.issues : [];
    failures.push({
      transaction_id: outcome.id,
      attempts: outcome.attempts,
      error: outcome.error instanceof Error ? outcome.error.message : String(outcome.error),
      unresolved_issues: unresolved.map((issue) => `${issue.path}: ${issue.message}`),
    });
  }

  return { outcomes, failures };
};
