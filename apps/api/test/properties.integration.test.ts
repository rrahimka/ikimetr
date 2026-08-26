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

async function createProperty(
  token: string,
  overrides: Record<string, unknown> = {},
) {
  return ctx.app.inject({
    method: 'POST',
    url: '/api/v1/my/properties',
    headers: auth(token),
    payload: {
      title: 'Cozy apartment',
      currency: 'USD',
      priceAmount: 120000,
      district: 'Yasamal',
      rooms: 2,
      ...overrides,
    },
  });
}

describe('property lifecycle', () => {
  it('creates a property and starts it as a draft', async () => {
    const { token } = await register('seller@example.com');
    const res = await createProperty(token);
    expect(res.statusCode).toBe(201);
    const property = res.json().property;
    expect(property.status).toBe('draft');
    expect(property.title).toBe('Cozy apartment');
    expect(property.ownerUserId).toBeDefined();
  });

  it('lists and reads the owner properties', async () => {
    const { token } = await register('seller2@example.com');
    await createProperty(token);
    await createProperty(token, { title: 'Second', priceAmount: 200000 });

    const list = await ctx.app.inject({
      method: 'GET',
      url: '/api/v1/my/properties',
      headers: auth(token),
    });
    expect(list.statusCode).toBe(200);
    expect(list.json().properties).toHaveLength(2);

    const id = list.json().properties[0].id;
    const get = await ctx.app.inject({
      method: 'GET',
      url: `/api/v1/my/properties/${id}`,
      headers: auth(token),
    });
    expect(get.statusCode).toBe(200);
    expect(get.json().property.id).toBe(id);
  });

  it('updates a property and records status history', async () => {
    const { token } = await register('seller3@example.com');
    const created = await createProperty(token);
    const id = created.json().property.id;

    const update = await ctx.app.inject({
      method: 'PATCH',
      url: `/api/v1/my/properties/${id}`,
      headers: auth(token),
      payload: { priceAmount: 135000 },
    });
    expect(update.statusCode).toBe(200);
    expect(update.json().property.priceAmount).toBe(135000);

    const status = await ctx.app.inject({
      method: 'POST',
      url: `/api/v1/my/properties/${id}/status`,
      headers: auth(token),
      payload: { status: 'active' },
    });
    expect(status.statusCode).toBe(200);
    expect(status.json().property.status).toBe('active');
  });

  it('adds property images', async () => {
    const { token } = await register('seller4@example.com');
    const created = await createProperty(token);
    const id = created.json().property.id;

    const image = await ctx.app.inject({
      method: 'POST',
      url: `/api/v1/my/properties/${id}/images`,
      headers: auth(token),
      payload: { url: 'https://cdn.example.com/1.jpg', isPrimary: true },
    });
    expect(image.statusCode).toBe(201);
    expect(image.json().image.isPrimary).toBe(true);

    const list = await ctx.app.inject({
      method: 'GET',
      url: `/api/v1/my/properties/${id}/images`,
      headers: auth(token),
    });
    expect(list.json().images).toHaveLength(1);
  });
});

describe('property authorization (IDOR)', () => {
  it('blocks another user from reading or editing a property', async () => {
    const owner = await register('ownerp@example.com');
    const created = await createProperty(owner.token);
    const id = created.json().property.id;

    const stranger = await register('thief@example.com');
    const get = await ctx.app.inject({
      method: 'GET',
      url: `/api/v1/my/properties/${id}`,
      headers: auth(stranger.token),
    });
    expect(get.statusCode).toBe(403);

    const patch = await ctx.app.inject({
      method: 'PATCH',
      url: `/api/v1/my/properties/${id}`,
      headers: auth(stranger.token),
      payload: { priceAmount: 1 },
    });
    expect(patch.statusCode).toBe(403);
  });

  it('allows an active agency member to edit the agency property', async () => {
    const owner = await register('ownerag@example.com');
    const agency = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/agencies',
      headers: auth(owner.token),
      payload: { name: 'Agency Prop', slug: 'agency-prop' },
    });
    const agencyId = agency.json().agency.id;

    const created = await createProperty(owner.token, { agencyId });
    const id = created.json().property.id;

    const member = await register('agent@example.com');
    await ctx.app.inject({
      method: 'POST',
      url: `/api/v1/agencies/${agencyId}/members`,
      headers: auth(owner.token),
      payload: { userId: member.userId, role: 'member' },
    });

    const patch = await ctx.app.inject({
      method: 'PATCH',
      url: `/api/v1/my/properties/${id}`,
      headers: auth(member.token),
      payload: { priceAmount: 999999 },
    });
    expect(patch.statusCode).toBe(200);
    expect(patch.json().property.priceAmount).toBe(999999);
  });
});
