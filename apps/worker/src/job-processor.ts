import type {
  DatabaseConnection,
  DatabaseTransaction,
} from '@ikimetr/database';
import type { RedisClientType } from 'redis';

import {
  enqueueJob,
  dequeueJob,
  moveToDead,
  reapRetries,
  scheduleRetry,
} from './job-queue.js';

export class PermanentJobError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PermanentJobError';
  }
}

export interface JobRow {
  id: string;
  type: string;
  payload: unknown;
  attempts: number;
  maxAttempts: number;
}

export type JobHandler = (
  tx: DatabaseTransaction,
  payload: unknown,
  job: JobRow,
) => Promise<void>;

export interface JobProcessorOptions {
  db: DatabaseConnection;
  redis: RedisClientType;
  handlers: Record<string, JobHandler>;
  retryBaseDelayMs?: number;
  retryMaxDelayMs?: number;
  pollTimeoutMs?: number;
  retryCheckIntervalMs?: number;
  staleJobMs?: number;
}

interface JobDbRow {
  id: string;
  type: string;
  payload: unknown;
  attempts: number;
  max_attempts: number;
  status: string;
}

export interface JobProcessor {
  start(): Promise<void>;
  stop(): void;
  processOne(jobId: string): Promise<void>;
  recoverStale(): Promise<void>;
  runScheduler(): Promise<void>;
  requeuePending(): Promise<number>;
}

export function createJobProcessor(options: JobProcessorOptions): JobProcessor {
  const { db, redis, handlers } = options;
  const retryBaseDelayMs = options.retryBaseDelayMs ?? 2_000;
  const retryMaxDelayMs = options.retryMaxDelayMs ?? 60_000;
  const pollTimeoutMs = options.pollTimeoutMs ?? 2_000;
  const retryCheckIntervalMs = options.retryCheckIntervalMs ?? 1_000;
  const staleJobMs = options.staleJobMs ?? 300_000;

  let stopping = false;
  let running = false;

  async function recoverStale(): Promise<void> {
    const stale = await db.transaction((tx) =>
      tx.query<{ id: string }>(
        `UPDATE app.jobs SET status = 'queued', updated_at = now()
         WHERE status = 'processing' AND updated_at < now() - ($1 * interval '1 millisecond')
         RETURNING id`,
        [staleJobMs],
      ),
    );
    for (const row of stale.rows) {
      await enqueueJob(redis, row.id);
    }
  }

  async function requeuePending(): Promise<number> {
    // Re-enqueue durable `queued` jobs that were never claimed (e.g. the Redis
    // push after the DB insert failed, or was lost). The DB row is the source
    // of truth; this makes delivery eventually consistent. A job claimed by the
    // poll loop flips to `processing`, so it won't be re-selected next cycle.
    const rows = await db.transaction((tx) =>
      tx.query<{ id: string }>(
        `SELECT id FROM app.jobs
         WHERE status = 'queued'
           AND updated_at < now() - ($1 * interval '1 millisecond')
         FOR UPDATE SKIP LOCKED
         LIMIT 500`,
        [staleJobMs],
      ),
    );
    let requeued = 0;
    for (const row of rows.rows) {
      try {
        await enqueueJob(redis, row.id);
        requeued += 1;
      } catch {
        // Keep in DB; retried next cycle.
      }
    }
    return requeued;
  }

  async function processOne(jobId: string): Promise<void> {
    const loaded = await db.transaction((tx) =>
      tx.query<JobDbRow>(
        `SELECT id, type, payload, attempts, max_attempts, status
         FROM app.jobs WHERE id = $1`,
        [jobId],
      ),
    );
    if (loaded.rowCount === 0) {
      return;
    }
    const job = loaded.rows[0];
    if (!job) {
      return;
    }
    if (job.status === 'completed' || job.status === 'dead') {
      return;
    }

    const claimed = await db.transaction((tx) =>
      tx.query(
        `UPDATE app.jobs SET status = 'processing', updated_at = now()
         WHERE id = $1 AND status = 'queued'
         RETURNING id`,
        [jobId],
      ),
    );
    if (claimed.rowCount === 0) {
      return;
    }

    const handler = handlers[job.type];
    try {
      if (!handler) {
        throw new PermanentJobError(`unknown job type: ${job.type}`);
      }
      await db.transaction(async (tx) => {
        await handler(tx, job.payload, {
          id: job.id,
          type: job.type,
          payload: job.payload,
          attempts: job.attempts,
          maxAttempts: job.max_attempts,
        });
      });
      await db.transaction((tx) =>
        tx.query(
          `UPDATE app.jobs SET status = 'completed', last_error = NULL, updated_at = now()
           WHERE id = $1`,
          [jobId],
        ),
      );
    } catch (error) {
      const nextAttempts = job.attempts + 1;
      const isPermanent = error instanceof PermanentJobError;
      const exhausted = nextAttempts >= job.max_attempts;
      const message = error instanceof Error ? error.message : String(error);
      if (isPermanent || exhausted) {
        await db.transaction((tx) =>
          tx.query(
            `UPDATE app.jobs SET status = 'dead', attempts = $2, last_error = $3, updated_at = now()
             WHERE id = $1`,
            [jobId, nextAttempts, message],
          ),
        );
        await moveToDead(redis, jobId);
      } else {
        const delay = Math.min(
          retryMaxDelayMs,
          retryBaseDelayMs * 2 ** (nextAttempts - 1),
        );
        await db.transaction((tx) =>
          tx.query(
            `UPDATE app.jobs SET status = 'queued', attempts = $2, last_error = $3,
               scheduled_at = now() + ($4 * interval '1 millisecond'), updated_at = now()
             WHERE id = $1`,
            [jobId, nextAttempts, message, delay],
          ),
        );
        await scheduleRetry(redis, jobId, delay);
      }
    }
  }

  async function runScheduler(): Promise<void> {
    const due = await reapRetries(redis, Date.now());
    for (const jobId of due) {
      const reset = await db.transaction((tx) =>
        tx.query(
          `UPDATE app.jobs SET status = 'queued', updated_at = now()
           WHERE id = $1 AND status NOT IN ('completed', 'dead')
           RETURNING id`,
          [jobId],
        ),
      );
      if (reset.rowCount !== null && reset.rowCount > 0) {
        await enqueueJob(redis, jobId);
      }
    }
  }

  async function start(): Promise<void> {
    if (running) {
      return;
    }
    running = true;
    stopping = false;
    await recoverStale();
    await requeuePending();
    const scheduler = setInterval(() => {
      void runScheduler().catch(() => undefined);
      void requeuePending().catch(() => undefined);
    }, retryCheckIntervalMs);

    while (!stopping) {
      try {
        const jobId = await dequeueJob(redis, pollTimeoutMs);
        if (jobId) {
          await processOne(jobId);
        }
      } catch {
        if (!redis.isReady) {
          await new Promise((resolve) => setTimeout(resolve, pollTimeoutMs));
        }
      }
    }
    clearInterval(scheduler);
    running = false;
  }

  function stop(): void {
    stopping = true;
  }

  return {
    start,
    stop,
    processOne,
    recoverStale,
    runScheduler,
    requeuePending,
  };
}
