import { z } from 'zod';
import { searchHistory } from './history.ts';
import { type HistoryIndex } from './history.schema.ts';
import { type ToolDefinition } from './llm.schema.ts';
import {
  SEARCH_HISTORY_DESCRIPTION,
  SEARCH_HISTORY_TOOL_NAME,
  SearchHistoryArgsSchema,
  type ToolCallRecord,
} from './tool.schema.ts';
import { formatZodError } from './zod.ts';

/** The tool as advertised to the model — schema and guard from one declaration. */
export const searchHistoryToolDefinition = (): ToolDefinition => ({
  name: SEARCH_HISTORY_TOOL_NAME,
  description: SEARCH_HISTORY_DESCRIPTION,
  input_schema: z.toJSONSchema(SearchHistoryArgsSchema, { io: 'input' }),
});

/**
 * Executes one model-authored search_history call.
 *
 * The parse is the guard: raw arguments are unknown until the schema accepts
 * them, and a rejection goes back to the model as the tool's output rather
 * than crashing the pipeline — a bad call is the model's mistake to correct.
 */
export const executeSearchHistory = (
  index: HistoryIndex,
  rawArguments: unknown,
  injected = false,
): ToolCallRecord => {
  const parsed = SearchHistoryArgsSchema.safeParse(rawArguments);
  if (!parsed.success) {
    return {
      name: 'search_history',
      raw_arguments: rawArguments,
      arguments: null,
      result: null,
      injected,
      error: `Invalid arguments:\n${formatZodError(parsed.error)}`,
    };
  }

  return {
    name: 'search_history',
    raw_arguments: rawArguments,
    arguments: parsed.data,
    result: searchHistory(index, parsed.data),
    injected,
    error: null,
  };
};
