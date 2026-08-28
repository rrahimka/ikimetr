import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { JOB_DEAD_KEY } from '@ikimetr/shared';
import {
  createDatabaseConnection,
  type DatabaseConnection,
} from '@ikimetr/database';

import {
  createJobProcessor,
  PermanentJobError,
  type JobHandler,
} from '../src/job-processor.js';
import {
  dequeueJob,
  enqueueJob as pushToQueue,
  scheduleRetry,
} from '../src/job-queue.js';
import { handleNotificationDeliver } from '../src/handlers/notifications.js';
import {
  createTestDatabase,
  createTestRedis,
  dropTestDatabase,
  insertUser,
  migrateDatabase,
  type TestDatabase,
} from './helpers.js';

describe('worker job processing', () => {
  let db: TestDatabase;
  let connection: DatabaseConnection;
  let redis: ReturnType<typeof createTestRedis>;

  beforeAll(async () => {
    db = await createTestDatabase();
    await migrateDatabase(db.databaseUrl);
    connection = createDatabaseConnection(db.databaseUrl);
    redis = createTestRedis();
    await redis.connect();
  });

  afterAll(async () => {
    await connection.close();
    redis.destroy();
    await dropTestDatabase(db);
  });

  beforeEach(async () => {
    await redis.flushDb();
    await connection.transaction((tx) =>
      tx.query(
        `TRUNCATE app.jobs, app.notifications, app.notification_preferences,
         app.conversation_participants, app.messages, app.conversations, app.users
         RESTART IDENTITY CASCADE`,
      ),
    );
  });

  async function enqueue(
    type: string,
    payload: unknown,
    idempotencyKey: string = randomUUID(),
  ): Promise<string> {
    const jobId = randomUUID();
    await connection.transaction((tx) =>
      tx.query(
        `INSERT INTO app.jobs (id, type, payload, idempotency_key, max_attempts, status, scheduled_at)
         VALUES ($1, $2, $3, $4, 5, 'queued', now())
         ON CONFLICT (idempotency_key) DO NOTHING`,
        [jobId, type, JSON.stringify(payload), idempotencyKey],
      ),
    );
    await pushToQueue(redis, jobId);
    return jobId;
  }

  async function notificationCount(userId: string): Promise<number> {
    const result = await connection.transaction((tx) =>
      tx.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM app.notifications WHERE user_id = $1`,
        [userId],
      ),
    );
    return Number(result.rows[0]?.count ?? '0');
  }

  async function jobStatus(jobId: string): Promise<string | null> {
    const result = await connection.transaction((tx) =>
      tx.query<{ status: string }>(
        `SELECT status FROM app.jobs WHERE id = $1`,
        [jobId],
      ),
    );
    return result.rowCount !== null && result.rowCount > 0
      ? result.rows[0]!.status
      : null;
  }

  function buildProcessor(extraHandlers: Record<string, JobHandler> = {}) {
    return createJobProcessor({
      db: connection,
      redis,
      handlers: {
        'notification.deliver': handleNotificationDeliver,
        ...extraHandlers,
      },
    });
  }

  it('delivers a notification to the correct user only', async () => {
    const userA = await insertUser(connection);
    const userB = await insertUser(connection);
    const processor = buildProcessor();

    const jobId = await enqueue('notification.deliver', {
      userId: userA,
      type: 'new_message',
      title: 'hi',
      body: 'hello',
      idempotencyKey: 'note:a',
    });
    await processor.processOne(jobId);

    expect(await jobStatus(jobId)).toBe('completed');
    expect(await notificationCount(userA)).toBe(1);
    expect(await notificationCount(userB)).toBe(0);
  });

  it('uses durable job keys instead of payload idempotency keys', async () => {
    const userA = await insertUser(connection);
    const processor = buildProcessor();

    const first = await enqueue(
      'notification.deliver',
      {
        userId: userA,
        type: 'new_message',
        title: 'hi',
        body: 'hello',
        idempotencyKey: 'note:dup',
      },
      'job:first',
    );
    const second = await enqueue(
      'notification.deliver',
      {
        userId: userA,
        type: 'new_message',
        title: 'hi',
        body: 'hello',
        idempotencyKey: 'note:dup',
      },
      'job:second',
    );
    await processor.processOne(first);
    await processor.processOne(second);

    expect(await notificationCount(userA)).toBe(2);
  });

  it('retries a transient failure a bounded number of times then succeeds', async () => {
    let calls = 0;
    const processor = buildProcessor({
      'test.transient': async () => {
        calls += 1;
        if (calls < 3) {
          throw new Error('transient failure');
        }
      },
    });

    const jobId = await enqueue('test.transient', {});
    for (let i = 0; i < 10; i++) {
      if ((await jobStatus(jobId)) === 'completed') {
        break;
      }
      await processor.processOne(jobId);
    }

    expect(await jobStatus(jobId)).toBe('completed');
    expect(calls).toBe(3);
    expect(await redis.lRange(JOB_DEAD_KEY, 0, -1)).not.toContain(jobId);
  });

  it('does not retry a permanent failure', async () => {
    const processor = buildProcessor({
      'test.permanent': async () => {
        throw new PermanentJobError('bad payload');
      },
    });

    const jobId = await enqueue('test.permanent', {});
    await processor.processOne(jobId);

    expect(await jobStatus(jobId)).toBe('dead');
    expect(await redis.lRange(JOB_DEAD_KEY, 0, -1)).toContain(jobId);
  });

  it('marks a job dead when its payload is invalid', async () => {
    const processor = buildProcessor();
    const jobId = await enqueue('notification.deliver', {
      type: 'new_message',
    });
    await processor.processOne(jobId);
    expect(await jobStatus(jobId)).toBe('dead');
  });

  it('marks an unknown job type as dead', async () => {
    const processor = buildProcessor();
    const jobId = await enqueue('unknown.type', {});
    await processor.processOne(jobId);
    expect(await jobStatus(jobId)).toBe('dead');
  });

  it('recovers a stale processing job after a crash', async () => {
    const userA = await insertUser(connection);
    const processor = buildProcessor();

    const jobId = await connection.transaction((tx) =>
      tx.query<{ id: string }>(
        `INSERT INTO app.jobs (id, type, payload, status, updated_at)
         VALUES ($1, 'notification.deliver', $2, 'processing', now() - interval '10 minutes')
         RETURNING id`,
        [
          randomUUID(),
          JSON.stringify({
            userId: userA,
            type: 'new_message',
            idempotencyKey: 'note:stale',
          }),
        ],
      ),
    );
    const id = jobId.rows[0]!.id;

    await processor.recoverStale();
    const dequeued = await dequeueJob(redis, 1000);
    expect(dequeued).toBe(id);
    await processor.processOne(id);

    expect(await jobStatus(id)).toBe('completed');
    expect(await notificationCount(userA)).toBe(1);
  });

  it('re-enqueues due retries through the scheduler', async () => {
    const processor = buildProcessor();
    const jobId = await enqueue('test.noop', {});
    await scheduleRetry(redis, jobId, 0);
    await connection.transaction((tx) =>
      tx.query(`UPDATE app.jobs SET status = 'queued' WHERE id = $1`, [jobId]),
    );

    await processor.runScheduler();
    const dequeued = await dequeueJob(redis, 1000);
    expect(dequeued).toBe(jobId);
  });

  it('replays a crashed notification job without creating a duplicate', async () => {
    const userB = await insertUser(connection);
    const processor = buildProcessor();

    // Payload shape is byte-identical to what apps/api/src/messaging/service.ts
    // sendMessage enqueues for a `notification.deliver` job: it intentionally
    // carries NO idempotencyKey (the durable key lives on app.jobs).
    const payload = {
      userId: userB,
      type: 'new_message',
      referenceType: 'conversation',
      referenceId: '11111111-1111-1111-1111-111111111111',
      title: 'New message',
      body: 'hello',
    };
    const durableKey = `new_message:msg-1:${userB}`;
    const jobId = await enqueue('notification.deliver', payload, durableKey);

    // Simulate the crash window: the handler side effect commits (notification
    // row inserted) but the process crashes before the job status is flipped to
    // 'completed'. We claim the job, run the handler inside its own committed
    // transaction, then leave the job as 'processing'.
    const claimed = await connection.transaction((tx) =>
      tx.query<{ id: string; payload: unknown; idempotency_key: string | null }>(
        `UPDATE app.jobs
         SET status = 'processing'
         WHERE id = $1
         RETURNING id, payload, idempotency_key`,
        [jobId],
      ),
    );
    const claimedJob = claimed.rows[0]!;
    await connection.transaction(async (tx) => {
      await handleNotificationDeliver(tx, claimedJob.payload, {
        id: claimedJob.id,
        idempotencyKey: claimedJob.idempotency_key,
      });
    });
    expect(await notificationCount(userB)).toBe(1);

    // Crash recovery: a stale/processing job is reset to 'queued' (as
    // recoverStale / requeuePending do) and replayed by the worker.
    await connection.transaction((tx) =>
      tx.query(
        `UPDATE app.jobs SET updated_at = now() - interval '10 minutes' WHERE id = $1`,
        [jobId],
      ),
    );
    await processor.recoverStale();

    await processor.processOne(jobId);

    expect(await notificationCount(userB)).toBe(1);
    expect(await jobStatus(jobId)).toBe('completed');
    const stored = await connection.transaction((tx) =>
      tx.query<{ idempotency_key: string | null }>(
        `SELECT idempotency_key FROM app.notifications WHERE user_id = $1`,
        [userB],
      ),
    );
    expect(stored.rows[0]?.idempotency_key).toBe(durableKey);
  });
});
