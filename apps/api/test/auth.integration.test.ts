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

async function register(email: string, password = 'password123') {
  return ctx.app.inject({
    method: 'POST',
    url: '/api/v1/auth/register',
    payload: { email, password },
  });
}

describe('authentication', () => {
  it('registers a user and returns a session token', async () => {
    const res = await register('alice@example.com');
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(typeof body.token).toBe('string');
    expect(body.user.email).toBe('alice@example.com');
    expect(body.user.status).toBe('active');
  });

  it('rejects duplicate emails with 409', async () => {
    await register('dup@example.com');
    const res = await register('dup@example.com');
    expect(res.statusCode).toBe(409);
  });

  it('logs in with correct credentials', async () => {
    await register('bob@example.com', 'secret123');
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: 'bob@example.com', password: 'secret123' },
    });
    expect(res.statusCode).toBe(200);
    expect(typeof res.json().token).toBe('string');
  });

  it('rejects login with wrong password', async () => {
    await register('carol@example.com', 'secret123');
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: 'carol@example.com', password: 'nope' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('returns 401 on protected routes without a token', async () => {
    const res = await ctx.app.inject({ method: 'GET', url: '/api/v1/auth/me' });
    expect(res.statusCode).toBe(401);
  });

  it('serves the current user with a valid token', async () => {
    const reg = await register('dave@example.com');
    const token = reg.json().token;
    const res = await ctx.app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().user.email).toBe('dave@example.com');
  });

  it('revokes the session on logout', async () => {
    const reg = await register('eve@example.com');
    const token = reg.json().token;
    const out = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/auth/logout',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(out.statusCode).toBe(204);
    const me = await ctx.app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(me.statusCode).toBe(401);
  });
});

describe('agency authorization (IDOR)', () => {
  it('blocks strangers from reading or mutating an agency', async () => {
    const owner = await register('owner@example.com');
    const ownerToken = owner.json().token;
    const create = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/agencies',
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: { name: 'A1 Realty', slug: 'a1-realty' },
    });
    expect(create.statusCode).toBe(201);
    const agencyId = create.json().agency.id;

    const stranger = await register('stranger@example.com');
    const strangerToken = stranger.json().token;

    const patch = await ctx.app.inject({
      method: 'PATCH',
      url: `/api/v1/agencies/${agencyId}`,
      headers: { authorization: `Bearer ${strangerToken}` },
      payload: { name: 'Hacked' },
    });
    expect(patch.statusCode).toBe(403);

    const members = await ctx.app.inject({
      method: 'GET',
      url: `/api/v1/agencies/${agencyId}/members`,
      headers: { authorization: `Bearer ${strangerToken}` },
    });
    expect(members.statusCode).toBe(403);
  });

  it('allows an added admin member to manage the agency', async () => {
    const owner = await register('owner2@example.com');
    const ownerToken = owner.json().token;
    const create = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/agencies',
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: { name: 'A2 Realty', slug: 'a2-realty' },
    });
    const agencyId = create.json().agency.id;

    const member = await register('member2@example.com');
    const memberId = member.json().user.id;
    const memberToken = member.json().token;

    const add = await ctx.app.inject({
      method: 'POST',
      url: `/api/v1/agencies/${agencyId}/members`,
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: { userId: memberId, role: 'admin' },
    });
    expect(add.statusCode).toBe(201);

    const patch = await ctx.app.inject({
      method: 'PATCH',
      url: `/api/v1/agencies/${agencyId}`,
      headers: { authorization: `Bearer ${memberToken}` },
      payload: { name: 'A2 Managed' },
    });
    expect(patch.statusCode).toBe(200);
    expect(patch.json().agency.name).toBe('A2 Managed');
  });
});
