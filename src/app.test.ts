import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';

const run = promisify(execFile);

/**
 * The delivered command, spawned for real. The brief requires the system to
 * run end to end from one documented command, so the wiring — flags, env
 * loading, the endpoint-free paths — is tested through the actual entry point
 * rather than by importing its internals.
 */
const app = (...args: string[]): Promise<{ stdout: string; stderr: string }> =>
  run(process.execPath, ['src/app.ts', ...args], { timeout: 30_000 });

describe('the CLI, spawned', () => {
  it('prints usage on --help', async () => {
    const { stdout } = await app('--help');
    expect(stdout).toContain('--dry-run');
    expect(stdout).toContain('--explain-triage');
    expect(stdout).toContain('TRANSACTIONS_CSV');
  });

  it('explains the triage derivation without an endpoint', async () => {
    const { stdout } = await app('--explain-triage');
    expect(stdout).toContain('EXACT_RECURRING');
    expect(stdout).toContain('ACCOUNT_ALWAYS_ASK');
  });

  it('dry-runs the real request without sending anything', async () => {
    const { stdout } = await app('--dry-run', '--only', 't-00025');
    expect(stdout).toContain('=== Request for t-00025 ===');
    expect(stdout).toContain('search_history');
    expect(stdout).toContain('response_format');
  });

  it('fails loudly on an unknown --only id', async () => {
    await expect(app('--dry-run', '--only', 't-99999')).rejects.toThrow(/not in the input/);
  });
});
