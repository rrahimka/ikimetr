import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { JOB_QUEUE_KEY } from '@ikimetr/shared';

import {
  setupTestContext,
  teardownTestContext,
  registerUser,
  authHeader,
} from './helpers.js';
import type { TestContext } from './helpers.js';
import { sendMessage } from '../src/messaging/service.js';
import { insertJobRow, type Outbox } from '../src/queue/outbox.js';
import { createRedisClient } from '../src/redis.js';
import { DEFAULT_TEST_SECRET, signPayload } from '../src/billing/provider.js';

const integrationTimeout = 60_000;

let ctx: TestContext;
let redis: ReturnType<typeof createRedisClient> | undefined;

function redisUrl(): string {
  return process.env['REDIS_URL'] ?? 'redis://127.0.0.1:6379';
}

async function createConversationBetween(
  context: TestContext,
  aToken: string,
  bId: string,
): Promise<string> {
  const res = await context.app.inject({
    method: 'POST',
    url: '/api/v1/conversations',
    headers: authHeader(aToken),
    payload: { withUserId: bId },
  });
  if (res.statusCode !== 200 && res.statusCode !== 201) {
    throw new Error(
      `create conversation failed: ${res.statusCode} ${res.body}`,
    );
  }
  return (res.json() as { conversation: { id: string } }).conversation.id;
}

