import { describe, expect, it } from 'vitest';

import { hashPassword, verifyPassword } from '../src/identity/password.js';
import {
  generateSessionToken,
  hashSessionToken,
  normalizeEmail,
  slugify,
} from '../src/identity/session.js';
import { canEditProperty, canManageAgency } from '../src/authz.js';

describe('password hashing', () => {
  it('produces a salted scrypt hash and verifies correctly', async () => {
    const hash = await hashPassword('correct horse battery staple');
    expect(hash.startsWith('scrypt$')).toBe(true);
    const parts = hash.split('$');
    expect(parts).toHaveLength(3);
    expect(parts[0]).toBe('scrypt');

    expect(await verifyPassword('correct horse battery staple', hash)).toBe(
      true,
    );
    expect(await verifyPassword('wrong password', hash)).toBe(false);
  });

  it('uses a per-password salt', async () => {
    const a = await hashPassword('same password');
    const b = await hashPassword('same password');
    expect(a).not.toEqual(b);
  });
});

describe('session tokens', () => {
  it('generates an unguessable token and a stable hash', () => {
    const token = generateSessionToken();
    expect(token).toMatch(/^[a-f0-9]{64}$/u);

    const hashed = hashSessionToken(token);
    expect(hashed).not.toEqual(token);
    expect(hashSessionToken(token)).toEqual(hashed);
  });
});

describe('normalization helpers', () => {
  it('normalizes emails', () => {
    expect(normalizeEmail('  Foo@Example.COM ')).toBe('foo@example.com');
  });

  it('slugifies agency names', () => {
    expect(slugify('Baku Elite Realty!')).toBe('baku-elite-realty');
    expect(slugify('  Çox  Güzel  ')).toBe('cox-guzel');
  });
});

describe('authorization policy', () => {
  const ownerId = '00000000-0000-0000-0000-000000000001';
  const memberId = '00000000-0000-0000-0000-000000000002';
  const agencyId = '11111111-1111-1111-1111-111111111111';

  const owner = {
    agencyId,
    userId: ownerId,
    role: 'owner' as const,
    status: 'active' as const,
  };
  const admin = {
    agencyId,
    userId: memberId,
    role: 'admin' as const,
    status: 'active' as const,
  };
  const activeMember = {
    agencyId,
    userId: memberId,
    role: 'member' as const,
    status: 'active' as const,
  };
  const pending = {
    agencyId,
    userId: memberId,
    role: 'member' as const,
    status: 'invited' as const,
  };

  it('grants agency management to the owner and active members at or above the minimum role', () => {
    expect(canManageAgency(owner, 'admin')).toBe(true);
    expect(canManageAgency(admin, 'admin')).toBe(true);
    expect(canManageAgency(activeMember, 'member')).toBe(true);
    expect(canManageAgency(activeMember, 'admin')).toBe(false);
    expect(canManageAgency(pending, 'member')).toBe(false);
    expect(canManageAgency(null, 'admin')).toBe(false);
  });

  it('allows property edits by the owner or an active agency member', () => {
    const strangerId = '00000000-0000-0000-0000-000000000003';
    const property = { ownerUserId: ownerId, agencyId };

    expect(canEditProperty(property, ownerId, null)).toBe(true);
    expect(
      canEditProperty(property, memberId, {
        agencyId,
        userId: memberId,
        role: 'member',
        status: 'active',
      }),
    ).toBe(true);
    expect(
      canEditProperty(property, memberId, {
        agencyId,
        userId: memberId,
        role: 'member',
        status: 'invited',
      }),
    ).toBe(false);
    expect(canEditProperty(property, strangerId, null)).toBe(false);
  });
});
