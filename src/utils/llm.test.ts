import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { classifyOne } from './classification.ts';
import { ClassificationSchema, type Classification } from './classification.schema.ts';
import { checkClassification } from './consistency.ts';
import { loadEnv } from './env.ts';
import { buildHistoryIndex, loadHistory } from './history.ts';
import { type HistoryIndex } from './history.schema.ts';
import {
  ClassifierClient,
  extractJson,
  isFatalAuthError,
  isRetryableTransportError,
  stripReasoning,
  StructuredFailure,
} from './llm.ts';
import { type StructuredRequest } from './llm.schema.ts';
import { executeSearchHistory, searchHistoryToolDefinition } from './tool.ts';
import { type Transaction } from './transaction.schema.ts';

/**
 * The integration tests drive the client against a real HTTP server rather
 * than a mocked SDK, because the wire is the thing under test: that the tool
 * definition and response_format actually land in the request body, that a
 * tool-call turn round-trips through the loop this repo owns, and that repair
 * turns carry the rejected output's specific problems.
 */

// --- the scriptable OpenAI-compatible endpoint -----------------------------

interface StubRequest {
  model: string;
  messages: {
    role: string;
    content: unknown;
    tool_calls?: { id: string; function: { name: string; arguments: string } }[];
  }[];
  tools?: { type: string; function: { name: string; parameters: unknown } }[];
  response_format?: { type: string; json_schema?: { schema: unknown; strict: boolean } };
  temperature?: number;
  seed?: number;
}

type StubReply =
  | { kind: 'content'; content: string }
  | { kind: 'tool_calls'; calls: { id: string; name: string; arguments: string }[] }
  | { kind: 'error'; status: number; body: unknown };

interface StubServer {
  url: string;
  requests: StubRequest[];
  close: () => Promise<void>;
}

const replyJson = (value: unknown): StubReply => ({
  kind: 'content',
  content: JSON.stringify(value),
});
const replyText = (content: string): StubReply => ({ kind: 'content', content });
const replyToolCall = (name: string, args: unknown, id = 'call-1'): StubReply => ({
  kind: 'tool_calls',
  calls: [{ id, name, arguments: JSON.stringify(args) }],
});
const replyStatus = (status: number, message = 'server error'): StubReply => ({
  kind: 'error',
  status,
  body: { error: { message, type: 'server_error' } },
});

const startStub = async (
  script: (turn: number, request: StubRequest) => StubReply,
): Promise<StubServer> => {
  const requests: StubRequest[] = [];

  const server: Server = createServer((req, res) => {
    let body = '';
    req.on('data', (chunk: Buffer) => {
      body += chunk.toString();
    });
    req.on('end', () => {
      const parsed = JSON.parse(body) as StubRequest;
      const turn = requests.length;
      requests.push(parsed);

      const reply = script(turn, parsed);

      if (reply.kind === 'error') {
        res.writeHead(reply.status, { 'content-type': 'application/json' });
        res.end(JSON.stringify(reply.body));
        return;
      }

      const message =
        reply.kind === 'tool_calls'
          ? {
              role: 'assistant',
              content: null,
              tool_calls: reply.calls.map((call) => ({
                id: call.id,
                type: 'function',
                function: { name: call.name, arguments: call.arguments },
              })),
            }
          : { role: 'assistant', content: reply.content };

      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({
          id: `stub-${turn}`,
          object: 'chat.completion',
          created: 0,
          model: parsed.model,
          choices: [
            {
              index: 0,
              message,
              finish_reason: reply.kind === 'tool_calls' ? 'tool_calls' : 'stop',
            },
          ],
          usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        }),
      );
    });
  });

  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });
  const { port } = server.address() as AddressInfo;

  return {
    url: `http://127.0.0.1:${port}/v1`,
    requests,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error === undefined ? resolve() : reject(error)));
      }),
  };
};

// --- fixtures --------------------------------------------------------------

