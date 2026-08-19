import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import {
  generateText,
  jsonSchema,
  tool,
  type JSONValue,
  type LanguageModel,
  type ModelMessage,
  type ToolSet,
} from 'ai';
import { zodResponseFormat } from 'openai/helpers/zod';
import { type z } from 'zod';
import { type Env } from './env.schema.ts';
import { shouldRenderSchemaInPrompt } from './env.ts';
import { type StructuredRequest, type StructuredResult } from './llm.schema.ts';
import { type ToolCallRecord } from './tool.schema.ts';
import { prose } from './text.ts';
import { issuesFromZod, renderIssuesForModel } from './zod.ts';
import { type RepairIssue } from './zod.schema.ts';

/**
 * Structured generation with a code-owned tool loop, owned here rather than
 * delegated.
 *
 * Two packages appear and each does one job. The AI SDK is transport: it
 * builds the HTTP call to an OpenAI-compatible endpoint and normalises
 * provider errors. The `openai` package converts the zod schema into the
 * strict `response_format` payload (`zodResponseFormat`). Everything the
 * exercise actually grades — the tool loop, JSON extraction, validation, the
 * cross-checks and the conversational repair loop — is in this file.
 *
 * Two retry layers exist and are deliberately separate:
 *
 *   - Repair, here. The response was received but is wrong. Conversational:
 *     the bad output and the specific issues go back to the model.
 *   - Transport, in `queue.ts`. The response never arrived. Not conversational.
 */

/**
 * The name the AI SDK files this provider under. It is only an internal key
 * for the request-body passthrough — it never reaches the endpoint — so there
 * is nothing for a user to configure here.
 */
const PROVIDER_NAME = 'classifier';

export class StructuredFailure extends Error {
  readonly issues: RepairIssue[];
  readonly attempts: number;
  readonly lastOutput: string;

  constructor(message: string, issues: RepairIssue[], attempts: number, lastOutput: string) {
    super(message);
    this.name = 'StructuredFailure';
    this.issues = issues;
    this.attempts = attempts;
    this.lastOutput = lastOutput;
  }
}

// ---------------------------------------------------------------------------
// JSON extraction
// ---------------------------------------------------------------------------

/**
 * Removes reasoning traces before anything tries to parse the reply.
 *
 * A thinking model emits its scratchpad inline, and that scratchpad routinely
 * contains braces and draft JSON. Left in place it defeats brace matching and
 * can produce a plausible parse of the wrong object — a much nastier failure
 * than no parse at all.
 *
 * An unclosed opening tag means the reply was truncated mid-thought, so
 * everything from it onward is discarded.
 */
export const stripReasoning = (text: string): string => {
  const tags = ['think', 'thinking', 'reason', 'reasoning', 'thought'];
  let result = text;

  for (const tag of tags) {
    result = result.replace(new RegExp(`<${tag}>[\\s\\S]*?</${tag}>`, 'gi'), '');
    result = result.replace(new RegExp(`<${tag}>[\\s\\S]*$`, 'i'), '');
    // A stray closing tag with no opener: everything before it was the trace.
    result = result.replace(new RegExp(`^[\\s\\S]*?</${tag}>`, 'i'), '');
  }

  return result.trim();
};

