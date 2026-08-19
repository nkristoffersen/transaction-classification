import { describe, expect, it } from 'vitest';
import {
  describeEnv,
  hostRespectsDescriptions,
  loadEnv,
  resolveBaseUrl,
  shouldRenderSchemaInPrompt,
} from './env.ts';

describe('loadEnv', () => {
  it('supplies working defaults from an empty environment', () => {
    const env = loadEnv({});
    expect(env.LLM_BASE_URL).toBe('http://localhost:1234/v1');
    expect(env.LLM_MODEL).toBe('qwen/qwen3.5-9b');
    expect(env.LLM_TEMPERATURE).toBe(0);
    expect(env.LLM_SEED).toBe(7);
    expect(env.TRANSACTIONS_CSV).toBe('ai-engineer/data/transactions.csv');
    expect(env.MATERIALITY_NOK).toBe(20_000);
  });

  it('coerces numerics and rejects nonsense', () => {
    expect(loadEnv({ CONCURRENCY: '8' }).CONCURRENCY).toBe(8);
    expect(() => loadEnv({ CONCURRENCY: 'many' })).toThrow(/Invalid environment/);
    expect(() => loadEnv({ LLM_BASE_URL: 'not a url' })).toThrow(/Invalid environment/);
  });

  it('treats an empty or "none" seed as unset', () => {
    expect(loadEnv({ LLM_SEED: '' }).LLM_SEED).toBeNull();
    expect(loadEnv({ LLM_SEED: 'none' }).LLM_SEED).toBeNull();
    expect(loadEnv({ LLM_SEED: '42' }).LLM_SEED).toBe(42);
  });

  it('rewrites loopback only when the container opts in', () => {
    const rewritten = loadEnv({
      LLM_BASE_URL: 'http://localhost:1234/v1',
      REWRITE_LOOPBACK_HOST: 'true',
    });
    expect(rewritten.LLM_BASE_URL).toBe('http://host.docker.internal:1234/v1');

    const untouched = loadEnv({ LLM_BASE_URL: 'http://localhost:1234/v1' });
    expect(untouched.LLM_BASE_URL).toBe('http://localhost:1234/v1');
  });
});

describe('resolveBaseUrl', () => {
  it('never rewrites a non-loopback host', () => {
    expect(resolveBaseUrl('https://api.openai.com/v1', true)).toBe('https://api.openai.com/v1');
  });
});

describe('schema-in-prompt policy', () => {
  it('defaults on for local endpoints, off for hosts that surface descriptions', () => {
    expect(hostRespectsDescriptions('http://localhost:1234/v1')).toBe(false);
    expect(hostRespectsDescriptions('https://api.openai.com/v1')).toBe(true);

    expect(shouldRenderSchemaInPrompt(loadEnv({}))).toBe(true);
    expect(shouldRenderSchemaInPrompt(loadEnv({ LLM_BASE_URL: 'https://api.openai.com/v1' }))).toBe(
      false,
    );
    expect(
      shouldRenderSchemaInPrompt(
        loadEnv({ LLM_BASE_URL: 'https://api.openai.com/v1', SCHEMA_IN_PROMPT: 'always' }),
      ),
    ).toBe(true);
  });
});

describe('describeEnv', () => {
  it('never prints the API key', () => {
    const text = describeEnv(loadEnv({ LLM_API_KEY: 'sk-secret-value' }));
    expect(text).not.toContain('sk-secret-value');
    expect(text).toContain('api key set');
  });
});
