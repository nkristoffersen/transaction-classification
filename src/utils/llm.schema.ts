import { z } from 'zod';
import { type ToolCallRecord } from './tool.schema.ts';
import { type RepairIssue } from './zod.schema.ts';

/**
 * Shapes of the structured-generation client. The request and result are
 * generic over the output type, so they are interfaces (skill carve-out 1),
 * with the callbacks as carve-out 2 — living here in the schema twin.
 */

/** A tool as advertised to the model. */
export const ToolDefinitionSchema = z.strictObject({
  name: z.string().min(1),
  description: z.string().min(1),
  /** JSON Schema for the arguments, ready for the wire. */
  input_schema: z.record(z.string(), z.unknown()),
});
export type ToolDefinition = z.infer<typeof ToolDefinitionSchema>;

// Generic over the parsed output type (carve-out 1) and carrying callbacks
// (carve-out 2).
export interface StructuredRequest<T> {
  schema: z.ZodType<T>;
  /** Name for the response_format block. */
  schemaName: string;
  system: string;
  user: string;
  /** Tools available to the model. Empty means a plain structured call. */
  tools: ToolDefinition[];
  /** Executes one model-authored call; the record carries result or error. */
  executeTool?: (name: string, rawArguments: unknown) => ToolCallRecord;
  /**
   * When set, a verdict with zero tool calls is a repair issue; a second
   * refusal triggers this fallback, which executes the default lookup in code
   * and returns it marked `injected`.
   */
  injectDefaultTool?: () => ToolCallRecord;
  /**
   * Semantic validation run after the schema parses. Returns issues that mean
   * the output is well-formed but wrong — a claimed recurring pattern the tool
   * results contradict, a sign that disagrees with the account. These feed the
   * same repair loop as schema failures.
   */
  crossCheck?: (value: T, toolCalls: ToolCallRecord[]) => RepairIssue[];
  /** Label for progress and error messages. */
  label: string;
}

// Generic over the parsed output type (carve-out 1).
export interface StructuredResult<T> {
  value: T;
  /** 0 when the first attempt was accepted. */
  repairAttempts: number;
  /** Every tool call this conversation executed, injected fallback included. */
  toolCalls: ToolCallRecord[];
  /** True when the model never called the tool and code had to. */
  toolCallMissing: boolean;
  /**
   * Domain contradictions the model would not resolve within the retry
   * budget. Non-empty means the output is schema-valid but disputed, and the
   * row is forced to accountant-review rather than dropped.
   */
  unresolvedIssues: RepairIssue[];
  /** Accumulated token usage across every turn of this conversation. */
  tokensIn: number;
  tokensOut: number;
}
