import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    // The integration tests stand up a real HTTP stub and drive the client
    // against it; give them room but keep them honest.
    testTimeout: 20_000,
    coverage: {
      include: ['src/**/*.ts'],
      exclude: [
        'src/**/*.test.ts',
        'src/**/*.eval.ts',
        // Schemas are declarations; they are exercised through the modules
        // that parse with them.
        'src/**/*.schema.ts',
        // app.ts IS covered, by a test that spawns the real command as a
        // child process — which is the whole point, since the brief requires
        // the system to run from one command. v8 does not instrument the
        // child, so it would otherwise report a misleading 0%.
        'src/app.ts',
      ],
    },
  },
});
