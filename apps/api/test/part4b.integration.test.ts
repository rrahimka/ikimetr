import { randomUUID } from 'node:crypto';
import { test, expect, beforeEach, afterEach } from 'vitest';

import {
  setupTestContext,
  teardownTestContext,
  registerUser,
  authHeader,
} from './helpers.js';
import type { TestContext } from './helpers.js';
import { DEFAULT_TEST_SECRET, signPayload } from '../src/billing/provider.js';

async function makePlatformAdmin(
  ctx: TestContext,
  userId: string,
): Promise<void> {
  await ctx.connection.transaction((tx) =>
    tx.query(
      `INSERT INTO app.user_roles (user_id, role) VALUES ($1, 'platform_admin')`,
      [userId],
    ),
  );
}

async function insertListing(ctx: TestContext): Promise<string> {
  const id = randomUUID();
  const externalId = `ext-${id}`;
  await ctx.connection.transaction((tx) =>
    tx.query(
      `INSERT INTO app.listings (id, source, external_id, transaction_type, property_type, status, visibility, district, price_amount, currency)
       VALUES ($1::uuid, 'test', $2, 'sale', 'apartment', 'active', 'public', 'Narimanov', 100000, 'AZN')`,
      [id, externalId],
    ),
  );
  return id;
}

let ctx: TestContext;
let enqueued: { type: string; payload: unknown; key: string }[];

beforeEach(async () => {
  enqueued = [];
  const capturing = (
    type: string,
    payload: unknown,
    key: string,
  ): Promise<void> => {
    enqueued.push({ type, payload, key });
    return Promise.resolve();
  };
  ctx = await setupTestContext(capturing);
}, 30000);
afterEach(async () => {
  if (ctx) {
    await teardownTestContext(ctx);
  }
});

test('billing: plans are publicly listed', async () => {
  const res = await ctx.app.inject({
    method: 'GET',
    url: '/api/v1/billing/plans',
  });
  expect(res.statusCode).toBe(200);
  const body = res.json() as { plans: { code: string }[] };
  const codes = body.plans.map((p) => p.code).sort();
  expect(codes).toEqual(['free', 'pro']);
});

test('billing A: free user cannot create owner alert (403)', async () => {
  const user = await registerUser(ctx.app, 'free@example.com', 'password123');
  const listingId = await insertListing(ctx);
  const res = await ctx.app.inject({
    method: 'POST',
    url: '/api/v1/owner-alerts',
    headers: authHeader(user.token),
    payload: { listingId },
  });
  expect(res.statusCode).toBe(403);
});

test('billing B: paid active user can create owner alert (201)', async () => {
  const user = await registerUser(ctx.app, 'paid@example.com', 'password123');
  const listingId = await insertListing(ctx);
  const checkout = await ctx.app.inject({
    method: 'POST',
    url: '/api/v1/billing/checkout',
    headers: authHeader(user.token),
    payload: { planCode: 'pro' },
  });
  expect(checkout.statusCode).toBe(200);
  const checkoutBody = checkout.json() as {
    checkoutUrl: string;
    providerPaymentId: string;
  };
  expect(checkoutBody.checkoutUrl).toContain('checkout');

  const sub = await ctx.app.inject({
    method: 'GET',
    url: '/api/v1/billing/subscription',
    headers: authHeader(user.token),
  });
  const subBody = sub.json() as { subscription: { id: string } };
  const subscriptionId = subBody.subscription.id;

  const event = {
    id: `evt_${randomUUID()}`,
    type: 'payment.succeeded',
    paymentId: checkoutBody.providerPaymentId,
    subscriptionId,
    amount: 29,
    currency: 'AZN',
  };
  const sig = signPayload(event, DEFAULT_TEST_SECRET);
  const webhook = await ctx.app.inject({
    method: 'POST',
    url: '/api/v1/billing/webhooks/test',
    headers: { 'x-payment-signature': sig },
    payload: event,
  });
  expect(webhook.statusCode).toBe(200);

  const entitlements = await ctx.app.inject({
    method: 'GET',
    url: '/api/v1/me/entitlements',
    headers: authHeader(user.token),
  });
  const entBody = entitlements.json() as {
    entitlements: { features: string[] };
  };
  expect(entBody.entitlements.features).toContain('owner_alerts');

  const alert = await ctx.app.inject({
    method: 'POST',
    url: '/api/v1/owner-alerts',
    headers: authHeader(user.token),
    payload: { listingId },
  });
  expect(alert.statusCode).toBe(201);
});

