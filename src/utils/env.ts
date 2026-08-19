import { envSchema, type Env } from './env.schema.ts';
import { formatZodError } from './zod.ts';

/**
 * Inside a container, a loopback address means the container itself — so a
 * `.env` pointing at a model server on the developer's machine fails with a
 * connection error on every transaction.
 *
 * Rather than make people keep two different values for the same setting, the
 * loopback host can be rewritten to `host.docker.internal`, which compose maps
 * back to the host. The effective URL appears in the run header, so the
 * substitution is visible rather than magic.
 *
 * This is opt-in via REWRITE_LOOPBACK_HOST, set by the compose services that
 * talk to a real model. Detecting the container automatically would be wrong:
 * the test suite runs its stub endpoint on loopback *inside* the same
 * container, and rewriting that address would send it out to the host.
 */
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '0.0.0.0', '::1', '[::1]']);
const HOST_FROM_CONTAINER = 'host.docker.internal';

export const loopbackRewriteEnabled = (source: NodeJS.ProcessEnv = process.env): boolean =>
  source['REWRITE_LOOPBACK_HOST'] === 'true';

export const resolveBaseUrl = (baseUrl: string, inContainer: boolean): string => {
  if (!inContainer) return baseUrl;
  try {
    const url = new URL(baseUrl);
    if (!LOOPBACK_HOSTS.has(url.hostname)) return baseUrl;
    url.hostname = HOST_FROM_CONTAINER;
    return url.toString().replace(/\/+$/, '');
  } catch {
    return baseUrl;
  }
};

/**
 * Hosts known to pass JSON Schema `description` fields through to the model.
 *
 * This matters more than it looks. All of this system's accounting knowledge
 * lives in zod `.describe()` calls, which become schema descriptions. Local
 * constrained decoders (llama.cpp GBNF, outlines, xgrammar) compile the schema
 * to a grammar and drop descriptions entirely — the model would be forced into
 * the right shape while never reading a word of the guidance. Where we cannot
 * be sure, we render the schema into the message as well.
 */
const DESCRIPTION_RESPECTING_HOSTS = [
  'api.openai.com',
  'openrouter.ai',
  'api.mistral.ai',
  'api.deepseek.com',
  'api.groq.com',
  'api.together.xyz',
  'api.fireworks.ai',
  'api.anthropic.com',
];

export const hostRespectsDescriptions = (baseUrl: string): boolean => {
  try {
    const { hostname } = new URL(baseUrl);
    return DESCRIPTION_RESPECTING_HOSTS.some(
      (host) => hostname === host || hostname.endsWith(`.${host}`),
    );
  } catch {
    return false;
  }
};

/**
 * Parses and validates the environment. Throws — a bad config is a bug to fix
 * before any tokens are spent, not a condition to degrade through.
 */
export const loadEnv = (source: NodeJS.ProcessEnv = process.env): Env => {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    throw new Error(`Invalid environment:\n${formatZodError(parsed.error)}`);
  }
  return {
    ...parsed.data,
    LLM_BASE_URL: resolveBaseUrl(parsed.data.LLM_BASE_URL, loopbackRewriteEnabled(source)),
  };
};

/** Whether to also render the JSON Schema into the message body. */
export const shouldRenderSchemaInPrompt = (env: Env): boolean => {
  if (env.SCHEMA_IN_PROMPT === 'always') return true;
  if (env.SCHEMA_IN_PROMPT === 'never') return false;
  return !hostRespectsDescriptions(env.LLM_BASE_URL);
};

/** Run header. Never prints the API key. */
export const describeEnv = (env: Env): string => {
  const rows: [string, string][] = [
    ['endpoint', env.LLM_BASE_URL],
    ['model', env.LLM_MODEL],
    ['auth', env.LLM_API_KEY === '' ? 'none (local endpoint)' : 'api key set'],
    ['schema in prompt', shouldRenderSchemaInPrompt(env) ? 'yes' : 'no'],
    ['temperature', String(env.LLM_TEMPERATURE)],
    ['seed', env.LLM_SEED === null ? 'unset' : String(env.LLM_SEED)],
    ['materiality (NOK)', String(env.MATERIALITY_NOK)],
    ['concurrency', String(env.CONCURRENCY)],
    ['repair attempts', String(env.MAX_REPAIR_ATTEMPTS)],
    ['tool call cap', String(env.MAX_TOOL_CALLS)],
  ];
  const width = Math.max(...rows.map(([label]) => label.length));
  return rows.map(([label, value]) => `  ${label.padEnd(width)}  ${value}`).join('\n');
};
