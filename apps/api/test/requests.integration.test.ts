import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  setupTestContext,
  teardownTestContext,
  truncateDatabase,
  type TestContext,
} from './helpers.js';

let ctx: TestContext;

beforeAll(async () => {
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

describe('client requests', () => {
  it('creates, reads, lists, updates and archives own request', async () => {
    const { token } = await register('realtor1@example.com');
    const created = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/requests',
      headers: auth(token),
      payload: {
        operation: 'sale',
        district: 'Yasamal',
        priceMax: 300000,
        roomsMin: 2,
        roomsMax: 4,
      },
    });
    expect(created.statusCode).toBe(201);
    const id = created.json().request.id as string;

    const list = await ctx.app.inject({
      method: 'GET',
      url: '/api/v1/requests',
      headers: auth(token),
    });
    expect(list.json().requests).toHaveLength(1);

    const get = await ctx.app.inject({
      method: 'GET',
      url: `/api/v1/requests/${id}`,
      headers: auth(token),
    });
    expect(get.statusCode).toBe(200);
    expect(get.json().request.district).toBe('Yasamal');

    const patched = await ctx.app.inject({
      method: 'PATCH',
      url: `/api/v1/requests/${id}`,
      headers: auth(token),
      payload: { priceMax: 350000 },
    });
    expect(patched.statusCode).toBe(200);
    expect(patched.json().request.priceMax).toBe(350000);

    const archived = await ctx.app.inject({
      method: 'POST',
      url: `/api/v1/requests/${id}/archive`,
      headers: auth(token),
    });
    expect(archived.statusCode).toBe(200);
    expect(archived.json().request.status).toBe('archived');
  });

  it('blocks IDOR: another user cannot access or modify the request', async () => {
    const owner = await register('ownerreq@example.com');
    const created = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/requests',
      headers: auth(owner.token),
      payload: { operation: 'sale', priceMax: 300000 },
    });
    const id = created.json().request.id as string;

    const stranger = await register('thiefreq@example.com');
    const get = await ctx.app.inject({
      method: 'GET',
      url: `/api/v1/requests/${id}`,
      headers: auth(stranger.token),
    });
    expect(get.statusCode).toBe(404);

    const patch = await ctx.app.inject({
      method: 'PATCH',
      url: `/api/v1/requests/${id}`,
      headers: auth(stranger.token),
      payload: { priceMax: 1 },
    });
    expect(patch.statusCode).toBe(404);

    const archive = await ctx.app.inject({
      method: 'POST',
      url: `/api/v1/requests/${id}/archive`,
      headers: auth(stranger.token),
    });
    expect(archive.statusCode).toBe(404);
  });
});
