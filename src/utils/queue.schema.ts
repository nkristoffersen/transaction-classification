import { z } from 'zod';

/**
 * Shapes of the worker pool. Zod-first where zod can express the shape; the
 * two remaining interfaces are genuine skill carve-outs (a generic envelope
 * and a callback bag), living here in the schema twin like every other type.
 */

/** A progress callback event. Plain data, so it starts as a schema. */
export const ProgressEventSchema = z.strictObject({
  id: z.string().min(1),
  phase: z.enum(['start', 'retry', 'done', 'failed']),
  attempt: z.number().int(),
  completed: z.number().int(),
  total: z.number().int(),
  /** The raw failure, present on `failed` (and some `retry`) events. */
  error: z.unknown().optional(),
});
export type ProgressEvent = z.infer<typeof ProgressEventSchema>;

// Generic result envelope (skill carve-out 1: generic parameter).
export type TaskOutcome<T> =
  | { status: 'fulfilled'; id: string; value: T; attempts: number }
  | { status: 'rejected'; id: string; error: unknown; attempts: number };

// Predicates and callbacks (skill carve-out 2: functions).
export interface PoolOptions {
  concurrency: number;
  maxRetries: number;
  /** Whether a failure is worth another attempt. */
  isRetryable: (error: unknown) => boolean;
  /** A failure so terminal the whole run should stop, e.g. a bad API key. */
  isFatal?: (error: unknown) => boolean;
  onProgress?: (event: ProgressEvent) => void;
  baseDelayMs?: number;
}
