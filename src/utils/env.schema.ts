import { z } from 'zod';
import { prose } from './text.ts';

// Define schema for environment variables
export const envSchema = z.object({
  // llm provider variables
  //
  // Any OpenAI-compatible /chat/completions endpoint. The three target classes
  // are a local server (LM Studio, vLLM, Ollama), hosted OpenAI, and an
  // aggregator such as OpenRouter.
  //
  LLM_BASE_URL: z
    .url()
    .default('http://localhost:1234/v1')
    .transform((url) => url.replace(/\/+$/, ''))
    .describe('Base URL of the OpenAI-compatible endpoint'),
  LLM_API_KEY: z
    .string()
    .default('')
    .describe('API key. Empty is valid — local servers accept any token'),
  LLM_MODEL: z
    .string()
    .min(1, 'LLM_MODEL is required')
    .default('qwen/qwen3.5-9b')
    .describe('Model id to send in the request body'),

  // structured output variables
  //
  SCHEMA_IN_PROMPT: z.enum(['auto', 'always', 'never']).default('auto').describe(prose`
      Also render the JSON Schema into the message. Required for local constrained decoders, which
      compile the schema to a grammar and discard every \`description\` — the model would otherwise
      never see any of the accounting guidance
    `),

  // determinism variables
  //
  // "The same transaction categorized differently on different days" is the
  // failure that costs a triage output its audience, so the shipped default is
  // temperature 0. The seed is forwarded to providers that honour it, which is
  // what makes a run reproducible at a non-zero temperature.
  //
  LLM_TEMPERATURE: z.coerce.number().min(0).max(2).default(0).describe(prose`
      Sampling temperature. 0 is the reproducible default; set what the model vendor recommends and
      let the eval report what it costs in agreement
    `),
  LLM_SEED: z
    .string()
    .default('7')
    .transform((val) => {
      const trimmed = val.trim().toLowerCase();
      return trimmed === '' || trimmed === 'none' ? null : Number(trimmed);
    })
    .pipe(z.number().int().nullable()).describe(prose`
      Seed forwarded to providers that support it. Empty or "none" to omit
    `),

  // input and output paths
  //
  // Defaults are the files the exercise ships with, so `npm start` needs no
  // arguments. The --transactions / --history / --chart / --out flags override
  // these; the env vars exist because the Docker services run a fixed command,
  // where setting a variable is easier than editing the compose file.
  //
  TRANSACTIONS_CSV: z
    .string()
    .min(1)
    .default('ai-engineer/data/transactions.csv')
    .describe('Path to the batch of transactions to classify'),
  HISTORY_JSON: z
    .string()
    .min(1)
    .default('ai-engineer/data/history.json')
    .describe('Path to the prior categorized transactions'),
  CHART_JSON: z
    .string()
    .min(1)
    .default('ai-engineer/data/chart-of-accounts.json')
    .describe('Path to the chart of accounts'),
  OUTPUT_PATH: z
    .string()
    .min(1)
    .default('results.json')
    .describe('Path the classification results are written to'),

  // triage policy
  //
  MATERIALITY_NOK: z.coerce.number().positive().default(20_000).describe(prose`
      Absolute NOK amount above which a transaction without exact recurring history support is at
      least accountant-review, whatever the model reported
    `),

  // orchestration variables
  //
  CONCURRENCY: z.coerce
    .number()
    .int()
    .min(1)
    .max(32)
    .default(4)
    .describe('Worker pool size for per-transaction classification'),
  MAX_REPAIR_ATTEMPTS: z.coerce
    .number()
    .int()
    .min(1)
    .max(10)
    .default(3)
    .describe(
      'Attempts at getting a schema-valid, self-consistent classification. Each retry embeds ' +
        'the previous failure',
    ),
  MAX_TOOL_CALLS: z.coerce
    .number()
    .int()
    .min(1)
    .max(10)
    .default(4)
    .describe('Cap on search_history calls per transaction before the model must answer'),
  MAX_TRANSPORT_RETRIES: z.coerce
    .number()
    .int()
    .min(0)
    .max(10)
    .default(3)
    .describe('Retries for 429/5xx/network failures, distinct from repair attempts'),
  REQUEST_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .min(1_000)
    .max(600_000)
    .default(120_000)
    .describe('Per-request timeout'),
});
export type Env = z.infer<typeof envSchema>;