test('billing C: expired subscription cannot create owner alert (403)', async () => {
  const user = await registerUser(ctx.app, 'exp@example.com', 'password123');
  const listingId = await insertListing(ctx);
  const checkout = await ctx.app.inject({
    method: 'POST',
    url: '/api/v1/billing/checkout',
    headers: authHeader(user.token),
    payload: { planCode: 'pro' },
  });
  const providerPaymentId = (checkout.json() as { providerPaymentId: string })
    .providerPaymentId;
  const sub = await ctx.app.inject({
    method: 'GET',
    url: '/api/v1/billing/subscription',
    headers: authHeader(user.token),
  });
  const subscriptionId = (sub.json() as { subscription: { id: string } | null })
    .subscription!.id;
  const event = {
    id: `evt_${randomUUID()}`,
    type: 'payment.succeeded',
    paymentId: providerPaymentId,
    subscriptionId,
    amount: 29,
    currency: 'AZN',
  };
  const sig = signPayload(event, DEFAULT_TEST_SECRET);
  await ctx.app.inject({
    method: 'POST',
    url: '/api/v1/billing/webhooks/test',
    headers: { 'x-payment-signature': sig },
    payload: event,
  });
  const expired = {
    id: `evt_${randomUUID()}`,
    type: 'subscription.expired',
    paymentId: providerPaymentId,
    subscriptionId,
  };
  const sig2 = signPayload(expired, DEFAULT_TEST_SECRET);
  await ctx.app.inject({
    method: 'POST',
    url: '/api/v1/billing/webhooks/test',
    headers: { 'x-payment-signature': sig2 },
    payload: expired,
  });
  const alert = await ctx.app.inject({
    method: 'POST',
    url: '/api/v1/owner-alerts',
    headers: authHeader(user.token),
    payload: { listingId },
  });
  expect(alert.statusCode).toBe(403);
});

test('billing D/E: valid webhook activates once, duplicate is idempotent', async () => {
  const user = await registerUser(ctx.app, 'dup@example.com', 'password123');
  const checkout = await ctx.app.inject({
    method: 'POST',
    url: '/api/v1/billing/checkout',
    headers: authHeader(user.token),
    payload: { planCode: 'pro' },
  });
  const providerPaymentId = (checkout.json() as { providerPaymentId: string })
    .providerPaymentId;
  const sub = await ctx.app.inject({
    method: 'GET',
    url: '/api/v1/billing/subscription',
    headers: authHeader(user.token),
  });
  const subscriptionId = (sub.json() as { subscription: { id: string } | null })
    .subscription!.id;
  const event = {
    id: `evt_${randomUUID()}`,
    type: 'payment.succeeded',
    paymentId: providerPaymentId,
    subscriptionId,
    amount: 29,
    currency: 'AZN',
  };
  const sig = signPayload(event, DEFAULT_TEST_SECRET);
  const first = await ctx.app.inject({
    method: 'POST',
    url: '/api/v1/billing/webhooks/test',
    headers: { 'x-payment-signature': sig },
    payload: event,
  });
  expect(first.statusCode).toBe(200);
  expect((first.json() as { applied: boolean }).applied).toBe(true);

  const second = await ctx.app.inject({
    method: 'POST',
    url: '/api/v1/billing/webhooks/test',
    headers: { 'x-payment-signature': sig },
    payload: event,
  });
  expect(second.statusCode).toBe(200);
  expect((second.json() as { applied: boolean; reason?: string }).reason).toBe(
    'duplicate_event',
  );
});

