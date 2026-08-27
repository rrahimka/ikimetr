import type { DatabaseConnection } from '@ikimetr/database';

export interface EnqueueRedis {
  enqueue(jobId: string): Promise<void>;
}

export type EnqueueJob = (
  type: string,
  payload: unknown,
  idempotencyKey: string,
) => Promise<void>;

/**
 * Returns a job-enqueue function that is both idempotent and safe against
 * phantom rows:
 *
 *  - The job row is the source of truth and is created inside a transaction
 *    using `INSERT ... ON CONFLICT (idempotency_key) DO NOTHING`.
 *  - Only a *real* job id (one that exists in app.jobs) is ever pushed to
 *    Redis. On an idempotency-key collision we look up the existing row and
 *    re-enqueue it only if it is still pending; terminal jobs (completed/dead)
 *    are not re-enqueued.
 *  - The Redis push happens AFTER the DB transaction commits. If Redis is down
 *    at that moment the durable `queued` row remains in the DB and the worker
 *    reconciler (requeuePending) re-enqueues it later. This avoids the previous
 *    bug where a brand-new random UUID was unconditionally pushed even when the
 *    INSERT was a no-op, creating phantom jobs with no DB row.
 */
export function createJobEnqueue(
  db: DatabaseConnection,
  redis: EnqueueRedis,
): EnqueueJob {
  return async function enqueueJob(type, payload, idempotencyKey) {
    const resolved = await db.transaction(async (tx) => {
      const inserted = await tx.query<{ id: string; status: string }>(
        `INSERT INTO app.jobs (type, payload, idempotency_key)
         VALUES ($1, $2, $3)
         ON CONFLICT (idempotency_key) DO NOTHING
         RETURNING id, status`,
        [type, JSON.stringify(payload), idempotencyKey],
      );
      if (inserted.rowCount !== null && inserted.rowCount > 0) {
        return { id: inserted.rows[0]!.id, enqueue: true };
      }
      const existing = await tx.query<{ id: string; status: string }>(
        `SELECT id, status FROM app.jobs WHERE idempotency_key = $1`,
        [idempotencyKey],
      );
      const row = existing.rows[0];
      if (!row || row.status === 'completed' || row.status === 'dead') {
        return null;
      }
      return { id: row.id, enqueue: true };
    });

    if (resolved === null) {
      return;
    }
    if (resolved.enqueue) {
      try {
        await redis.enqueue(resolved.id);
      } catch {
        // Durable queued row remains; the worker reconciler re-enqueues it.
      }
    }
  };
}