const telenor: Transaction = {
  id: 't-00001',
  date: '2026-06-22',
  amount_nok: -749,
  counterparty: 'Telenor Norge AS',
  description: 'Mobilabonnement',
  currency: 'NOK',
};

const netflix: Transaction = {
  id: 't-00044',
  date: '2026-06-20',
  amount_nok: -149,
  counterparty: 'NETFLIX',
  description: 'Subscription',
  currency: 'NOK',
};

const validTelenor: Classification = {
  history_evidence:
    'search_history found prior Telenor Norge AS transactions, all utilities, roughly monthly.',
  history_support: 'EXACT_RECURRING',
  reasoning: 'Recurring telecom subscription billed monthly; history is unanimous.',
  category_code: 'utilities',
  purpose_clarity: 'UNAMBIGUOUS',
  personal_risk: 'NONE',
  missing_information: 'NONE',
  uncertainty_note: null,
  confidence: 'HIGH',
};

const validNetflix: Classification = {
  history_evidence: 'search_history returned no prior transactions for NETFLIX.',
  history_support: 'NONE',
  reasoning: 'Streaming service with no business purpose in evidence.',
  category_code: 'personal_expense',
  purpose_clarity: 'UNAMBIGUOUS',
  personal_risk: 'LIKELY_PERSONAL',
  missing_information: 'NONE',
  uncertainty_note: null,
  confidence: 'MEDIUM',
};

let index: HistoryIndex;
let stub: StubServer | null = null;

beforeAll(async () => {
  index = buildHistoryIndex(await loadHistory('ai-engineer/data/history.json'));
});

afterEach(async () => {
  await stub?.close();
  stub = null;
});

const clientFor = (url: string, overrides: Record<string, string> = {}): ClassifierClient =>
  new ClassifierClient(
    loadEnv({
      LLM_BASE_URL: url,
      LLM_MODEL: 'test-model',
      SCHEMA_IN_PROMPT: 'never',
      MAX_REPAIR_ATTEMPTS: '2',
      MAX_TOOL_CALLS: '3',
      MAX_TRANSPORT_RETRIES: '0',
      REQUEST_TIMEOUT_MS: '5000',
      ...overrides,
    }),
  );

const requestFor = (transaction: Transaction): StructuredRequest<Classification> => ({
  schema: ClassificationSchema,
  schemaName: 'classification',
  system: 'test system',
  user: `classify ${transaction.id}`,
  tools: [searchHistoryToolDefinition()],
  executeTool: (name, rawArguments) => executeSearchHistory(index, rawArguments),
  injectDefaultTool: () =>
    executeSearchHistory(index, { counterparty: transaction.counterparty }, true),
  crossCheck: (value, toolCalls) => checkClassification(value, transaction, toolCalls),
  label: transaction.id,
});

// --- extraction ------------------------------------------------------------

describe('stripReasoning', () => {
  it('removes closed and unterminated thinking blocks', () => {
    expect(stripReasoning('<think>draft {"a":1}</think>{"b":2}')).toBe('{"b":2}');
    expect(stripReasoning('{"b":2}<think>truncated mid-thought')).toBe('{"b":2}');
    expect(stripReasoning('leaked trace</think>{"b":2}')).toBe('{"b":2}');
  });
});

describe('extractJson', () => {
  it('parses a bare object, a fenced block, and an embedded object', () => {
    expect(extractJson('{"a":1}')).toEqual({ a: 1 });
    expect(extractJson('Here:\n```json\n{"a":1}\n```\ndone')).toEqual({ a: 1 });
    expect(extractJson('The answer is {"a":{"b":"x}y"}} thanks')).toEqual({ a: { b: 'x}y' } });
  });

  it('throws when there is no object at all', () => {
    expect(() => extractJson('no json here')).toThrow(/No JSON object/);
  });
});

// --- the tool loop over real HTTP ------------------------------------------

