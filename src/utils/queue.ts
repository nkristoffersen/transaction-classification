/**
 * A small worker pool with transport retry.
 *
 * Deliberately hand-rolled rather than pulled in: the brief wants the
 * orchestration visible, and a durable queue would need a broker, which works
 * against "one command to run the system".
 *
 * This layer handles failures where the response never arrived — rate limits,
 * server faults, dropped sockets. Failures where a response arrived and was
 * wrong are repaired conversationally inside `llm.ts`, because fixing those
 * needs the previous turn.
 */

import { type PoolOptions, type TaskOutcome } from './queue.schema.ts';

export class FatalRunError extends Error {
  override readonly cause: unknown;
  constructor(message: string, cause: unknown) {
    super(message);
    this.name = 'FatalRunError';
    this.cause = cause;
  }
}

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

/** Exponential backoff with jitter, so retries do not resynchronise. */
const backoffMs = (attempt: number, base: number): number => {
  const ceiling = Math.min(base * 2 ** (attempt - 1), 30_000);
  return Math.round(ceiling * (0.5 + Math.random() * 0.5));
};

export const runPool = async <TItem, TResult>(
  items: TItem[],
  identify: (item: TItem) => string,
  worker: (item: TItem, signal: AbortSignal) => Promise<TResult>,
  options: PoolOptions,
): Promise<TaskOutcome<TResult>[]> => {
  const results = new Array<TaskOutcome<TResult>>(items.length);
  const controller = new AbortController();
  const baseDelay = options.baseDelayMs ?? 500;

  let cursor = 0;
  let completed = 0;
  // A holder rather than a bare `let`: the only writer is processOne, which is
  // a nested function, and TypeScript's narrowing does not follow assignments
  // across a closure boundary. Through a property the narrowing resets at each
  // call, so the null checks below mean what they read as.
  const run: { fatal: FatalRunError | null } = { fatal: null };

  const processOne = async (index: number, item: TItem): Promise<void> => {
    const id = identify(item);
    let attempt = 0;

    while (true) {
      attempt++;
      options.onProgress?.({
        id,
        phase: attempt === 1 ? 'start' : 'retry',
        attempt,
        completed,
        total: items.length,
      });

      try {
        const value = await worker(item, controller.signal);
        completed++;
        results[index] = { status: 'fulfilled', id, value, attempts: attempt };
        options.onProgress?.({ id, phase: 'done', attempt, completed, total: items.length });
        return;
      } catch (error) {
        if (options.isFatal?.(error) === true) {
          // Stop the whole run rather than burn the remaining budget on a
          // failure that will repeat identically for every transaction.
          run.fatal ??= new FatalRunError(
            error instanceof Error ? error.message : String(error),
            error,
          );
          controller.abort();
          completed++;
          results[index] = { status: 'rejected', id, error, attempts: attempt };
          return;
        }

        const canRetry = attempt <= options.maxRetries && options.isRetryable(error);
        if (!canRetry || controller.signal.aborted) {
          completed++;
          results[index] = { status: 'rejected', id, error, attempts: attempt };
          options.onProgress?.({
            id,
            phase: 'failed',
            attempt,
            completed,
            total: items.length,
            error,
          });
          return;
        }

        await sleep(backoffMs(attempt, baseDelay));
      }
    }
  };

  const drain = async (): Promise<void> => {
    while (true) {
      const index = cursor++;
      const item = items[index];
      if (item === undefined) return;
      if (controller.signal.aborted && run.fatal !== null) {
        results[index] = {
          status: 'rejected',
          id: identify(item),
          error: run.fatal,
          attempts: 0,
        };
        continue;
      }
      await processOne(index, item);
    }
  };

  const workers = Array.from({ length: Math.min(options.concurrency, items.length) }, drain);
  await Promise.all(workers);

  if (run.fatal !== null) throw run.fatal;
  return results;
};
