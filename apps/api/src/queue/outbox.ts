import type { DatabaseTransaction } from '@ikimetr/database';

import type { EnqueueRedis } from './enqueue.js';

export interface Outbox {
  /**
   * Inserts a durable job row inside an *existing* business transaction so the
   * business mutation and the job row commit atomically. Returns the job id, or
   * `null` when the idempotency key already maps to a terminal job (completed /
   * dead) and therefore must not be re-enqueued.
   *
   * The caller collects the returned ids and calls `wake` AFTER the transaction
   * commits. This guarantees Redis is never the only proof that a job exists.
   */
  insertJob(
    tx: DatabaseTransaction,
    type: string,
    payload: unknown,
    idempotencyKey: string,
  ): Promise<string | null>;
  /**
   * Best-effort push of a committed job id to Redis so the worker wakes. Called
   * only after the DB transaction has committed; failures are swallowed because
   * the durable `queued` row remains and the worker reconciler re-enqueues it.
   */
  wake(jobId: string): Promise<void>;
}

/**
 * Inserts a durable job row within the supplied transaction. The job row is the
 * source of truth; Redis is only a best-effort wake signal.
 */
export async function insertJobRow(
  tx: DatabaseTransaction,
  type: string,
  payload: unknown,
  idempotencyKey: string,
): Promise<string | null> {
  const inserted = await tx.query<{ id: string; status: string }>(
    `INSERT INTO app.jobs (type, payload, idempotency_key)
     VALUES ($1, $2, $3)
     ON CONFLICT (idempotency_key) DO NOTHING
     RETURNING id, status`,
    [type, JSON.stringify(payload), idempotencyKey],
  );
  if (inserted.rowCount !== null && inserted.rowCount > 0) {
    return inserted.rows[0]!.id;
  }
  const existing = await tx.query<{ id: string; status: string }>(
    `SELECT id, status FROM app.jobs WHERE idempotency_key = $1`,
    [idempotencyKey],
  );
  const row = existing.rows[0];
  if (!row || row.status === 'completed' || row.status === 'dead') {
    return null;
  }
  return row.id;
}

export async function wakeJob(
  redis: EnqueueRedis,
  jobId: string,
): Promise<void> {
  try {
    await redis.enqueue(jobId);
  } catch {
    // Durable queued row remains; the worker reconciler re-enqueues it.
  }
}

export function createOutbox(redis: EnqueueRedis): Outbox {
  return {
    insertJob: insertJobRow,
    wake(jobId) {
      return wakeJob(redis, jobId);
    },
  };
}
