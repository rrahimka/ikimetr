import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  authHeader,
  registerUser,
  setupTestContext,
  teardownTestContext,
  type TestContext,
} from './helpers.js';

describe('audit remediation stage 1', () => {
  let ctx: TestContext;

  beforeEach(async () => {
    // Real Redis is needed for the rate-limit assertions; flush any counters so
    // tests don't bleed into each other.
    ctx = await setupTestContext(undefined, true);
    if (ctx.rateLimitRedis?.isOpen) {
      await ctx.rateLimitRedis.flushAll();
    }
  });

  afterEach(async () => {
    await teardownTestContext(ctx);
  });

  async function dbQuery<T extends Record<string, unknown>>(
    text: string,
    params: unknown[] = [],
  ): Promise<{ rows: T[] }> {
    return ctx.connection.transaction(async (tx) => tx.query<T>(text, params));
  }

  async function adminUser(): Promise<{ token: string; userId: string }> {
    const user = await registerUser(
      ctx.app,
      `admin-${randomUUID()}@example.com`,
      'Password123',
    );
    await dbQuery(
      `INSERT INTO app.user_roles (user_id, role) VALUES ($1, 'platform_admin')`,
      [user.userId],
    );
    const login = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: user.email, password: 'Password123' },
    });
    const body = login.json() as { token: string };
    return { token: body.token, userId: user.userId };
  }

  describe('A: session rejected when account is not active', () => {
    it('rejects an existing session token after the user is suspended', async () => {
      const user = await registerUser(
        ctx.app,
        `user-${randomUUID()}@example.com`,
        'Password123',
      );
      const meBefore = await ctx.app.inject({
        method: 'GET',
        url: '/api/v1/auth/me',
        headers: authHeader(user.token),
      });
      expect(meBefore.statusCode).toBe(200);

      const admin = await adminUser();
      const suspend = await ctx.app.inject({
        method: 'PATCH',
        url: `/api/v1/admin/users/${user.userId}/status`,
        headers: authHeader(admin.token),
        payload: { status: 'suspended' },
      });
      expect(suspend.statusCode).toBe(200);

      const meAfter = await ctx.app.inject({
        method: 'GET',
        url: '/api/v1/auth/me',
        headers: authHeader(user.token),
      });
      expect(meAfter.statusCode).toBe(401);
    });
  });

  describe('F: direct conversation is unique under concurrency', () => {
    it('creates exactly one conversation for A+B and B+A issued concurrently', async () => {
      const alice = await registerUser(
        ctx.app,
        `alice-${randomUUID()}@example.com`,
        'Password123',
      );
      const bob = await registerUser(
        ctx.app,
        `bob-${randomUUID()}@example.com`,
        'Password123',
      );

      const [a, b] = await Promise.all([
        ctx.app.inject({
          method: 'POST',
          url: '/api/v1/conversations',
          headers: authHeader(alice.token),
          payload: { withUserId: bob.userId },
        }),
        ctx.app.inject({
          method: 'POST',
          url: '/api/v1/conversations',
          headers: authHeader(bob.token),
          payload: { withUserId: alice.userId },
        }),
      ]);

      expect(a.statusCode).toBe(201);
      expect(b.statusCode).toBe(201);
      const idA = (a.json() as { conversation: { id: string } }).conversation
        .id;
      const idB = (b.json() as { conversation: { id: string } }).conversation
        .id;
      expect(idA).toBe(idB);

      const { rows } = await dbQuery<{ id: string }>(
        `SELECT id FROM app.conversations WHERE direct_pair_key = $1`,
        [[alice.userId, bob.userId].sort().join(':')],
      );
      expect(rows).toHaveLength(1);
    });
  });

  describe('G: external listing status targets external_listings.id + source_status', () => {
    it('updates source_status of the addressed external listing', async () => {
      const listingId = randomUUID();
      const extId = randomUUID();
      await dbQuery(
        `INSERT INTO app.listings (id, source) VALUES ($1, 'test')`,
        [listingId],
      );
      await dbQuery(
        `INSERT INTO app.external_listings (id, listing_id, source, external_id, raw_payload, normalized_payload)
         VALUES ($1, $2, 'bina', 'ext-1', '{}'::jsonb, '{}'::jsonb)`,
        [extId, listingId],
      );

      const admin = await adminUser();
      const res = await ctx.app.inject({
        method: 'PATCH',
        url: `/api/v1/admin/external-listings/${extId}/status`,
        headers: authHeader(admin.token),
        payload: { status: 'ingested' },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json() as { id: string; status: string };
      expect(body.id).toBe(extId);
      expect(body.status).toBe('ingested');

      const { rows } = await dbQuery<{ source_status: string }>(
        `SELECT source_status FROM app.external_listings WHERE id = $1`,
        [extId],
      );
      expect(rows[0]!.source_status).toBe('ingested');
    });
  });

  describe('H: status values are validated per entity', () => {
    it('rejects a status that is not valid for the entity', async () => {
      const admin = await adminUser();

      const user = await registerUser(
        ctx.app,
        `u-${randomUUID()}@example.com`,
        'Password123',
      );
      const badUser = await ctx.app.inject({
        method: 'PATCH',
        url: `/api/v1/admin/users/${user.userId}/status`,
        headers: authHeader(admin.token),
        payload: { status: 'verified' },
      });
      expect(badUser.statusCode).toBe(400);

      const listingId = randomUUID();
      await dbQuery(
        `INSERT INTO app.listings (id, source) VALUES ($1, 'test')`,
        [listingId],
      );
      const badListing = await ctx.app.inject({
        method: 'PATCH',
        url: `/api/v1/admin/listings/${listingId}/status`,
        headers: authHeader(admin.token),
        payload: { status: 'verified' },
      });
      expect(badListing.statusCode).toBe(400);
    });

    it('accepts a status that is valid for the entity', async () => {
      const admin = await adminUser();
      const user = await registerUser(
        ctx.app,
        `u-${randomUUID()}@example.com`,
        'Password123',
      );
      const ok = await ctx.app.inject({
        method: 'PATCH',
        url: `/api/v1/admin/users/${user.userId}/status`,
        headers: authHeader(admin.token),
        payload: { status: 'suspended' },
      });
      expect(ok.statusCode).toBe(200);
    });
  });

  describe('I: owner alerts are paginated', () => {
    it('returns a page and a cursor', async () => {
      const user = await registerUser(
        ctx.app,
        `o-${randomUUID()}@example.com`,
        'Password123',
      );
      const listingIds = [randomUUID(), randomUUID(), randomUUID()];
      for (const listingId of listingIds) {
        await dbQuery(
          `INSERT INTO app.listings (id, source) VALUES ($1, 'test')`,
          [listingId],
        );
        await dbQuery(
          `INSERT INTO app.owner_alerts (user_id, listing_id) VALUES ($1, $2)`,
          [user.userId, listingId],
        );
      }

      const page1 = await ctx.app.inject({
        method: 'GET',
        url: '/api/v1/owner-alerts?limit=2',
        headers: authHeader(user.token),
      });
      expect(page1.statusCode).toBe(200);
      const b1 = page1.json() as {
        alerts: unknown[];
        nextCursor: string | null;
      };
      expect(b1.alerts).toHaveLength(2);
      expect(b1.nextCursor).not.toBeNull();

      const page2 = await ctx.app.inject({
        method: 'GET',
        url: `/api/v1/owner-alerts?limit=2&cursor=${b1.nextCursor}`,
        headers: authHeader(user.token),
      });
      const b2 = page2.json() as {
        alerts: unknown[];
        nextCursor: string | null;
      };
      expect(b2.alerts).toHaveLength(1);
      expect(b2.nextCursor).toBeNull();
    });
  });

  describe('J: rate limiting on auth endpoints', () => {
    it('returns 429 after the per-IP limit is exceeded', async () => {
      let last = 200;
      for (let i = 0; i < 11; i += 1) {
        const res = await ctx.app.inject({
          method: 'POST',
          url: '/api/v1/auth/register',
          payload: {
            email: `rl-${randomUUID()}@example.com`,
            password: 'Password123',
          },
        });
        last = res.statusCode;
      }
      expect(last).toBe(429);
    });
  });
});