test('billing F: forged webhook signature rejected (400)', async () => {
  const event = {
    id: `evt_${randomUUID()}`,
    type: 'payment.succeeded',
    paymentId: 'pay_test_x',
    amount: 29,
  };
  const res = await ctx.app.inject({
    method: 'POST',
    url: '/api/v1/billing/webhooks/test',
    headers: { 'x-payment-signature': 'deadbeef' },
    payload: event,
  });
  expect(res.statusCode).toBe(400);
});

test('billing: subscription belongs to authenticated user (no IDOR)', async () => {
  const a = await registerUser(ctx.app, 'a@example.com', 'password123');
  const b = await registerUser(ctx.app, 'b@example.com', 'password123');
  const checkoutA = await ctx.app.inject({
    method: 'POST',
    url: '/api/v1/billing/checkout',
    headers: authHeader(a.token),
    payload: { planCode: 'pro' },
  });
  expect(checkoutA.statusCode).toBe(200);
  const subA = await ctx.app.inject({
    method: 'GET',
    url: '/api/v1/billing/subscription',
    headers: authHeader(a.token),
  });
  const idA = (subA.json() as { subscription: { id: string } | null })
    .subscription!.id;
  const checkoutB = await ctx.app.inject({
    method: 'POST',
    url: '/api/v1/billing/checkout',
    headers: authHeader(b.token),
    payload: { planCode: 'pro' },
  });
  expect(checkoutB.statusCode).toBe(200);
  const subB = await ctx.app.inject({
    method: 'GET',
    url: '/api/v1/billing/subscription',
    headers: authHeader(b.token),
  });
  const idB = (subB.json() as { subscription: { id: string } | null })
    .subscription!.id;
  expect(idA).not.toBe(idB);
});

test('admin G: platform admin can list users (200)', async () => {
  const admin = await registerUser(ctx.app, 'admin@example.com', 'password123');
  await makePlatformAdmin(ctx, admin.userId);
  const res = await ctx.app.inject({
    method: 'GET',
    url: '/api/v1/admin/users',
    headers: authHeader(admin.token),
  });
  expect(res.statusCode).toBe(200);
});

test('admin H: non-admin and agency-admin are forbidden (403)', async () => {
  const normal = await registerUser(
    ctx.app,
    'normal@example.com',
    'password123',
  );
  const normalRes = await ctx.app.inject({
    method: 'GET',
    url: '/api/v1/admin/users',
    headers: authHeader(normal.token),
  });
  expect(normalRes.statusCode).toBe(403);

  const owner = await registerUser(ctx.app, 'owner@example.com', 'password123');
  const agency = await ctx.app.inject({
    method: 'POST',
    url: '/api/v1/agencies',
    headers: authHeader(owner.token),
    payload: { name: 'Acme', slug: `acme-${randomUUID().slice(0, 8)}` },
  });
  const agencyId = (agency.json() as { agency: { id: string } }).agency.id;
  const member = await registerUser(
    ctx.app,
    'member@example.com',
    'password123',
  );
  await ctx.app.inject({
    method: 'POST',
    url: `/api/v1/agencies/${agencyId}/members`,
    headers: authHeader(owner.token),
    payload: { userId: member.userId, role: 'admin' },
  });
  const memberRes = await ctx.app.inject({
    method: 'GET',
    url: '/api/v1/admin/users',
    headers: authHeader(member.token),
  });
  expect(memberRes.statusCode).toBe(403);
});

test('admin: moderation writes audit log', async () => {
  const admin = await registerUser(
    ctx.app,
    'admin2@example.com',
    'password123',
  );
  await makePlatformAdmin(ctx, admin.userId);
  const target = await registerUser(
    ctx.app,
    'target@example.com',
    'password123',
  );
  const mod = await ctx.app.inject({
    method: 'PATCH',
    url: `/api/v1/admin/users/${target.userId}/status`,
    headers: authHeader(admin.token),
    payload: { status: 'suspended', reason: 'abuse' },
  });
  expect(mod.statusCode).toBe(200);

  const audit = await ctx.app.inject({
    method: 'GET',
    url: '/api/v1/admin/audit',
    headers: authHeader(admin.token),
  });
  expect(audit.statusCode).toBe(200);
  const auditBody = audit.json() as { audit: { action: string }[] };
  expect(auditBody.audit.some((e) => e.action === 'user.status.update')).toBe(
    true,
  );
});

