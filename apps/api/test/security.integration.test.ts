import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import type { AppDependencies } from '../src/app.js';
import { createPaymentProvider } from '../src/billing/provider.js';
import { DEFAULT_TEST_SECRET, signPayload } from '../src/billing/provider.js';
import { createServiceAuthPreHandler } from '../src/ingestion/guard.js';
import {
  generateSessionToken,
  hashSessionToken,
} from '../src/identity/session.js';
import { ForbiddenError } from '../src/errors.js';
import {
  authHeader,
  registerUser,
  setupTestContext,
  teardownTestContext,
  type TestContext,
} from './helpers.js';

// Ingestion token must be present before the app is built (route guard reads
// it at registration time).
process.env['INGESTION_SERVICE_TOKEN'] =
  process.env['INGESTION_SERVICE_TOKEN'] ?? 'test-ingestion-secret-0123456789';

const INGESTION_TOKEN = process.env['INGESTION_SERVICE_TOKEN'];

let ctx: TestContext;

beforeEach(async () => {
  ctx = await setupTestContext();
});

afterEach(async () => {
  await teardownTestContext(ctx);
});

// Direct SQL must run inside a transaction (DatabaseConnection exposes only
// `transaction`, not a top-level `query`).
async function dbQuery<T extends Record<string, unknown>>(
  text: string,
  params: unknown[] = [],
): Promise<{ rows: T[] }> {
  return ctx.connection.transaction(async (tx) => tx.query<T>(text, params));
}

async function makeAdmin(userId: string): Promise<void> {
  await dbQuery(
    `INSERT INTO app.user_roles (user_id, role) VALUES ($1, 'platform_admin')`,
    [userId],
  );
}

describe('production payment provider safety', () => {
  it('rejects the test payment provider when NODE_ENV=production', () => {
    expect(() =>
      createPaymentProvider({
        NODE_ENV: 'production',
        PAYMENT_PROVIDER: 'test',
      }),
    ).toThrow(/production/);
  });

  it('allows an explicit provider with a secret in production', () => {
    const provider = createPaymentProvider({
      NODE_ENV: 'production',
      PAYMENT_PROVIDER: 'stripe',
      PAYMENT_PROVIDER_SECRET: 'super-secret',
    });
    expect(provider.name).toBe('stripe');
  });

  it('rejects an explicit provider without a secret', () => {
    expect(() =>
      createPaymentProvider({
        NODE_ENV: 'production',
        PAYMENT_PROVIDER: 'stripe',
      }),
    ).toThrow(/secret/i);
  });
});

describe('session security', () => {
  it('rejects a malformed / unknown bearer token', async () => {
    const res = await ctx.app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      headers: { authorization: 'Bearer not-a-real-token' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('rejects a revoked session', async () => {
    const { token } = await registerUser(
      ctx.app,
      'sess1@example.com',
      'pw123456',
    );
    await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/auth/logout',
      headers: authHeader(token),
    });
    const res = await ctx.app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      headers: authHeader(token),
    });
    expect(res.statusCode).toBe(401);
  });

  it('rejects an expired session', async () => {
    const { userId } = await registerUser(
      ctx.app,
      'sess2@example.com',
      'pw123456',
    );
    const token = generateSessionToken();
    const tokenHash = hashSessionToken(token);
    await dbQuery(
      `INSERT INTO app.sessions (user_id, token_hash, expires_at)
       VALUES ($1, $2, now() - interval '1 day')`,
      [userId, tokenHash],
    );
    const res = await ctx.app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      headers: authHeader(token),
    });
    expect(res.statusCode).toBe(401);
  });
});

