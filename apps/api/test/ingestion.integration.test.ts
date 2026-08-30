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
    externalId: 'B123',
    url: 'https://bina.az/item/B123',
    sellerType: 'owner',
    payload: {
      operation: 'sale',
      propertyType: 'apartment',
      title: 'Nice flat',
      price: { amount: 250000, currency: 'AZN' },
      district: 'Yasamal',
      rooms: 3,
      area: 75,
      floor: 5,
      renovation: 'euro',
    },
    ...overrides,
  };
}

async function ingest(payload: Record<string, unknown>, token = SERVICE_TOKEN) {
  return ctx.app.inject({
    method: 'POST',
    url: '/api/v1/ingestion/listings',
    headers: { authorization: `Bearer ${token}` },
    payload,
  });
}

async function countExternal(): Promise<number> {
  const r = await ctx.connection.transaction((tx) =>
    tx.query('SELECT count(*)::int AS c FROM app.external_listings'),
  );
  return Number(r.rows[0]?.c ?? 0);
}

async function countListings(): Promise<number> {
  const r = await ctx.connection.transaction((tx) =>
    tx.query('SELECT count(*)::int AS c FROM app.listings'),
  );
  return Number(r.rows[0]?.c ?? 0);
}

async function listingPrice(externalId: string): Promise<number | null> {
  const r = await ctx.connection.transaction((tx) =>
    tx.query(
      `SELECT l.price_amount FROM app.listings l
       JOIN app.external_listings e ON e.listing_id = l.id
       WHERE e.source = 'bina' AND e.external_id = $1`,
      [externalId],
    ),
  );
  if (r.rowCount === 0) return null;
  const v = r.rows[0]?.price_amount as string | null | undefined;
  return v == null ? null : Number(v);
}

describe('ingestion security', () => {
  it('denies anonymous ingestion', async () => {
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/ingestion/listings',
      payload: basePayload(),
    });
    expect(res.statusCode).toBe(401);
  });

  it('denies malformed service token', async () => {
    const res = await ingest(basePayload(), 'wrong-token');
    expect(res.statusCode).toBe(401);
  });

  it('rejects unsupported source', async () => {
    const res = await ingest(basePayload({ source: 'unknown_source' }));
    expect(res.statusCode).toBe(400);
  });

  it('rejects malformed payload (missing fields)', async () => {
    const res = await ingest({ schemaVersion: 1, source: 'bina' });
    expect(res.statusCode).toBe(400);
  });

  it('rejects invalid enum value', async () => {
    const res = await ingest(
      basePayload({ payload: { operation: 'not_an_operation' } }),
    );
    expect(res.statusCode).toBe(400);
  });
});

describe('ingestion pipeline', () => {
  it('accepts a valid external listing', async () => {
    const res = await ingest(basePayload());
    expect(res.statusCode).toBe(201);
    expect(res.json().result.action).toBe('created');
    expect(await countExternal()).toBe(1);
    expect(await countListings()).toBe(1);
  });

  it('is idempotent for repeated identical payload', async () => {
    await ingest(basePayload());
    const second = await ingest(basePayload());
    expect(second.json().result.action).toBe('updated');
    expect(await countExternal()).toBe(1);
    expect(await countListings()).toBe(1);
  });

  it('updates the canonical listing on re-ingestion with new price', async () => {
    await ingest(basePayload());
    const updated = await ingest(
      basePayload({
        payload: {
          ...basePayload().payload,
          price: { amount: 270000, currency: 'AZN' },
        },
      }),
    );
    expect(updated.json().result.action).toBe('updated');
    expect(await listingPrice('B123')).toBe(270000);
  });

  it('does not duplicate on concurrent identical ingestion', async () => {
    const [a, b] = await Promise.all([
      ingest(basePayload()),
      ingest(basePayload()),
    ]);
    expect(a.statusCode).toBe(201);
    expect(b.statusCode).toBe(201);
    expect(await countExternal()).toBe(1);
    expect(await countListings()).toBe(1);
  });

  it('links same canonical listing across sources by URL (merge)', async () => {
    await ingest(
      basePayload({ externalId: 'B1', url: 'https://bina.az/item/X' }),
    );
    const other = await ingest(
      basePayload({
        source: 'tap',
        externalId: 'T1',
        url: 'https://bina.az/item/X',
      }),
    );
    expect(other.json().result.dedupStatus).toBe('merged');
    expect(await countExternal()).toBe(2);
    expect(await countListings()).toBe(1);
  });

  it('merges cross-source by phone + attributes', async () => {
    const phonePayload = basePayload({
      externalId: 'B2',
      url: 'https://bina.az/item/B2',
      payload: {
        operation: 'sale',
        district: 'Yasamal',
        price: { amount: 250000, currency: 'AZN' },
        rooms: 3,
        area: 75,
        floor: 5,
        contact: { phone: '+994 50 123 45 67' },
      },
    });
    await ingest(phonePayload);
    const other = await ingest(
      basePayload({
        source: 'tap',
        externalId: 'T2',
        url: 'https://tap.az/item/T2',
        payload: {
          operation: 'sale',
          district: 'Yasamal',
          price: { amount: 250000, currency: 'AZN' },
          rooms: 3,
          area: 75,
          floor: 5,
          contact: { phone: '0501234567' },
        },
      }),
    );
    expect(other.json().result.dedupStatus).toBe('merged');
    expect(await countExternal()).toBe(2);
    expect(await countListings()).toBe(1);
  });

  it('does not merge when attributes diverge (false-merge guard)', async () => {
    await ingest(
      basePayload({ externalId: 'B3', url: 'https://bina.az/item/B3' }),
    );
    const other = await ingest(
      basePayload({
        source: 'tap',
        externalId: 'T3',
        url: 'https://tap.az/item/T3',
        payload: {
          operation: 'sale',
          district: 'Narimanov',
          price: { amount: 999999, currency: 'AZN' },
          rooms: 1,
          area: 30,
        },
      }),
    );
    expect(other.json().result.action).toBe('created');
    expect(await countListings()).toBe(2);
  });
});
