import { defineConfig } from 'vitest/config';

/**
 * The eval is a separate suite from the tests, on purpose.
 *
 * `npm test` must stay free, fast, offline and deterministic — it runs against
 * a stub and deliberately does NOT read .env, so it cannot accidentally start
 * calling a real endpoint. `npm run eval` is the opposite: it reads .env the
 * same way the CLI does, calls a real model, costs money and will not give
 * identical answers twice. Mixing the two would make the test suite
 * untrustworthy as a gate.
 */

// vitest does not honour `node --env-file`, so load it the same way app.ts
// gets it. Existing environment variables win, so a one-off override on the
// command line still works.
try {
  process.loadEnvFile('.env');
} catch {
  // No .env: the eval detects the missing endpoint and skips.
}

// A full 55-transaction batch takes minutes on a hosted model and considerably
// longer on a local one. Raise EVAL_TIMEOUT_MS for slower setups, or set
// EVAL_ONLY to a few transactions.
const timeout = Number(process.env['EVAL_TIMEOUT_MS'] ?? 3_600_000);

export default defineConfig({
  test: {
    include: ['src/**/*.eval.ts'],
    testTimeout: timeout,
    hookTimeout: timeout,
    // One model at a time: concurrent suites would multiply the rate-limit
    // pressure and make the reported timings meaningless.
    fileParallelism: false,
    sequence: { concurrent: false },
    reporters: ['verbose'],
    // Child processes inherit the loaded configuration.
    env: { ...process.env } as Record<string, string>,
  },
});
