import { describe, expect, it } from 'vitest';
import { FatalRunError, runPool } from './queue.ts';

const settle = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

describe('runPool', () => {
  it('preserves input order in the results', async () => {
    const outcomes = await runPool(
      [3, 1, 2],
      String,
      async (item) => {
        await settle(item);
        return item * 10;
      },
      { concurrency: 3, maxRetries: 0, isRetryable: () => false },
    );
    expect(
      outcomes.map((outcome) => (outcome.status === 'fulfilled' ? outcome.value : -1)),
    ).toEqual([30, 10, 20]);
  });

  it('bounds concurrency', async () => {
    let running = 0;
    let peak = 0;
    await runPool(
      Array.from({ length: 8 }, (_, index) => index),
      String,
      async () => {
        running++;
        peak = Math.max(peak, running);
        await settle(10);
        running--;
      },
      { concurrency: 2, maxRetries: 0, isRetryable: () => false },
    );
    expect(peak).toBeLessThanOrEqual(2);
  });

  it('retries retryable failures and then succeeds', async () => {
    let attempts = 0;
    const outcomes = await runPool(
      ['x'],
      String,
      () => {
        attempts++;
        return attempts < 3 ? Promise.reject(new Error('flaky')) : Promise.resolve('done');
      },
      { concurrency: 1, maxRetries: 3, isRetryable: () => true, baseDelayMs: 1 },
    );
    expect(outcomes[0]).toMatchObject({ status: 'fulfilled', value: 'done', attempts: 3 });
  });

  it('does not retry non-retryable failures', async () => {
    let attempts = 0;
    const outcomes = await runPool(
      ['x'],
      String,
      () => {
        attempts++;
        return Promise.reject(new Error('hard failure'));
      },
      { concurrency: 1, maxRetries: 3, isRetryable: () => false, baseDelayMs: 1 },
    );
    expect(attempts).toBe(1);
    expect(outcomes[0]?.status).toBe('rejected');
  });

  it('aborts the whole run on a fatal error', async () => {
    await expect(
      runPool(
        [1, 2, 3, 4],
        String,
        async (item) => {
          if (item === 1) throw new Error('401 unauthorized');
          await settle(50);
          return item;
        },
        {
          concurrency: 1,
          maxRetries: 3,
          isRetryable: () => true,
          isFatal: (error) => error instanceof Error && error.message.includes('401'),
          baseDelayMs: 1,
        },
      ),
    ).rejects.toThrow(FatalRunError);
  });
});