test('admin: subscription override is audited', async () => {
  const admin = await registerUser(
    ctx.app,
    'admin3@example.com',
    'password123',
  );
  await makePlatformAdmin(ctx, admin.userId);
  const target = await registerUser(
    ctx.app,
    'target3@example.com',
    'password123',
  );
  const override = await ctx.app.inject({
    method: 'POST',
    url: '/api/v1/admin/subscriptions/override',
    headers: authHeader(admin.token),
    payload: { userId: target.userId, planCode: 'pro', status: 'active' },
  });
  expect(override.statusCode).toBe(200);

  const audit = await ctx.app.inject({
    method: 'GET',
    url: '/api/v1/admin/audit',
    headers: authHeader(admin.token),
  });
  const auditBody = audit.json() as { audit: { action: string }[] };
  expect(
    auditBody.audit.some((e) => e.action === 'subscription.admin.update'),
  ).toBe(true);

  const ent = await ctx.app.inject({
    method: 'GET',
    url: '/api/v1/me/entitlements',
    headers: authHeader(target.token),
  });
  const entBody = ent.json() as { entitlements: { features: string[] } };
  expect(entBody.entitlements.features).toContain('owner_alerts');
});

test('analytics I: platform admin sees aggregates, no PII; non-admin forbidden', async () => {
  const normal = await registerUser(ctx.app, 'anon@example.com', 'password123');
  const forbidden = await ctx.app.inject({
    method: 'GET',
    url: '/api/v1/analytics',
    headers: authHeader(normal.token),
  });
  expect(forbidden.statusCode).toBe(403);

  const admin = await registerUser(
    ctx.app,
    'admin4@example.com',
    'password123',
  );
  await makePlatformAdmin(ctx, admin.userId);
  const res = await ctx.app.inject({
    method: 'GET',
    url: '/api/v1/analytics',
    headers: authHeader(admin.token),
  });
  expect(res.statusCode).toBe(200);
  const body = res.json() as {
    analytics: { counts: { users: number; listings: number } };
  };
  expect(body.analytics.counts.users).toBeGreaterThanOrEqual(2);
  expect(res.body).not.toContain('password');
  expect(res.body).not.toContain('password_hash');
});

test('billing webhook enqueues PART 4A notification job', async () => {
  const user = await registerUser(ctx.app, 'notify@example.com', 'password123');
  const checkout = await ctx.app.inject({
    method: 'POST',
    url: '/api/v1/billing/checkout',
    headers: authHeader(user.token),
    payload: { planCode: 'pro' },
  });
  const providerPaymentId = (checkout.json() as { providerPaymentId: string })
    .providerPaymentId;
  const sub = await ctx.app.inject({
    method: 'GET',
    url: '/api/v1/billing/subscription',
    headers: authHeader(user.token),
  });
  const subscriptionId = (sub.json() as { subscription: { id: string } | null })
    .subscription!.id;
  const event = {
    id: `evt_${randomUUID()}`,
    type: 'payment.succeeded',
    paymentId: providerPaymentId,
    subscriptionId,
    amount: 29,
    currency: 'AZN',
  };
  const sig = signPayload(event, DEFAULT_TEST_SECRET);
  await ctx.app.inject({
    method: 'POST',
    url: '/api/v1/billing/webhooks/test',
    headers: { 'x-payment-signature': sig },
    payload: event,
  });
  expect(
    enqueued.some(
      (j) =>
        j.type === 'notification.deliver' &&
        j.key === `sub:activated:${subscriptionId}`,
    ),
  ).toBe(true);
});
