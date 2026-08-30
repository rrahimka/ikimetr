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

function basePayload(overrides: Record<string, unknown> = {}) {
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
    },
    ...overrides,
  };
}

async function ingest(payload: Record<string, unknown>) {
  const res = await ctx.app.inject({
    method: 'POST',
    url: '/api/v1/ingestion/listings',
    headers: { authorization: `Bearer ${SERVICE_TOKEN}` },
    payload,
  });
  if (res.statusCode !== 201) {
    throw new Error(`ingest failed: ${res.statusCode} ${res.body}`);
  }
  return res.json().result;
}

async function search(query: string) {
  return ctx.app.inject({ method: 'GET', url: `/api/v1/search?${query}` });
}

async function insertInternalListing(): Promise<void> {
  await ctx.connection.transaction((tx) =>
    tx.query(
      `INSERT INTO app.listings (source, external_id, transaction_type, district,
         price_amount, currency, seller_type, visibility, status)
       VALUES ('bina', 'INTERNAL1', 'sale', 'Yasamal', 100000, 'AZN', 'owner', 'internal', 'active')`,
    ),
  );
}

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

describe('public search', () => {
  it('returns an ingested public listing', async () => {
    await ingest(basePayload());
    const res = await search('operation=sale');
    expect(res.statusCode).toBe(200);
    expect(res.json().listings).toHaveLength(1);
  });

  it('hides internal listings', async () => {
    await ingest(basePayload());
    await insertInternalListing();
    const res = await search('operation=sale');
    expect(res.json().listings).toHaveLength(1);
    expect(res.json().listings[0].visibility).toBeUndefined();
  });

  it('filters by district', async () => {
    await ingest(
      basePayload({
        payload: { ...basePayload().payload, district: 'Narimanov' },
      }),
    );
    const res = await search('district=Yasamal');
    expect(res.json().listings).toHaveLength(0);
  });

  it('filters by price range', async () => {
    await ingest(
      basePayload({
        payload: {
          ...basePayload().payload,
          price: { amount: 250000, currency: 'AZN' },
        },
      }),
    );
    const res = await search('priceMin=300000');
    expect(res.json().listings).toHaveLength(0);
    const within = await search('priceMax=300000');
    expect(within.json().listings).toHaveLength(1);
  });

  it('excludes other operations', async () => {
    await ingest(
      basePayload({
        payload: { ...basePayload().payload, operation: 'rent_long' },
      }),
    );
    const res = await search('operation=sale');
    expect(res.json().listings).toHaveLength(0);
  });

  it('rejects malicious sort field', async () => {
    await ingest(basePayload());
    const res = await search('sort=id;DROP TABLE app.listings');
    expect(res.statusCode).toBe(400);
  });

  it('sorts by price ascending and descending', async () => {
    await ingest(
      basePayload({
        externalId: 'cheap',
        url: 'https://bina.az/c1',
        payload: {
          ...basePayload().payload,
          price: { amount: 100000, currency: 'AZN' },
        },
      }),
    );
    await ingest(
      basePayload({
        externalId: 'exp',
        url: 'https://bina.az/c2',
        payload: {
          ...basePayload().payload,
          price: { amount: 400000, currency: 'AZN' },
        },
      }),
    );

    const asc = await search('sort=price_asc');
    expect(asc.json().listings[0].priceAmount).toBe(100000);
    expect(asc.json().listings[1].priceAmount).toBe(400000);

    const desc = await search('sort=price_desc');
    expect(desc.json().listings[0].priceAmount).toBe(400000);
  });

  it('paginates with bounded limit and cursor', async () => {
    await ingest(basePayload({ externalId: 'p1', url: 'https://bina.az/p1' }));
    await ingest(basePayload({ externalId: 'p2', url: 'https://bina.az/p2' }));

    const first = await search('limit=1&sort=newest');
    expect(first.json().listings).toHaveLength(1);
    expect(first.json().nextCursor).not.toBeNull();

    const second = await ctx.app.inject({
      method: 'GET',
      url: `/api/v1/search?limit=1&sort=newest&cursor=${first.json().nextCursor}`,
    });
    expect(second.json().listings).toHaveLength(1);
    expect(second.json().listings[0].id).not.toBe(first.json().listings[0].id);
  });
});

describe('owner feed', () => {
  it('returns only owner listings and no contacts', async () => {
    await register('feedrealtor@example.com');
    const token = (await register('feedowner@example.com')).token;
    await ingest(basePayload({ sellerType: 'owner' }));
    await ingest(
      basePayload({
        externalId: 'agency',
        url: 'https://bina.az/agency',
        sellerType: 'agency',
        payload: { ...basePayload().payload, operation: 'sale' },
      }),
    );

    const res = await ctx.app.inject({
      method: 'GET',
      url: '/api/v1/owner-feed',
      headers: auth(token),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().listings).toHaveLength(1);
    expect(res.json().listings[0].sellerType).toBe('owner');
    expect(JSON.stringify(res.json().listings[0])).not.toMatch(/phone/iu);
  });

  it('requires authentication', async () => {
    const res = await ctx.app.inject({
      method: 'GET',
      url: '/api/v1/owner-feed',
    });
    expect(res.statusCode).toBe(401);
  });
});
