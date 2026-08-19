import { type z } from 'zod';
import { prose } from './text.ts';
import { type RepairIssue } from './zod.schema.ts';

/**
 * Rendering zod failures. Two audiences, two functions:
 *
 * - `formatZodError` is for a human reading a stack trace.
 * - `renderIssuesForModel` goes into the repair prompt. It is deliberately more
 *   explicit — a model correcting an `unrecognized_keys` needs to be told the
 *   schema is closed, because the wire schema already said so and it was not
 *   enough.
 */

const pathOf = (issue: z.core.$ZodIssue): string =>
  issue.path.length > 0 ? issue.path.map(String).join('.') : '(root)';

export const formatZodError = (error: z.ZodError): string =>
  error.issues.map((issue) => `  ${pathOf(issue)}: ${issue.message}`).join('\n');

/**
 * Turns a zod issue into an instruction. The generic zod message is already
 * decent; the additions here are the ones a model actually needs to act on.
 */
const describeIssue = (issue: z.core.$ZodIssue, value: unknown): string => {
  switch (issue.code) {
    case 'too_big': {
      const actual = valueAt(value, issue.path);
      if (typeof actual === 'string') {
        return prose`
          ${issue.message}. The value you returned is ${actual.length} characters. Rewrite it
          shorter — do not truncate mid-sentence.
        `;
      }
      return issue.message;
    }
    case 'unrecognized_keys': {
      const keys = (issue as { keys?: string[] }).keys ?? [];
      return prose`
        Unexpected key(s): ${keys.join(', ')}. The schema is closed — return only the fields it
        defines, spelled exactly as defined.
      `;
    }
    case 'invalid_value':
    case 'invalid_type':
      return `${issue.message}. Return exactly one of the permitted values.`;
    default:
      return issue.message;
  }
};

const valueAt = (root: unknown, path: readonly PropertyKey[]): unknown => {
  let current: unknown = root;
  for (const key of path) {
    if (current === null || typeof current !== 'object') return undefined;
    current = (current as Record<PropertyKey, unknown>)[key];
  }
  return current;
};

export const issuesFromZod = (error: z.ZodError, value: unknown): RepairIssue[] =>
  error.issues.map((issue) => ({
    path: pathOf(issue),
    message: describeIssue(issue, value),
    source: 'schema' as const,
  }));

/** The block appended to a repair request. */
export const renderIssuesForModel = (issues: RepairIssue[]): string => {
  const schemaIssues = issues.filter((issue) => issue.source === 'schema');
  const domainIssues = issues.filter((issue) => issue.source === 'consistency');

  const sections: string[] = [];

  if (schemaIssues.length > 0) {
    sections.push(`Schema violations:\n${schemaIssues.map(bullet).join('\n')}`);
  }
  if (domainIssues.length > 0) {
    sections.push(
      prose`
        Domain contradictions — these are facts computed from the transaction history and the
        batch, not opinions. Your classification must agree with them or name the conflict in its
        reasoning:
      ` + `\n${domainIssues.map(bullet).join('\n')}`,
    );
  }

  return sections.join('\n\n');
};

const bullet = (issue: RepairIssue): string => `- ${issue.path}: ${issue.message}`;
