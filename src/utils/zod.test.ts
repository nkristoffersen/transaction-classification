import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { formatZodError, issuesFromZod, renderIssuesForModel } from './zod.ts';

const Schema = z.strictObject({
  name: z.string().max(10),
  level: z.enum(['LOW', 'HIGH']),
});

describe('issuesFromZod', () => {
  it('tells the model the actual length against a string limit', () => {
    const value = { name: 'far too long for the limit', level: 'LOW' };
    const parsed = Schema.safeParse(value);
    expect(parsed.success).toBe(false);
    if (parsed.success) return;

    const issues = issuesFromZod(parsed.error, value);
    expect(issues[0]?.path).toBe('name');
    expect(issues[0]?.message).toContain('26 characters');
    expect(issues[0]?.source).toBe('schema');
  });

  it('names unexpected keys and says the schema is closed', () => {
    const value = { name: 'ok', level: 'LOW', invented: true };
    const parsed = Schema.safeParse(value);
    expect(parsed.success).toBe(false);
    if (parsed.success) return;

    const issues = issuesFromZod(parsed.error, value);
    expect(issues.some((issue) => issue.message.includes('invented'))).toBe(true);
  });
});

describe('renderIssuesForModel', () => {
  it('separates schema violations from domain contradictions', () => {
    const rendered = renderIssuesForModel([
      { path: 'a', message: 'wrong shape', source: 'schema' },
      { path: 'b', message: 'contradicts history', source: 'consistency' },
    ]);
    expect(rendered).toContain('Schema violations:');
    expect(rendered).toContain('Domain contradictions');
    expect(rendered).toContain('- a: wrong shape');
    expect(rendered).toContain('- b: contradicts history');
  });
});

describe('formatZodError', () => {
  it('renders paths for humans', () => {
    const parsed = Schema.safeParse({ name: 1, level: 'LOW' });
    expect(parsed.success).toBe(false);
    if (parsed.success) return;
    expect(formatZodError(parsed.error)).toContain('name:');
  });
});