const balancedObject = (text: string): string | null => {
  const start = text.indexOf('{');
  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < text.length; i++) {
    const char = text[i];

    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === '\\') {
      escaped = true;
      continue;
    }
    if (char === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;

    if (char === '{') depth++;
    else if (char === '}') {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
};

/**
 * Pulls a JSON object out of a reply. Three strategies, weakest assumption
 * last: the whole reply, a fenced block, or the first balanced brace span.
 * Needed whenever nothing constrains the model from wrapping its answer in
 * prose.
 */
export const extractJson = (text: string): unknown => {
  const trimmed = stripReasoning(text);

  try {
    return JSON.parse(trimmed);
  } catch {
    // fall through
  }

  const fenced = /```(?:json)?\s*\n([\s\S]*?)\n?```/.exec(trimmed);
  if (fenced?.[1] !== undefined) {
    try {
      return JSON.parse(fenced[1]);
    } catch {
      // fall through
    }
  }

  const span = balancedObject(trimmed);
  if (span !== null) {
    try {
      return JSON.parse(span);
    } catch {
      // fall through
    }
  }

  throw new SyntaxError('No JSON object found in the reply');
};

// ---------------------------------------------------------------------------
// Provider errors
// ---------------------------------------------------------------------------

const errorText = (error: unknown): string => {
  if (error instanceof Error) {
    const cause = 'cause' in error && error.cause instanceof Error ? ` ${error.cause.message}` : '';
    const body = (error as { responseBody?: unknown }).responseBody;
    return `${error.message}${cause} ${typeof body === 'string' ? body : ''}`.toLowerCase();
  }
  return String(error).toLowerCase();
};

const statusOf = (error: unknown): number | undefined => {
  if (error !== null && typeof error === 'object' && 'statusCode' in error) {
    const status = (error as { statusCode?: unknown }).statusCode;
    if (typeof status === 'number') return status;
  }
  return undefined;
};

/** Worth retrying at the transport layer: rate limits, server faults, network. */
export const isRetryableTransportError = (error: unknown): boolean => {
  const status = statusOf(error);
  if (status !== undefined) {
    return status === 408 || status === 409 || status === 429 || status >= 500;
  }

  const text = errorText(error);
  return (
    text.includes('econnreset') ||
    text.includes('etimedout') ||
    text.includes('econnrefused') ||
    text.includes('socket hang up') ||
    text.includes('network') ||
    text.includes('timeout') ||
    text.includes('aborted')
  );
};

/** No amount of retrying fixes a bad key. Fail the whole run immediately. */
export const isFatalAuthError = (error: unknown): boolean => {
  const status = statusOf(error);
  return status === 401 || status === 403;
};

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

export class ClassifierClient {
  readonly #env: Env;
  readonly #model: LanguageModel;
  readonly #includeSchemaInPrompt: boolean;

  constructor(env: Env) {
    this.#env = env;
    this.#includeSchemaInPrompt = shouldRenderSchemaInPrompt(env);

    const provider = createOpenAICompatible({
      name: PROVIDER_NAME,
      baseURL: env.LLM_BASE_URL,
      ...(env.LLM_API_KEY === '' ? {} : { apiKey: env.LLM_API_KEY }),
    });
    this.#model = provider.chatModel(env.LLM_MODEL);
  }

  get includeSchemaInPrompt(): boolean {
    return this.#includeSchemaInPrompt;
  }

  /** The strict response_format payload, built by the openai helper. */
  responseFormatFor(schema: z.ZodType, name: string): ReturnType<typeof zodResponseFormat> {
    return zodResponseFormat(schema, name);
  }

  /** The wire schema rendered for the message body, when the endpoint needs it. */
  renderedSchemaFor(schema: z.ZodType, name: string): string | null {
    if (!this.#includeSchemaInPrompt) return null;
    return JSON.stringify(this.responseFormatFor(schema, name).json_schema.schema, null, 2);
  }

  #toolSetFor<T>(request: StructuredRequest<T>): ToolSet | undefined {
    if (request.tools.length === 0) return undefined;
    return Object.fromEntries(
      request.tools.map((definition) => [
        definition.name,
        // No `execute`: the SDK stops after the tool call and this class runs
        // the loop itself. That line — who owns the loop — is the point.
        tool({
          description: definition.description,
          inputSchema: jsonSchema(definition.input_schema),
        }),
      ]),
    );
  }

  async #call<T>(
    request: StructuredRequest<T>,
    messages: ModelMessage[],
    signal: AbortSignal | undefined,
  ): Promise<{
    text: string;
    toolCalls: { toolCallId: string; toolName: string; input: unknown }[];
    responseMessages: ModelMessage[];
    tokensIn: number;
    tokensOut: number;
  }> {
    const timeout = AbortSignal.timeout(this.#env.REQUEST_TIMEOUT_MS);
    const tools = this.#toolSetFor(request);
    const result = await generateText({
      model: this.#model,
      system: request.system,
      messages,
      temperature: this.#env.LLM_TEMPERATURE,
      ...(this.#env.LLM_SEED === null ? {} : { seed: this.#env.LLM_SEED }),
      // Transport retries belong to the queue, which can distinguish a rate
      // limit from a validation failure. Do not let the SDK retry silently.
      maxRetries: 0,
      abortSignal: signal === undefined ? timeout : AbortSignal.any([signal, timeout]),
      ...(tools === undefined ? {} : { tools }),
      providerOptions: {
        [PROVIDER_NAME]: {
          response_format: this.responseFormatFor(
            request.schema,
            request.schemaName,
          ) as unknown as JSONValue,
        },
      },
    });

    return {
      text: result.text,
      toolCalls: result.toolCalls.map((call) => ({
        toolCallId: call.toolCallId,
        toolName: call.toolName,
        // The SDK types a schema-driven tool's input as `any`; nothing here
        // may treat it as more than unknown until a zod parse says otherwise.
        input: call.input as unknown,
      })),
      responseMessages: result.response.messages,
      tokensIn: result.usage.inputTokens ?? 0,
      tokensOut: result.usage.outputTokens ?? 0,
    };
  }

  /**
   * Generate, validate, and repair until the output satisfies the schema and
   * the domain cross-check — running the tool loop along the way.
   *
   * The conversation has two interleaved phases. In the tool phase the model
   * calls search_history and code executes it, appending the result; a cap
   * (MAX_TOOL_CALLS) keeps a looping model from spending the budget. In the
   * answer phase the reply is parsed, cross-checked, and either accepted or
   * sent back with its specific problems.
   *
   * A verdict with zero tool calls is handled in two steps: one repair turn
   * demands the call; a second refusal triggers the injected fallback, so the
   * run degrades measurably (`toolCallMissing`) instead of failing.
   */
  async generateStructured<T>(
    request: StructuredRequest<T>,
    signal?: AbortSignal,
  ): Promise<StructuredResult<T>> {
    const messages: ModelMessage[] = [{ role: 'user', content: request.user }];
    const toolCalls: ToolCallRecord[] = [];

    let toolCallMissing = false;
    let demandedToolCall = false;
    let tokensIn = 0;
    let tokensOut = 0;
    let lastIssues: RepairIssue[] = [];
    let lastOutput = '';
    // The most recent output that satisfied the schema but failed a domain
    // cross-check. Kept so an unresolvable disagreement can still produce a
    // result flagged for review, rather than dropping the transaction.
    let lastSchemaValid: { value: T; issues: RepairIssue[] } | null = null;

    for (let attempt = 0; attempt < this.#env.MAX_REPAIR_ATTEMPTS; attempt++) {
      const text = await this.#runToolPhase(request, messages, toolCalls, signal, (turn) => {
        tokensIn += turn.tokensIn;
        tokensOut += turn.tokensOut;
      });
      lastOutput = text;

      // The model answered without ever consulting the tool.
      if (request.injectDefaultTool !== undefined && toolCalls.length === 0) {
        messages.push({ role: 'assistant', content: text });
        if (!demandedToolCall) {
          demandedToolCall = true;
          messages.push({
            role: 'user',
            content: prose`
              You answered without calling search_history. The history is evidence you are
              required to consult. Call search_history now for this counterparty, then answer
              again.
            `,
          });
          continue;
        }
        // Second refusal: code does the lookup, hands over the result, and
        // records that it had to.
        const record = request.injectDefaultTool();
        toolCalls.push(record);
        toolCallMissing = true;
        messages.push({
          role: 'user',
          content:
            prose`
              You still did not call the tool, so the system executed the default lookup for you.
              Treat this as the search_history result, cite it in history_evidence, and return
              the corrected JSON object in full:
            ` + `\n${JSON.stringify(record.result ?? record.error)}`,
        });
        continue;
      }

      const checked = this.#validate(request, text, toolCalls);
      if (checked.issues.length === 0 && checked.value !== undefined) {
        return {
          value: checked.value,
          repairAttempts: attempt,
          toolCalls,
          toolCallMissing,
          unresolvedIssues: [],
          tokensIn,
          tokensOut,
        };
      }

      if (checked.value !== undefined) {
        lastSchemaValid = { value: checked.value, issues: checked.issues };
      }
      lastIssues = checked.issues;

      messages.push({ role: 'assistant', content: text });
      messages.push({ role: 'user', content: repairPrompt(checked.issues) });
    }

    // Out of attempts. A structural failure means there is nothing to publish.
    // A domain disagreement is different: the classification is well-formed
    // and usable, it just conflicts with a computed fact — which is precisely
    // the case a human reviewer exists to settle. Emitting it flagged beats
    // dropping the transaction, and nothing is invented either way.
    if (lastSchemaValid !== null) {
      return {
        value: lastSchemaValid.value,
        repairAttempts: this.#env.MAX_REPAIR_ATTEMPTS,
        toolCalls,
        toolCallMissing,
        unresolvedIssues: lastSchemaValid.issues,
        tokensIn,
        tokensOut,
      };
    }

    throw new StructuredFailure(
      `${request.label}: no schema-valid classification after ` +
        `${this.#env.MAX_REPAIR_ATTEMPTS} attempts`,
      lastIssues,
      this.#env.MAX_REPAIR_ATTEMPTS,
      lastOutput,
    );
  }

  /**
   * Runs turns until the model produces text instead of tool calls. Each tool
   * call is executed by the request's own executor; past the cap the call is
   * answered with an instruction to stop, not executed.
   */
  async #runToolPhase<T>(
    request: StructuredRequest<T>,
    messages: ModelMessage[],
    toolCalls: ToolCallRecord[],
    signal: AbortSignal | undefined,
    onUsage: (turn: { tokensIn: number; tokensOut: number }) => void,
  ): Promise<string> {
    // The cap plus a margin bounds the loop even against a model that keeps
    // calling after being told to stop.
    for (let turn = 0; turn <= this.#env.MAX_TOOL_CALLS + 1; turn++) {
      const result = await this.#call(request, messages, signal);
      onUsage(result);

      if (result.toolCalls.length === 0) return result.text;

      // The assistant message carrying the tool-call parts, as the SDK built it.
      messages.push(...result.responseMessages);

      for (const call of result.toolCalls) {
        const executed = toolCalls.filter((record) => !record.injected).length;
        if (executed >= this.#env.MAX_TOOL_CALLS || request.executeTool === undefined) {
          messages.push(
            toolResultMessage(call, {
              type: 'error-text',
              value: 'Tool budget exhausted. Answer now with the evidence you already have.',
            }),
          );
          continue;
        }

        const record = request.executeTool(call.toolName, call.input);
        toolCalls.push(record);
        messages.push(
          toolResultMessage(call, {
            type: 'json',
            value: (record.error === null
              ? record.result
              : { error: record.error }) as unknown as JSONValue,
          }),
        );
      }
    }

    throw new StructuredFailure(
      `${request.label}: model kept calling tools past the cap`,
      [],
      0,
      '',
    );
  }

  /** Parses and cross-checks. `value` is set whenever the schema accepted it. */
  #validate<T>(
    request: StructuredRequest<T>,
    text: string,
    toolCalls: ToolCallRecord[],
  ): { value?: T; issues: RepairIssue[] } {
    let candidate: unknown;
    try {
      candidate = extractJson(text);
    } catch (error) {
      return {
        issues: [
          {
            path: '(root)',
            message: prose`
              ${error instanceof Error ? error.message : String(error)}. Return a single JSON
              object and nothing else — no prose, no code fence, no explanation.
            `,
            source: 'schema',
          },
        ],
      };
    }

    const parsed = request.schema.safeParse(candidate);
    if (!parsed.success) {
      return { issues: issuesFromZod(parsed.error, candidate) };
    }

    return { value: parsed.data, issues: request.crossCheck?.(parsed.data, toolCalls) ?? [] };
  }
}

const toolResultMessage = (
  call: { toolCallId: string; toolName: string },
  output: { type: 'json'; value: JSONValue } | { type: 'error-text'; value: string },
): ModelMessage => ({
  role: 'tool',
  content: [
    {
      type: 'tool-result',
      toolCallId: call.toolCallId,
      toolName: call.toolName,
      output,
    },
  ],
});

const repairPrompt = (issues: RepairIssue[]): string => {
  const preamble = prose`
    That response was rejected. Fix these problems and return the corrected object in full — the
    complete object, not a patch or a description of the change.
  `;
  return `${preamble}\n\n${renderIssuesForModel(issues)}`;
};