describe('generateStructured', () => {
  it('runs the tool loop: definition on the wire, execution in code, result round-tripped', async () => {
    stub = await startStub((turn) =>
      turn === 0
        ? replyToolCall('search_history', { counterparty: 'Telenor Norge AS' })
        : replyJson(validTelenor),
    );
    const client = clientFor(stub.url);

    const result = await client.generateStructured(requestFor(telenor));

    expect(result.value.category_code).toBe('utilities');
    expect(result.repairAttempts).toBe(0);
    expect(result.toolCallMissing).toBe(false);
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0]?.result?.match_count).toBeGreaterThanOrEqual(3);

    // What actually landed on the wire. The tool-phase turn must NOT carry
    // response_format: a decoding grammar makes a tool call unemittable —
    // measured on LM Studio, where an always-on grammar produced zero tool
    // calls across a whole batch. The constraint belongs to the answer turn.
    const first = stub.requests[0];
    expect(first?.tools?.[0]?.function.name).toBe('search_history');
    expect(first?.response_format).toBeUndefined();
    expect(first?.temperature).toBe(0);
    expect(first?.seed).toBe(7);

    // The second turn carries the executed tool result back, and is the one
    // that gets grammar-locked to the schema.
    const second = stub.requests[1];
    expect(second?.messages.some((message) => message.role === 'tool')).toBe(true);
    expect(second?.response_format?.type).toBe('json_schema');
    expect(second?.response_format?.json_schema?.strict).toBe(true);
    expect(result.tokensIn).toBeGreaterThan(0);
  });

  it('demands a missing tool call once, then injects the lookup and degrades measurably', async () => {
    stub = await startStub(() => replyJson(validNetflix));
    const client = clientFor(stub.url, { MAX_REPAIR_ATTEMPTS: '3' });

    const result = await client.generateStructured(requestFor(netflix));

    expect(result.value.category_code).toBe('personal_expense');
    expect(result.toolCallMissing).toBe(true);
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0]?.injected).toBe(true);

    // Turn 2's user message is the demand; turn 3's carries the injected result.
    const demand = stub.requests[1]?.messages.at(-1);
    expect(String(demand?.content)).toContain('search_history');
    const injected = stub.requests[2]?.messages.at(-1);
    expect(String(injected?.content)).toContain('executed the default lookup');
  });

  it('repairs a schema violation conversationally', async () => {
    const broken = { ...validTelenor, category_code: 'telecom_stuff' };
    stub = await startStub((turn) => {
      if (turn === 0) return replyToolCall('search_history', { counterparty: 'Telenor Norge AS' });
      if (turn === 1) return replyJson(broken);
      return replyJson(validTelenor);
    });
    const client = clientFor(stub.url);

    const result = await client.generateStructured(requestFor(telenor));

    expect(result.repairAttempts).toBe(1);
    const repairTurn = stub.requests[2]?.messages.at(-1);
    expect(String(repairTurn?.content)).toContain('rejected');
    expect(String(repairTurn?.content)).toContain('category_code');
  });

  it('extracts JSON wrapped in prose and reasoning tags', async () => {
    stub = await startStub((turn) =>
      turn === 0
        ? replyToolCall('search_history', { counterparty: 'Telenor Norge AS' })
        : replyText(
            `<think>drafting {"category_code":"wrong"}</think>Here is my answer:\n` +
              '```json\n' +
              JSON.stringify(validTelenor) +
              '\n```',
          ),
    );
    const client = clientFor(stub.url);

    const result = await client.generateStructured(requestFor(telenor));
    expect(result.value.category_code).toBe('utilities');
  });

  it('publishes a schema-valid but disputed answer flagged, not dropped', async () => {
    // Claims EXACT_RECURRING for a counterparty whose search returns nothing,
    // and never corrects itself.
    const disputed: Classification = {
      ...validNetflix,
      history_evidence: 'Netflix appears monthly in history.',
      history_support: 'EXACT_RECURRING',
      confidence: 'HIGH',
    };
    stub = await startStub((turn) =>
      turn === 0
        ? replyToolCall('search_history', { counterparty: 'NETFLIX' })
        : replyJson(disputed),
    );
    const client = clientFor(stub.url);

    const result = await client.generateStructured(requestFor(netflix));

    expect(result.unresolvedIssues.length).toBeGreaterThan(0);
    expect(result.value.history_support).toBe('EXACT_RECURRING');
  });

  it('throws StructuredFailure when nothing schema-valid ever arrives', async () => {
    stub = await startStub((turn) =>
      turn === 0
        ? replyToolCall('search_history', { counterparty: 'Telenor Norge AS' })
        : replyText('I cannot answer this.'),
    );
    const client = clientFor(stub.url);

    await expect(client.generateStructured(requestFor(telenor))).rejects.toThrow(StructuredFailure);
  });

  it('stops a tool-looping model at the cap', async () => {
    // Calls the tool three times; the third is refused with "answer now" and
    // the model then complies. A model that ignores the refusal twice more
    // exhausts the loop and fails the transaction — also correct, not tested here.
    stub = await startStub((turn) =>
      turn < 3
        ? replyToolCall('search_history', { counterparty: 'Telenor Norge AS' }, `call-${turn}`)
        : replyJson(validTelenor),
    );
    const client = clientFor(stub.url, { MAX_TOOL_CALLS: '2' });

    const result = await client.generateStructured(requestFor(telenor));
    // Executed calls stay within the cap; the surplus were refused, not run.
    expect(result.toolCalls.filter((record) => !record.injected)).toHaveLength(2);
    expect(result.value.category_code).toBe('utilities');
  });
});