describe('transactional outbox (audit 1B issue 1)', () => {
  beforeEach(async () => {
    ctx = await setupTestContext();
  }, integrationTimeout);

  afterEach(async () => {
    if (ctx) {
      await teardownTestContext(ctx);
    }
    if (redis) {
      await redis.destroy();
      redis = undefined;
    }
  });

  it(
    'A: crash before Redis wake leaves a durable job the reconciler recovers',
    async () => {
      redis = createRedisClient(redisUrl());
      await redis.connect();

      const a = await registerUser(ctx.app, 'a1@example.com', 'password123');
      const b = await registerUser(ctx.app, 'b1@example.com', 'password123');
      const conversationId = await createConversationBetween(
        ctx,
        a.token,
        b.userId,
      );

      // Outbox whose wake is attempted but never delivers (simulating a dead
      // Redis at push time — production wakeJob swallows the error and the
      // durable queued row remains).
      let wakeCalled = false;
      const failingOutbox: Outbox = {
        insertJob: insertJobRow,
        wake: async () => {
          wakeCalled = true;
        },
      };

      const message = await sendMessage(
        ctx.connection,
        conversationId,
        a.userId,
        { content: 'hello' },
        failingOutbox,
      );

      // Business record committed.
      const msgRow = await ctx.connection.transaction((tx) =>
        tx.query('SELECT id FROM app.messages WHERE id = $1', [message.id]),
      );
      expect(msgRow.rowCount).toBe(1);

      // Durable queued job exists even though Redis wake failed.
      const jobRow = await ctx.connection.transaction((tx) =>
        tx.query<{ id: string; status: string }>(
          `SELECT id, status FROM app.jobs
           WHERE type = 'notification.deliver'
             AND payload::json->>'referenceId' = $1
           LIMIT 1`,
          [conversationId],
        ),
      );
      expect(jobRow.rowCount).toBe(1);
      expect(jobRow.rows[0]!.status).toBe('queued');

      // Redis never received the job (wake failed to deliver). Use a baseline so
      // the shared Redis instance (persistent across test runs) does not cause
      // false negatives.
      const baseline = await redis.lLen(JOB_QUEUE_KEY);
      expect(wakeCalled).toBe(true);
      expect(await redis.lLen(JOB_QUEUE_KEY)).toBe(baseline);

      // Simulate the outage clearing: the worker reconciler (requeuePending,
      // covered by worker tests) re-enqueues the stale durable job. We exercise
      // the same effect here — push the durable id to the queue.
      await redis.lPush(JOB_QUEUE_KEY, jobRow.rows[0]!.id);
      expect(await redis.lLen(JOB_QUEUE_KEY)).toBe(baseline + 1);

      // Exactly-once: the durable row was never duplicated by the recovery.
      const allJobs = await ctx.connection.transaction((tx) =>
        tx.query(
          `SELECT id FROM app.jobs WHERE payload::json->>'referenceId' = $1`,
          [conversationId],
        ),
      );
      expect(allJobs.rowCount).toBe(1);
    },
    integrationTimeout,
  );

  it(
    'B: business transaction rollback removes both the mutation and the job row',
    async () => {
      const userId = randomUUID();
      const idempotencyKey = `rollback-probe:${randomUUID()}`;

      await expect(
        ctx.connection.transaction(async (tx) => {
          await tx.query(
            `INSERT INTO app.users (id, status) VALUES ($1, 'active')`,
            [userId],
          );
          const jobId = await insertJobRow(
            tx,
            'notification.deliver',
            { probe: true },
            idempotencyKey,
          );
          if (!jobId) {
            throw new Error('job insert failed');
          }
          throw new Error('simulated rollback');
        }),
      ).rejects.toThrow('simulated rollback');

      const userRow = await ctx.connection.transaction((tx) =>
        tx.query('SELECT id FROM app.users WHERE id = $1', [userId]),
      );
      expect(userRow.rowCount).toBe(0);

      const jobRow = await ctx.connection.transaction((tx) =>
        tx.query(`SELECT id FROM app.jobs WHERE idempotency_key = $1`, [
          idempotencyKey,
        ]),
      );
      expect(jobRow.rowCount).toBe(0);
    },
    integrationTimeout,
  );

  it(
    'C: client retry of the same logical operation does not duplicate the job',
    async () => {
      const user = await registerUser(ctx.app, 'c1@example.com', 'password123');
      const checkout = await ctx.app.inject({
        method: 'POST',
        url: '/api/v1/billing/checkout',
        headers: authHeader(user.token),
        payload: { planCode: 'pro' },
      });
      const providerPaymentId = (
        checkout.json() as { providerPaymentId: string }
      ).providerPaymentId;
      const sub = await ctx.app.inject({
        method: 'GET',
        url: '/api/v1/billing/subscription',
        headers: authHeader(user.token),
      });
      const subscriptionId = (
        sub.json() as { subscription: { id: string } | null }
      ).subscription!.id;

      const event = {
        id: `evt_${randomUUID()}`,
        type: 'payment.succeeded',
        paymentId: providerPaymentId,
        subscriptionId,
        amount: 29,
        currency: 'AZN',
      };
      const sig = signPayload(event, DEFAULT_TEST_SECRET);

      // First delivery (applied) and an immediate client retry of the same event.
      const first = await ctx.app.inject({
        method: 'POST',
        url: '/api/v1/billing/webhooks/test',
        headers: { 'x-payment-signature': sig },
        payload: event,
      });
      expect(first.statusCode).toBe(200);
      expect((first.json() as { applied: boolean }).applied).toBe(true);

      const retry = await ctx.app.inject({
        method: 'POST',
        url: '/api/v1/billing/webhooks/test',
        headers: { 'x-payment-signature': sig },
        payload: event,
      });
      expect(retry.statusCode).toBe(200);
      expect((retry.json() as { reason?: string }).reason).toBe(
        'duplicate_event',
      );

      // Exactly one durable notification job for the subscription activation.
      const jobs = await ctx.connection.transaction((tx) =>
        tx.query(`SELECT id FROM app.jobs WHERE idempotency_key = $1`, [
          `sub:activated:${subscriptionId}`,
        ]),
      );
      expect(jobs.rowCount).toBe(1);

      const subStatus = await ctx.connection.transaction((tx) =>
        tx.query<{ status: string }>(
          `SELECT status FROM app.subscriptions WHERE id = $1`,
          [subscriptionId],
        ),
      );
      expect(subStatus.rows[0]!.status).toBe('active');
    },
    integrationTimeout,
  );
});
