import { randomUUID } from 'node:crypto';
import { describe, expect, it, beforeEach, afterEach } from 'vitest';

import {
  authHeader,
  registerUser,
  setupTestContext,
  teardownTestContext,
  type TestContext,
} from './helpers.js';

describe('notifications API', () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await setupTestContext();
  });

  afterEach(async () => {
    await teardownTestContext(ctx);
  });

  async function register(email: string) {
    return registerUser(ctx.app, email, 'Password123');
  }

  async function seedNotification(
    userId: string,
    options: { visibleAfter?: string } = {},
  ): Promise<string> {
    const id = randomUUID();
    await ctx.connection.transaction((tx) =>
      tx.query(
        `INSERT INTO app.notifications (id, user_id, type, title, body, idempotency_key, visible_after)
         VALUES ($1, $2, 'new_message', 'title', 'body', $3, ${options.visibleAfter ?? 'now()'})`,
        [id, userId, `seed:${id}`],
      ),
    );
    return id;
  }

  it('auto-creates preferences with defaults', async () => {
    const alice = await register(`alice-${randomUUID()}@example.com`);
    const response = await ctx.app.inject({
      method: 'GET',
      url: '/api/v1/notification-preferences',
      headers: authHeader(alice.token),
    });
    expect(response.statusCode).toBe(200);
    const body = response.json() as {
      preferences: { dndEnabled: boolean; disabledTypes: string[] };
    };
    expect(body.preferences.dndEnabled).toBe(true);
    expect(body.preferences.disabledTypes).toEqual([]);
  });

  it('updates and reads back preferences', async () => {
    const alice = await register(`alice-${randomUUID()}@example.com`);
    const update = await ctx.app.inject({
      method: 'PATCH',
      url: '/api/v1/notification-preferences',
      headers: authHeader(alice.token),
      payload: { disabledTypes: ['new_message'], dndEnabled: false },
    });
    expect(update.statusCode).toBe(200);
    const body = update.json() as {
      preferences: { disabledTypes: string[]; dndEnabled: boolean };
    };
    expect(body.preferences.disabledTypes).toEqual(['new_message']);
    expect(body.preferences.dndEnabled).toBe(false);
  });

  it('rejects an invalid DND time', async () => {
    const alice = await register(`alice-${randomUUID()}@example.com`);
    const response = await ctx.app.inject({
      method: 'PATCH',
      url: '/api/v1/notification-preferences',
      headers: authHeader(alice.token),
      payload: { dndStart: '99:99' },
    });
    expect(response.statusCode).toBe(400);
  });

  it('lists notifications for the owner only (IDOR)', async () => {
    const alice = await register(`alice-${randomUUID()}@example.com`);
    const bob = await register(`bob-${randomUUID()}@example.com`);
    const notificationId = await seedNotification(alice.userId);

    const aliceList = await ctx.app.inject({
      method: 'GET',
      url: '/api/v1/notifications',
      headers: authHeader(alice.token),
    });
    const bobList = await ctx.app.inject({
      method: 'GET',
      url: '/api/v1/notifications',
      headers: authHeader(bob.token),
    });
    expect(aliceList.statusCode).toBe(200);
    const aliceItems = (aliceList.json() as { items: { id: string }[] }).items;
    expect(aliceItems.map((n) => n.id)).toContain(notificationId);

    const bobItems = (bobList.json() as { items: { id: string }[] }).items;
    expect(bobItems.map((n) => n.id)).not.toContain(notificationId);
  });

  it('hides notifications scheduled in the future (DND)', async () => {
    const alice = await register(`alice-${randomUUID()}@example.com`);
    await seedNotification(alice.userId, {
      visibleAfter: "now() + interval '1 hour'",
    });

    const response = await ctx.app.inject({
      method: 'GET',
      url: '/api/v1/notifications',
      headers: authHeader(alice.token),
    });
    const items = (response.json() as { items: unknown[] }).items;
    expect(items).toHaveLength(0);
  });

  it('marks a notification read and keeps it owner-scoped (IDOR)', async () => {
    const alice = await register(`alice-${randomUUID()}@example.com`);
    const bob = await register(`bob-${randomUUID()}@example.com`);
    const notificationId = await seedNotification(alice.userId);

    const bobRead = await ctx.app.inject({
      method: 'POST',
      url: `/api/v1/notifications/${notificationId}/read`,
      headers: authHeader(bob.token),
    });
    expect(bobRead.statusCode).toBe(404);

    const aliceRead = await ctx.app.inject({
      method: 'POST',
      url: `/api/v1/notifications/${notificationId}/read`,
      headers: authHeader(alice.token),
    });
    expect(aliceRead.statusCode).toBe(200);
    const body = aliceRead.json() as { notification: { read: boolean } };
    expect(body.notification.read).toBe(true);
  });
});