// --- error classification --------------------------------------------------

describe('transport error predicates', () => {
  it('classifies auth failures as fatal and 5xx as retryable', async () => {
    stub = await startStub(() => replyStatus(401, 'bad key'));
    const client = clientFor(stub.url);

    const error = await client.generateStructured(requestFor(telenor)).then(
      () => null,
      (thrown: unknown) => thrown,
    );
    expect(error).not.toBeNull();
    expect(isFatalAuthError(error)).toBe(true);
    expect(isRetryableTransportError(error)).toBe(false);

    expect(isRetryableTransportError({ statusCode: 503 })).toBe(true);
    expect(isRetryableTransportError({ statusCode: 429 })).toBe(true);
    expect(isFatalAuthError({ statusCode: 503 })).toBe(false);
  });
});

// --- the assembled pipeline ------------------------------------------------

describe('classifyOne', () => {
  it('attaches the code-owned triage to the model classification', async () => {
    stub = await startStub((turn) =>
      turn === 0
        ? replyToolCall('search_history', { counterparty: 'Telenor Norge AS' })
        : replyJson(validTelenor),
    );
    const client = clientFor(stub.url);
    const env = loadEnv({ LLM_BASE_URL: stub.url, MAX_TRANSPORT_RETRIES: '0' });

    const outcome = await classifyOne({ client, env, index, transaction: telenor });

    expect(outcome.classification.category_code).toBe('utilities');
    expect(outcome.triage.triage).toBe('auto-approve');
    expect(outcome.tool_calls).toHaveLength(1);
    expect(outcome.duration_ms).toBeGreaterThanOrEqual(0);
  });

  it('floors an injected-lookup outcome at accountant-review', async () => {
    stub = await startStub(() => replyJson(validNetflix));
    const client = clientFor(stub.url, { MAX_REPAIR_ATTEMPTS: '3' });
    const env = loadEnv({ LLM_BASE_URL: stub.url, MAX_TRANSPORT_RETRIES: '0' });

    const outcome = await classifyOne({ client, env, index, transaction: netflix });

    expect(outcome.tool_call_missing).toBe(true);
    expect(outcome.triage.triage).toBe('accountant-review');
    expect(outcome.triage.rules).toContain('SYSTEM_DOUBT');
  });
});
