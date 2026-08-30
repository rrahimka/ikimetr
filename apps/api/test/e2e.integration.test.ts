import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_TEST_SECRET, signPayload } from '../src/billing/provider.js';
import {
  authHeader,
  registerUser,
  setupTestContext,
  teardownTestContext,
  type TestContext,
} from './helpers.js';

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

describe('E2E: full cross-module acceptance (HTTP)', () => {
  it('exercises user lifecycle, property, ingestion, matching, messaging, billing and admin', async () => {
    // --- Scenario 1: user lifecycle ---
    const user = await registerUser(ctx.app, 'e2e-a@example.com', 'pw123456');
    const me = await ctx.app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      headers: authHeader(user.token),
    });
    expect(me.statusCode).toBe(200);
    const updated = await ctx.app.inject({
      method: 'PATCH',
      url: '/api/v1/me',
      headers: authHeader(user.token),
      payload: { displayName: 'Lifecycle User' },
    });
    expect(updated.statusCode).toBe(200);
    await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/auth/logout',
      headers: authHeader(user.token),
    });
    const afterLogout = await ctx.app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      headers: authHeader(user.token),
    });
    expect(afterLogout.statusCode).toBe(401);

    // Re-login for continued flow.
    const login = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: 'e2e-a@example.com', password: 'pw123456' },
    });
    const token = (login.json() as { token: string }).token;

    // --- Scenario 2: realtor + property ---
    await ctx.app.inject({
      method: 'PATCH',
      url: '/api/v1/realtors/me',
      headers: authHeader(token),
      payload: { publicName: 'E2E Realtor' },
    });
    const property = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/my/properties',
      headers: authHeader(token),
      payload: {
        transactionType: 'sale',
        propertyType: 'apartment',
        district: 'Yasamal',
        priceAmount: 120000,
        currency: 'USD',
        title: 'E2E Apartment',
      },
    });
    expect(property.statusCode).toBe(201);
    const propertyId = (property.json() as { property: { id: string } })
      .property.id;
    const activated = await ctx.app.inject({
      method: 'POST',
      url: `/api/v1/my/properties/${propertyId}/status`,
      headers: authHeader(token),
      payload: { status: 'active' },
    });
    expect(activated.statusCode).toBe(200);

    // --- Scenario 3: ingestion -> search / owner feed (replay safe) ---
    const ingestPayload = {
      schemaVersion: 1,
      source: 'bina',
      externalId: 'e2e-ext-1',
      url: 'https://example.com/listing/e2e-ext-1',
      sellerType: 'owner',
      payload: {
        operation: 'sale',
        propertyType: 'apartment',
        title: 'Ingested',
        price: { amount: 90000, currency: 'USD' },
        district: 'Yasamal',
      },
    };
    const ingest1 = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/ingestion/listings',
      headers: { authorization: `Bearer ${INGESTION_TOKEN}` },
      payload: ingestPayload,
    });
    expect(ingest1.statusCode).toBe(201);
    const ingest2 = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/ingestion/listings',
      headers: { authorization: `Bearer ${INGESTION_TOKEN}` },
      payload: ingestPayload,
    });
    expect(ingest2.statusCode).toBe(201);
    // Replay must not create a duplicate (exact dedup on source+external_id).
    const dupCount = await ctx.connection.transaction(async (tx) =>
      tx.query<{ c: number }>(
        `SELECT count(*)::int AS c FROM app.external_listings WHERE source = 'bina' AND external_id = 'e2e-ext-1'`,
      ),
    );
    expect(dupCount.rows[0]?.c ?? 0).toBe(1);

    const search = await ctx.app.inject({
      method: 'GET',
      url: '/api/v1/search?district=Yasamal&operation=sale',
    });
    expect(search.statusCode).toBe(200);
    const listings = (search.json() as { listings: { id: string }[] }).listings;
    expect(listings.length).toBeGreaterThan(0);
    const listingId = listings[0]!.id;

    const ownerFeed = await ctx.app.inject({
      method: 'GET',
      url: '/api/v1/owner-feed?sellerType=owner',
      headers: authHeader(token),
    });
    expect(ownerFeed.statusCode).toBe(200);

    // --- Scenario 4: request matching ---
    const request = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/requests',
      headers: authHeader(token),
      payload: {
        operation: 'sale',
        propertyType: 'apartment',
        district: 'Yasamal',
        budgetMax: 150000,
      },
    });
    expect(request.statusCode).toBe(201);
    const requestId = (request.json() as { request: { id: string } }).request
      .id;
    const matches = await ctx.app.inject({
      method: 'GET',
      url: `/api/v1/requests/${requestId}/matches`,
      headers: authHeader(token),
    });
    expect(matches.statusCode).toBe(200);
    expect(
      (matches.json() as { matches: unknown[] }).matches.length,
    ).toBeGreaterThan(0);

    // --- Scenario 5: messaging (third party denied) ---
    const other = await registerUser(ctx.app, 'e2e-b@example.com', 'pw123456');
    const conv = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/conversations',
      headers: authHeader(token),
      payload: { withUserId: other.userId },
    });
    expect(conv.statusCode).toBe(201);
    const convId = (conv.json() as { conversation: { id: string } })
      .conversation.id;
    const msg = await ctx.app.inject({
      method: 'POST',
      url: `/api/v1/conversations/${convId}/messages`,
      headers: authHeader(token),
      payload: { content: 'interested' },
    });
    expect(msg.statusCode).toBe(201);
    const third = await registerUser(ctx.app, 'e2e-c@example.com', 'pw123456');
    const intruder = await ctx.app.inject({
      method: 'GET',
      url: `/api/v1/conversations/${convId}/messages`,
      headers: authHeader(third.token),
    });
    expect(intruder.statusCode).not.toBe(200);

    // --- Scenario 7: billing entitlement gating then activation ---
    const deniedAlert = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/owner-alerts',
      headers: authHeader(token),
      payload: { listingId },
    });
    expect(deniedAlert.statusCode).toBe(403); // free plan lacks entitlement

    const plans = await ctx.app.inject({
      method: 'GET',
      url: '/api/v1/billing/plans',
    });
    const pro = (
      plans.json() as {
        plans: { code: string; priceAmount: number; currency: string }[];
      }
    ).plans.find((p) => p.code === 'pro')!;
    const checkout = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/billing/checkout',
      headers: authHeader(token),
      payload: { planCode: 'pro' },
    });
    expect(checkout.statusCode).toBe(200);
    const paymentId = (checkout.json() as { providerPaymentId: string })
      .providerPaymentId;
    const webhook = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/billing/webhooks/test',
      headers: {
        'x-payment-signature': signPayload(
          {
            id: 'e2e-evt-1',
            type: 'payment.succeeded',
            paymentId,
            amount: pro.priceAmount,
            currency: pro.currency,
          },
          DEFAULT_TEST_SECRET,
        ),
      },
      payload: {
        id: 'e2e-evt-1',
        type: 'payment.succeeded',
        paymentId,
        amount: pro.priceAmount,
        currency: pro.currency,
      },
    });
    expect(webhook.statusCode).toBe(200);
    const sub = await ctx.app.inject({
      method: 'GET',
      url: '/api/v1/billing/subscription',
      headers: authHeader(token),
    });
    expect(
      (sub.json() as { subscription: { status: string } }).subscription?.status,
    ).toBe('active');
    const allowedAlert = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/owner-alerts',
      headers: authHeader(token),
      payload: { listingId },
    });
    expect(allowedAlert.statusCode).toBe(201);

    // --- Scenario 8 + 9: admin + analytics (PII-safe) ---
    const normalAdmin = await ctx.app.inject({
      method: 'GET',
      url: '/api/v1/admin/users',
      headers: authHeader(token),
    });
    expect(normalAdmin.statusCode).toBe(403);

    await ctx.connection.transaction(async (tx) =>
      tx.query(
        `INSERT INTO app.user_roles (user_id, role) VALUES ($1, 'platform_admin')`,
        [user.userId],
      ),
    );
    const adminList = await ctx.app.inject({
      method: 'GET',
      url: '/api/v1/admin/users',
      headers: authHeader(token),
    });
    expect(adminList.statusCode).toBe(200);
    const audit = await ctx.app.inject({
      method: 'GET',
      url: '/api/v1/admin/audit',
      headers: authHeader(token),
    });
    expect(audit.statusCode).toBe(200);
    const analytics = await ctx.app.inject({
      method: 'GET',
      url: '/api/v1/analytics',
      headers: authHeader(token),
    });
    expect(analytics.statusCode).toBe(200);
    expect(JSON.stringify(analytics.json())).not.toMatch(
      /"(password|phone|message|raw_event)"/,
    );
  });

  it('rejects tampered property edits across users (IDOR hard gate)', async () => {
    const a = await registerUser(ctx.app, 'e2e-ido-a@example.com', 'pw123456');
    const b = await registerUser(ctx.app, 'e2e-ido-b@example.com', 'pw123456');
    const prop = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/my/properties',
      headers: authHeader(a.token),
      payload: {
        transactionType: 'sale',
        propertyType: 'apartment',
        district: 'Yasamal',
        priceAmount: 80000,
        currency: 'USD',
        title: 'Private',
      },
    });
    const id = (prop.json() as { property: { id: string } }).property.id;
    const hacked = await ctx.app.inject({
      method: 'PATCH',
      url: `/api/v1/my/properties/${id}`,
      headers: authHeader(b.token),
      payload: { title: 'hacked' },
    });
    expect(hacked.statusCode).toBe(403);
  });
});