describe('authorization / IDOR sweep', () => {
  it('blocks User B from reading or modifying User A property', async () => {
    const a = await registerUser(ctx.app, 'ido-a@example.com', 'pw123456');
    const b = await registerUser(ctx.app, 'ido-b@example.com', 'pw123456');
    const created = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/my/properties',
      headers: authHeader(a.token),
      payload: {
        transactionType: 'sale',
        propertyType: 'apartment',
        district: 'Yasamal',
        priceAmount: 100000,
        currency: 'USD',
        title: 'A owned',
      },
    });
    expect(created.statusCode).toBe(201);
    const id = (created.json() as { property: { id: string } }).property.id;

    for (const url of [
      `/api/v1/my/properties/${id}`,
      `/api/v1/my/properties/${id}/images`,
    ]) {
      const get = await ctx.app.inject({
        method: 'GET',
        url,
        headers: authHeader(b.token),
      });
      expect(get.statusCode).toBe(403);
    }
    const patch = await ctx.app.inject({
      method: 'PATCH',
      url: `/api/v1/my/properties/${id}`,
      headers: authHeader(b.token),
      payload: { title: 'hacked' },
    });
    expect(patch.statusCode).toBe(403);
    const status = await ctx.app.inject({
      method: 'POST',
      url: `/api/v1/my/properties/${id}/status`,
      headers: authHeader(b.token),
      payload: { status: 'active' },
    });
    expect(status.statusCode).toBe(403);
  });

  it('blocks User B from reading User A client request', async () => {
    const a = await registerUser(ctx.app, 'req-a@example.com', 'pw123456');
    const b = await registerUser(ctx.app, 'req-b@example.com', 'pw123456');
    const created = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/requests',
      headers: authHeader(a.token),
      payload: {
        operation: 'sale',
        propertyType: 'apartment',
        district: 'Yasamal',
        budgetMax: 120000,
      },
    });
    expect(created.statusCode).toBe(201);
    const id = (created.json() as { request: { id: string } }).request.id;
    const res = await ctx.app.inject({
      method: 'GET',
      url: `/api/v1/requests/${id}`,
      headers: authHeader(b.token),
    });
    expect(res.statusCode).toBe(404);
  });

  it('blocks User C from reading a conversation between A and B', async () => {
    const a = await registerUser(ctx.app, 'conv-a@example.com', 'pw123456');
    const b = await registerUser(ctx.app, 'conv-b@example.com', 'pw123456');
    const c = await registerUser(ctx.app, 'conv-c@example.com', 'pw123456');
    const conv = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/conversations',
      headers: authHeader(a.token),
      payload: { withUserId: b.userId },
    });
    expect(conv.statusCode).toBe(201);
    const convId = (conv.json() as { conversation: { id: string } })
      .conversation.id;
    const res = await ctx.app.inject({
      method: 'GET',
      url: `/api/v1/conversations/${convId}/messages`,
      headers: authHeader(c.token),
    });
    expect(res.statusCode).not.toBe(200);
  });

  it('blocks marking a non-owned notification as read', async () => {
    const a = await registerUser(ctx.app, 'notif-a@example.com', 'pw123456');
    const res = await ctx.app.inject({
      method: 'POST',
      url: `/api/v1/notifications/${randomUUID()}/read`,
      headers: authHeader(a.token),
    });
    expect(res.statusCode).toBe(404);
  });
});

