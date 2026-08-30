import { randomUUID } from 'node:crypto';
import { describe, expect, it, beforeEach, afterEach } from 'vitest';

import {
  authHeader,
  registerUser,
  setupTestContext,
  teardownTestContext,
  type TestContext,
} from './helpers.js';

describe('messaging API', () => {
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

  it('creates a direct conversation between two users', async () => {
    const alice = await register(`alice-${randomUUID()}@example.com`);
    const bob = await register(`bob-${randomUUID()}@example.com`);

    const response = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/conversations',
      headers: authHeader(alice.token),
      payload: { withUserId: bob.userId },
    });

    expect(response.statusCode).toBe(201);
    const body = response.json() as {
      conversation: { id: string; participantIds: string[] };
    };
    expect(body.conversation.participantIds.sort()).toEqual(
      [alice.userId, bob.userId].sort(),
    );
  });

  it('reuses an existing direct conversation', async () => {
    const alice = await register(`alice-${randomUUID()}@example.com`);
    const bob = await register(`bob-${randomUUID()}@example.com`);

    const first = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/conversations',
      headers: authHeader(alice.token),
      payload: { withUserId: bob.userId },
    });
    const second = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/conversations',
      headers: authHeader(alice.token),
      payload: { withUserId: bob.userId },
    });

    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(201);
    const a = (first.json() as { conversation: { id: string } }).conversation;
    const b = (second.json() as { conversation: { id: string } }).conversation;
    expect(b.id).toBe(a.id);
  });

  it('rejects conversation with a non-existent user', async () => {
    const alice = await register(`alice-${randomUUID()}@example.com`);
    const response = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/conversations',
      headers: authHeader(alice.token),
      payload: { withUserId: randomUUID() },
    });
    expect(response.statusCode).toBe(404);
  });

  it('rejects conversation with self', async () => {
    const alice = await register(`alice-${randomUUID()}@example.com`);
    const response = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/conversations',
      headers: authHeader(alice.token),
      payload: { withUserId: alice.userId },
    });
    expect(response.statusCode).toBe(400);
  });

  it('rejects unauthenticated access', async () => {
    const response = await ctx.app.inject({
      method: 'GET',
      url: '/api/v1/conversations',
    });
    expect(response.statusCode).toBe(401);
  });

  it('hides conversations from non-participants (IDOR)', async () => {
    const alice = await register(`alice-${randomUUID()}@example.com`);
    const bob = await register(`bob-${randomUUID()}@example.com`);
    const carol = await register(`carol-${randomUUID()}@example.com`);

    const created = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/conversations',
      headers: authHeader(alice.token),
      payload: { withUserId: bob.userId },
    });
    const conversationId = (created.json() as { conversation: { id: string } })
      .conversation.id;

    const get = await ctx.app.inject({
      method: 'GET',
      url: `/api/v1/conversations/${conversationId}`,
      headers: authHeader(carol.token),
    });
    const messages = await ctx.app.inject({
      method: 'GET',
      url: `/api/v1/conversations/${conversationId}/messages`,
      headers: authHeader(carol.token),
    });
    expect(get.statusCode).toBe(404);
    expect(messages.statusCode).toBe(404);
  });

  it('does not let a non-participant post messages', async () => {
    const alice = await register(`alice-${randomUUID()}@example.com`);
    const bob = await register(`bob-${randomUUID()}@example.com`);
    const carol = await register(`carol-${randomUUID()}@example.com`);

    const created = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/conversations',
      headers: authHeader(alice.token),
      payload: { withUserId: bob.userId },
    });
    const conversationId = (created.json() as { conversation: { id: string } })
      .conversation.id;

    const post = await ctx.app.inject({
      method: 'POST',
      url: `/api/v1/conversations/${conversationId}/messages`,
      headers: authHeader(carol.token),
      payload: { content: 'hi from carol' },
    });
    expect(post.statusCode).toBe(404);
  });

  it('ignores a spoofed sender in the message body', async () => {
    const alice = await register(`alice-${randomUUID()}@example.com`);
    const bob = await register(`bob-${randomUUID()}@example.com`);

    const created = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/conversations',
      headers: authHeader(alice.token),
      payload: { withUserId: bob.userId },
    });
    const conversationId = (created.json() as { conversation: { id: string } })
      .conversation.id;

    const spoof = await ctx.app.inject({
      method: 'POST',
      url: `/api/v1/conversations/${conversationId}/messages`,
      headers: authHeader(alice.token),
      payload: { content: 'real', senderUserId: bob.userId },
    });
    expect(spoof.statusCode).toBe(400);

    const real = await ctx.app.inject({
      method: 'POST',
      url: `/api/v1/conversations/${conversationId}/messages`,
      headers: authHeader(alice.token),
      payload: { content: 'real' },
    });
    expect(real.statusCode).toBe(201);
    const body = real.json() as { message: { senderUserId: string } };
    expect(body.message.senderUserId).toBe(alice.userId);
  });

  it('rejects oversized messages', async () => {
    const alice = await register(`alice-${randomUUID()}@example.com`);
    const bob = await register(`bob-${randomUUID()}@example.com`);

    const created = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/conversations',
      headers: authHeader(alice.token),
      payload: { withUserId: bob.userId },
    });
    const conversationId = (created.json() as { conversation: { id: string } })
      .conversation.id;

    const response = await ctx.app.inject({
      method: 'POST',
      url: `/api/v1/conversations/${conversationId}/messages`,
      headers: authHeader(alice.token),
      payload: { content: 'x'.repeat(4001) },
    });
    expect(response.statusCode).toBe(400);
  });

  it('delivers messages to the other participant only', async () => {
    const alice = await register(`alice-${randomUUID()}@example.com`);
    const bob = await register(`bob-${randomUUID()}@example.com`);

    const created = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/conversations',
      headers: authHeader(alice.token),
      payload: { withUserId: bob.userId },
    });
    const conversationId = (created.json() as { conversation: { id: string } })
      .conversation.id;

    const post = await ctx.app.inject({
      method: 'POST',
      url: `/api/v1/conversations/${conversationId}/messages`,
      headers: authHeader(alice.token),
      payload: { content: 'hello bob' },
    });
    expect(post.statusCode).toBe(201);

    const bobMessages = await ctx.app.inject({
      method: 'GET',
      url: `/api/v1/conversations/${conversationId}/messages`,
      headers: authHeader(bob.token),
    });
    const aliceMessages = await ctx.app.inject({
      method: 'GET',
      url: `/api/v1/conversations/${conversationId}/messages`,
      headers: authHeader(alice.token),
    });
    expect(bobMessages.statusCode).toBe(200);
    expect(aliceMessages.statusCode).toBe(200);
    expect((bobMessages.json() as { items: unknown[] }).items).toHaveLength(1);
    expect((aliceMessages.json() as { items: unknown[] }).items).toHaveLength(
      1,
    );
  });

  it('paginates messages with a cursor', async () => {
    const alice = await register(`alice-${randomUUID()}@example.com`);
    const bob = await register(`bob-${randomUUID()}@example.com`);

    const created = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/conversations',
      headers: authHeader(alice.token),
      payload: { withUserId: bob.userId },
    });
    const conversationId = (created.json() as { conversation: { id: string } })
      .conversation.id;

    for (let i = 0; i < 3; i++) {
      await ctx.app.inject({
        method: 'POST',
        url: `/api/v1/conversations/${conversationId}/messages`,
        headers: authHeader(alice.token),
        payload: { content: `m${i}` },
      });
    }

    const page1 = await ctx.app.inject({
      method: 'GET',
      url: `/api/v1/conversations/${conversationId}/messages?limit=2`,
      headers: authHeader(alice.token),
    });
    const body1 = page1.json() as {
      items: { id: string }[];
      nextCursor: string | null;
    };
    expect(body1.items).toHaveLength(2);
    expect(body1.nextCursor).not.toBeNull();

    const page2 = await ctx.app.inject({
      method: 'GET',
      url: `/api/v1/conversations/${conversationId}/messages?limit=2&cursor=${body1.nextCursor}`,
      headers: authHeader(alice.token),
    });
    const body2 = page2.json() as {
      items: { id: string }[];
      nextCursor: string | null;
    };
    expect(body2.items).toHaveLength(1);
    expect(body2.nextCursor).toBeNull();

    const seen = new Set([
      ...body1.items.map((m) => m.id),
      ...body2.items.map((m) => m.id),
    ]);
    expect(seen.size).toBe(3);
  });
});
