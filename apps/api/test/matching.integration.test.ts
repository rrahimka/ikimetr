import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  setupTestContext,
  teardownTestContext,
  truncateDatabase,
  type TestContext,
} from './helpers.js';

let ctx: TestContext;
const SERVICE_TOKEN = 'test-ingestion-secret-123456';

beforeAll(async () => {
  process.env['INGESTION_SERVICE_TOKEN'] = SERVICE_TOKEN;
  ctx = await setupTestContext();
}, 60_000);
afterAll(async () => {
  await teardownTestContext(ctx);
});
beforeEach(async () => {
  await truncateDatabase(ctx.connection);
});

async function register(email: string) {
  const res = await ctx.app.inject({
    method: 'POST',
    url: '/api/v1/auth/register',
    payload: { email, password: 'password123' },
  });
  return {
    token: res.json().token as string,
    userId: res.json().user.id as string,
  };
}

function auth(token: string) {
  return { authorization: `Bearer ${token}` };
}

function listingPayload(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1,
    source: 'bina',
    externalId: `B${Math.random().toString(36).slice(2, 8)}`,
    url: `https://bina.az/item/${Math.random().toString(36).slice(2, 8)}`,
    sellerType: 'owner',
    payload: {
      operation: 'sale',
      propertyType: 'apartment',
      district: 'Yasamal',
      price: { amount: 250000, currency: 'AZN' },
      rooms: 3,
      area: 75,
      floor: 5,
      ...overrides,
    },
  };
}

async function ingest(
  payload: { source: string; externalId: string } & Record<string, unknown>,
): Promise<string> {
  const res = await ctx.app.inject({
    method: 'POST',
    url: '/api/v1/ingestion/listings',
    headers: { authorization: `Bearer ${SERVICE_TOKEN}` },
    payload,
  });
  if (res.statusCode !== 201) {
    throw new Error(`ingest failed: ${res.statusCode} ${res.body}`);
  }
  const r = await ctx.connection.transaction((tx) =>
    tx.query<{ id: string }>(
      `SELECT l.id FROM app.listings l
       JOIN app.external_listings e ON e.listing_id = l.id
       WHERE e.source = $1 AND e.external_id = $2`,
      [payload.source, payload.externalId],
    ),
  );
  return r.rows[0]?.id as string;
}

describe('deterministic matching', () => {
  it('matches a request to an eligible listing with reasons', async () => {
    const { token } = await register('matcher@example.com');
    const req = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/requests',
      headers: auth(token),
      payload: {
        operation: 'sale',
        district: 'Yasamal',
        priceMax: 300000,
        roomsMin: 3,
        roomsMax: 3,
      },
    });
    const requestId = req.json().request.id as string;

    const listingA = await ingest(listingPayload());
    await ingest(listingPayload({ operation: 'rent_long' }));
    await ingest(
      listingPayload({
        district: 'Narimanov',
        price: { amount: 500000, currency: 'AZN' },
      }),
    );

    const matches = await ctx.app.inject({
      method: 'GET',
      url: `/api/v1/requests/${requestId}/matches`,
      headers: auth(token),
    });
    expect(matches.statusCode).toBe(200);
    const ids = matches.json().matches.map((m: { id: string }) => m.id);
    expect(ids).toContain(listingA);
    expect(ids).toHaveLength(1);

    const matched = matches
      .json()
      .matches.find((m: { id: string }) => m.id === listingA);
    expect(matched.score).toBeGreaterThan(0);
    const codes = matched.reasons.map((r: { code: string }) => r.code);
    expect(codes).toContain('district_matched');
    expect(codes).toContain('price_within_budget');
    expect(codes).toContain('rooms_match');
  });

  it('excludes non-matching listings and explains exclusion', async () => {
    const { token } = await register('matcher2@example.com');
    const req = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/requests',
      headers: auth(token),
      payload: { operation: 'sale', district: 'Yasamal', priceMax: 100000 },
    });
    const requestId = req.json().request.id as string;

    await ingest(listingPayload());

    const matches = await ctx.app.inject({
      method: 'GET',
      url: `/api/v1/requests/${requestId}/matches`,
      headers: auth(token),
    });
    expect(matches.json().matches).toHaveLength(0);
  });

  it('matches requests for a given listing (reverse direction)', async () => {
    const { token } = await register('matcher3@example.com');
    const req = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/requests',
      headers: auth(token),
      payload: {
        operation: 'sale',
        district: 'Yasamal',
        priceMax: 300000,
        roomsMin: 3,
      },
    });
    const requestId = req.json().request.id as string;
    const listingA = await ingest(listingPayload({ rooms: 3 }));

    const reverse = await ctx.app.inject({
      method: 'GET',
      url: `/api/v1/listings/${listingA}/matches`,
      headers: auth(token),
    });
    expect(reverse.statusCode).toBe(200);
    const ids = reverse.json().requests.map((r: { id: string }) => r.id);
    expect(ids).toContain(requestId);
  });

  it('blocks IDOR on matches endpoint', async () => {
    const owner = await register('mowner@example.com');
    const req = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/requests',
      headers: auth(owner.token),
      payload: { operation: 'sale', priceMax: 300000 },
    });
    const requestId = req.json().request.id as string;

    const stranger = await register('mstranger@example.com');
    const res = await ctx.app.inject({
      method: 'GET',
      url: `/api/v1/requests/${requestId}/matches`,
      headers: auth(stranger.token),
    });
    expect(res.statusCode).toBe(404);
  });
});