describe('role escalation prevention', () => {
  it('denies admin endpoints to a normal user', async () => {
    const a = await registerUser(ctx.app, 'esc-a@example.com', 'pw123456');
    const res = await ctx.app.inject({
      method: 'GET',
      url: '/api/v1/admin/users',
      headers: authHeader(a.token),
    });
    expect(res.statusCode).toBe(403);
  });

  it('denies platform admin endpoints to an agency owner', async () => {
    const a = await registerUser(ctx.app, 'esc-b@example.com', 'pw123456');
    await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/agencies',
      headers: authHeader(a.token),
      payload: { name: 'Agency X', slug: 'agency-x' },
    });
    const res = await ctx.app.inject({
      method: 'GET',
      url: '/api/v1/admin/users',
      headers: authHeader(a.token),
    });
    expect(res.statusCode).toBe(403);
  });

  it('ignores client-supplied role on profile update', async () => {
    const a = await registerUser(ctx.app, 'esc-c@example.com', 'pw123456');
    const res = await ctx.app.inject({
      method: 'PATCH',
      url: '/api/v1/me',
      headers: authHeader(a.token),
      payload: { displayName: 'Honest', role: 'platform_admin' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { profile: Record<string, unknown> };
    expect(body.profile).not.toHaveProperty('role');
    const adminCheck = await dbQuery<{ count: number }>(
      `SELECT count(*)::int AS count FROM app.user_roles WHERE user_id = $1`,
      [a.userId],
    );
    expect(adminCheck.rows[0]?.count ?? 0).toBe(0);
  });
});

describe('ingestion service authentication', () => {
  it('rejects ingestion without a token', async () => {
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/ingestion/listings',
      payload: { source: 'bina', externalId: 'x1', title: 't' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('rejects ingestion with a wrong token', async () => {
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/ingestion/listings',
      headers: { authorization: 'Bearer wrong-token' },
      payload: { source: 'bina', externalId: 'x1', title: 't' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('accepts ingestion with the configured service token', async () => {
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/ingestion/listings',
      headers: { authorization: `Bearer ${INGESTION_TOKEN}` },
      payload: {
        schemaVersion: 1,
        source: 'bina',
        externalId: 'x1',
        url: 'https://example.com/listing/x1',
        sellerType: 'owner',
        payload: {
          operation: 'sale',
          propertyType: 'apartment',
          title: 't',
          price: { amount: 50000, currency: 'USD' },
          district: 'Yasamal',
        },
      },
    });
    expect(res.statusCode).toBe(201);
  });

  it('disables the ingestion endpoint when no token is configured', async () => {
    const handler = createServiceAuthPreHandler(undefined);
    await expect(
      handler.call(
        ctx.app,
        { headers: { authorization: 'Bearer anything' } } as never,
        {} as never,
        () => undefined,
      ),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe('payment webhook security', () => {
  async function proPlan() {
    const res = await ctx.app.inject({
      method: 'GET',
      url: '/api/v1/billing/plans',
    });
    const plans = (
      res.json() as {
        plans: { code: string; priceAmount: number; currency: string }[];
      }
    ).plans;
    return plans.find((p) => p.code === 'pro')!;
  }

  async function checkout(userToken: string) {
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/billing/checkout',
      headers: authHeader(userToken),
      payload: { planCode: 'pro' },
    });
    return (res.json() as { providerPaymentId: string }).providerPaymentId;
  }

  async function postWebhook(event: Record<string, unknown>) {
    const signature = signPayload(event, DEFAULT_TEST_SECRET);
    return ctx.app.inject({
      method: 'POST',
      url: '/api/v1/billing/webhooks/test',
      headers: { 'x-payment-signature': signature },
      payload: event,
    });
  }

  it('rejects a webhook with a missing signature', async () => {
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/billing/webhooks/test',
      payload: { id: 'e1', type: 'payment.succeeded' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('rejects a webhook with an invalid signature', async () => {
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/billing/webhooks/test',
      headers: { 'x-payment-signature': 'deadbeef' },
      payload: { id: 'e1', type: 'payment.succeeded' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('activates once and ignores duplicate events (no double grant)', async () => {
    const user = await registerUser(ctx.app, 'wh-a@example.com', 'pw123456');
    const plan = await proPlan();
    const paymentId = await checkout(user.token);
    const event = {
      id: 'evt-dedup-1',
      type: 'payment.succeeded',
      paymentId,
      amount: plan.priceAmount,
      currency: plan.currency,
    };
    const first = await postWebhook(event);
    expect(first.statusCode).toBe(200);
    expect((first.json() as { applied: boolean }).applied).toBe(true);

    const sub = await ctx.app.inject({
      method: 'GET',
      url: '/api/v1/billing/subscription',
      headers: authHeader(user.token),
    });
    expect(
      (sub.json() as { subscription: { status: string } }).subscription?.status,
    ).toBe('active');

    const second = await postWebhook(event);
    expect(second.statusCode).toBe(200);
    expect(
      (second.json() as { applied: boolean; reason?: string }).applied,
    ).toBe(false);
    expect((second.json() as { reason?: string }).reason).toBe(
      'duplicate_event',
    );

    const sub2 = await ctx.app.inject({
      method: 'GET',
      url: '/api/v1/billing/subscription',
      headers: authHeader(user.token),
    });
    expect(
      (sub2.json() as { subscription: { status: string } }).subscription
        ?.status,
    ).toBe('active');
  });

  it('does not activate a subscription on amount mismatch', async () => {
    const user = await registerUser(ctx.app, 'wh-b@example.com', 'pw123456');
    const paymentId = await checkout(user.token);
    const event = {
      id: 'evt-mismatch-1',
      type: 'payment.succeeded',
      paymentId,
      amount: 1,
      currency: 'USD',
    };
    const res = await postWebhook(event);
    expect(res.statusCode).toBe(200);
    expect((res.json() as { applied: boolean; reason?: string }).applied).toBe(
      false,
    );
    const sub = await ctx.app.inject({
      method: 'GET',
      url: '/api/v1/billing/subscription',
      headers: authHeader(user.token),
    });
    const subBody = sub.json() as { subscription: { status: string } | null };
    expect(subBody.subscription?.status ?? 'pending').not.toBe('active');
  });

  it('records exactly the intent + settled-event ledger rows (no redundant row)', async () => {
    const user = await registerUser(ctx.app, 'led-a@example.com', 'pw123456');
    const plan = await proPlan();
    const paymentId = await checkout(user.token);
    const event = {
      id: 'evt-ledger-1',
      type: 'payment.succeeded',
      paymentId,
      amount: plan.priceAmount,
      currency: plan.currency,
    };
    await postWebhook(event);

    const rows = await dbQuery<{
      provider_event_id: string | null;
      status: string;
    }>(
      `SELECT provider_event_id, status FROM app.payments
       WHERE provider_payment_id = $1 ORDER BY created_at ASC`,
      [paymentId],
    );
    // Intent row (provider_event_id NULL) + settled event row (provider_event_id = event id).
    expect(rows.rows.length).toBe(2);
    const eventRow = rows.rows.find(
      (r) => r.provider_event_id === 'evt-ledger-1',
    );
    expect(eventRow).toBeDefined();
    expect(eventRow?.status).toBe('succeeded');
    expect(
      rows.rows.some((r) => (r.provider_event_id ?? '').endsWith(':applied')),
    ).toBe(false);
  });
});

describe('admin analytics PII boundary', () => {
  it('does not leak message or phone content in analytics', async () => {
    const admin = await registerUser(ctx.app, 'ana@example.com', 'pw123456');
    await makeAdmin(admin.userId);
    const res = await ctx.app.inject({
      method: 'GET',
      url: '/api/v1/analytics',
      headers: authHeader(admin.token),
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.stringify(res.json());
    expect(body).not.toMatch(/"(password|phone|message|raw_event)"/);
  });
});

describe('health reflects dependency failure', () => {
  it('returns 503 when the database is unavailable', async () => {
    const app = buildApp({
      database: {
        check: async () => {
          throw new Error('db down');
        },
      },
      redis: { check: async () => undefined },
      connection: {} as unknown as AppDependencies['connection'],
    });
    await app.ready();
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(503);
    await app.close();
  });

  it('returns 503 when Redis is unavailable', async () => {
    const app = buildApp({
      database: { check: async () => undefined },
      redis: {
        check: async () => {
          throw new Error('redis down');
        },
      },
      connection: {} as unknown as AppDependencies['connection'],
    });
    await app.ready();
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(503);
    await app.close();
  });
});
