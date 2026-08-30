import type { DatabaseConnection } from '@ikimetr/database';

import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  UnauthenticatedError,
} from '../errors.js';
import { hashPassword, verifyPassword } from './password.js';
import {
  generateSessionToken,
  hashSessionToken,
  normalizeEmail,
} from './session.js';
import type { AgencyMembership, AgencyRole } from '../authz.js';

const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 30;

export interface AuthUser {
  id: string;
  email: string;
  status: string;
}

export interface Profile {
  userId: string;
  displayName: string;
  avatarUrl: string | null;
  phone: string | null;
  phoneVisible: boolean;
  language: string;
  locale: string;
  bio: string | null;
}

export interface RealtorProfile {
  userId: string;
  status: string;
  publicName: string;
  bio: string | null;
  specialization: string | null;
  serviceAreas: string[];
  languages: string[];
  agencyId: string | null;
  verificationStatus: string;
}

export interface Agency {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  ownerUserId: string;
  status: string;
}

interface ProfileRow {
  user_id: string;
  display_name: string;
  avatar_url: string | null;
  phone: string | null;
  phone_visible: boolean;
  language: string;
  locale: string;
  bio: string | null;
}

interface RealtorRow {
  user_id: string;
  status: string;
  public_name: string;
  bio: string | null;
  specialization: string | null;
  service_areas: string[] | null;
  languages: string[] | null;
  agency_id: string | null;
  verification_status: string;
}

interface AgencyRow {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  owner_user_id: string;
  status: string;
}

function mapProfile(row: unknown): Profile {
  const r = row as ProfileRow;
  return {
    userId: r.user_id,
    displayName: r.display_name,
    avatarUrl: r.avatar_url,
    phone: r.phone,
    phoneVisible: r.phone_visible,
    language: r.language,
    locale: r.locale,
    bio: r.bio,
  };
}

function mapRealtor(row: unknown): RealtorProfile {
  const r = row as RealtorRow;
  return {
    userId: r.user_id,
    status: r.status,
    publicName: r.public_name,
    bio: r.bio,
    specialization: r.specialization,
    serviceAreas: r.service_areas ?? [],
    languages: r.languages ?? [],
    agencyId: r.agency_id,
    verificationStatus: r.verification_status,
  };
}

function mapAgency(row: unknown): Agency {
  const r = row as AgencyRow;
  return {
    id: r.id,
    name: r.name,
    slug: r.slug,
    description: r.description,
    ownerUserId: r.owner_user_id,
    status: r.status,
  };
}

export async function registerUser(
  db: DatabaseConnection,
  input: { email: string; password: string; displayName?: string | undefined },
): Promise<{ userId: string }> {
  const emailNormalized = normalizeEmail(input.email);

  return db.transaction(async (tx) => {
    const existing = await tx.query<{ count: number }>(
      'SELECT 1 AS count FROM app.auth_identities WHERE email_normalized = $1 AND provider = $2',
      [emailNormalized, 'email'],
    );
    if (existing.rowCount !== null && existing.rowCount > 0) {
      throw new ConflictError('email already registered');
    }

    const user = await tx.query<{ id: string; status: string }>(
      'INSERT INTO app.users DEFAULT VALUES RETURNING id, status',
    );
    const userId = user.rows[0]?.id;
    if (userId === undefined) {
      throw new Error('failed to create user');
    }

    const passwordHash = await hashPassword(input.password);
    await tx.query(
      'INSERT INTO app.auth_identities (user_id, provider, email, email_normalized, password_hash) VALUES ($1, $2, $3, $4, $5)',
      [userId, 'email', input.email, emailNormalized, passwordHash],
    );
    await tx.query(
      'INSERT INTO app.profiles (user_id, display_name) VALUES ($1, $2)',
      [userId, input.displayName?.trim() ?? ''],
    );

    return { userId };
  });
}

export async function authenticateUser(
  db: DatabaseConnection,
  email: string,
  password: string,
): Promise<AuthUser | null> {
  const emailNormalized = normalizeEmail(email);
  const result = await db.transaction((tx) =>
    tx.query<{
      user_id: string;
      password_hash: string | null;
      status: string;
      email: string;
    }>(
      `SELECT u.id AS user_id, ai.password_hash, u.status, ai.email
       FROM app.auth_identities ai
       JOIN app.users u ON u.id = ai.user_id
       WHERE ai.email_normalized = $1 AND ai.provider = $2`,
      [emailNormalized, 'email'],
    ),
  );

  if (result.rowCount === null || result.rowCount === 0) {
    return null;
  }

  const row = result.rows[0];
  if (!row) {
    return null;
  }
  if (row.password_hash === null) {
    return null;
  }

  const valid = await verifyPassword(password, row.password_hash);
  if (!valid) {
    return null;
  }

  if (row.status !== 'active') {
    throw new UnauthenticatedError('account is not active');
  }

  return { id: row.user_id, email: row.email, status: row.status };
}

export async function createSession(
  db: DatabaseConnection,
  userId: string,
  metadata: { ipAddress?: string | null; userAgent?: string | null },
): Promise<string> {
  const token = generateSessionToken();
  const tokenHash = hashSessionToken(token);
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);

  await db.transaction((tx) =>
    tx.query(
      'INSERT INTO app.sessions (user_id, token_hash, expires_at, ip_address, user_agent) VALUES ($1, $2, $3, $4, $5)',
      [
        userId,
        tokenHash,
        expiresAt,
        metadata.ipAddress ?? null,
        metadata.userAgent ?? null,
      ],
    ),
  );

  return token;
}

export async function getUserFromSession(
  db: DatabaseConnection,
  token: string,
): Promise<AuthUser | null> {
  const tokenHash = hashSessionToken(token);
  const result = await db.transaction((tx) =>
    tx.query<{ user_id: string; email: string; status: string }>(
      `SELECT s.user_id, ai.email, u.status
       FROM app.sessions s
       JOIN app.users u ON u.id = s.user_id
       LEFT JOIN app.auth_identities ai ON ai.user_id = u.id AND ai.provider = $2
       WHERE s.token_hash = $1 AND s.revoked_at IS NULL AND s.expires_at > now()`,
      [tokenHash, 'email'],
    ),
  );

  if (result.rowCount === null || result.rowCount === 0) {
    return null;
  }

  const row = result.rows[0];
  if (!row) {
    return null;
  }
  // Server-side current account state is the source of truth. A suspended or
  // banned user must not keep using an already-issued session token.
  if (row.status !== 'active') {
    return null;
  }
  return { id: row.user_id, email: row.email, status: row.status };
}

export async function revokeSession(
  db: DatabaseConnection,
  token: string,
): Promise<void> {
  const tokenHash = hashSessionToken(token);
  await db.transaction((tx) =>
    tx.query(
      'UPDATE app.sessions SET revoked_at = now() WHERE token_hash = $1 AND revoked_at IS NULL',
      [tokenHash],
    ),
  );
}

export async function getProfile(
  db: DatabaseConnection,
  userId: string,
): Promise<Profile> {
  const result = await db.transaction((tx) =>
    tx.query('SELECT * FROM app.profiles WHERE user_id = $1', [userId]),
  );
  if (result.rowCount === null || result.rowCount === 0) {
    throw new NotFoundError('profile not found');
  }
  const row = result.rows[0];
  if (!row) {
    throw new NotFoundError('profile not found');
  }
  return mapProfile(row);
}

export async function updateProfile(
  db: DatabaseConnection,
  userId: string,
  fields: {
    displayName?: string | undefined;
    avatarUrl?: string | null | undefined;
    phone?: string | null | undefined;
    phoneVisible?: boolean | undefined;
    language?: string | undefined;
    locale?: string | undefined;
    bio?: string | null | undefined;
  },
): Promise<Profile> {
  const assignments: string[] = [];
  const values: unknown[] = [];
  let index = 1;

  const add = (column: string, value: unknown): void => {
    assignments.push(`${column} = $${index}`);
    values.push(value);
    index += 1;
  };

  if (fields.displayName !== undefined) add('display_name', fields.displayName);
  if (fields.avatarUrl !== undefined) add('avatar_url', fields.avatarUrl);
  if (fields.phone !== undefined) add('phone', fields.phone);
  if (fields.phoneVisible !== undefined)
    add('phone_visible', fields.phoneVisible);
  if (fields.language !== undefined) add('language', fields.language);
  if (fields.locale !== undefined) add('locale', fields.locale);
  if (fields.bio !== undefined) add('bio', fields.bio);

  if (assignments.length === 0) {
    return getProfile(db, userId);
  }

  add('updated_at', new Date());
  values.push(userId);

  await db.transaction((tx) =>
    tx.query(
      `UPDATE app.profiles SET ${assignments.join(', ')} WHERE user_id = $${index}`,
      values,
    ),
  );

  return getProfile(db, userId);
}

export async function getRealtor(
  db: DatabaseConnection,
  userId: string,
): Promise<RealtorProfile> {
  const result = await db.transaction((tx) =>
    tx.query('SELECT * FROM app.realtor_profiles WHERE user_id = $1', [userId]),
  );
  if (result.rowCount === null || result.rowCount === 0) {
    throw new NotFoundError('realtor profile not found');
  }
  const row = result.rows[0];
  if (!row) {
    throw new NotFoundError('realtor profile not found');
  }
  return mapRealtor(row);
}

export async function getOrCreateRealtor(
  db: DatabaseConnection,
  userId: string,
): Promise<RealtorProfile> {
  try {
    return await getRealtor(db, userId);
  } catch (error) {
    if (!(error instanceof NotFoundError)) throw error;
  }

  await db.transaction((tx) =>
    tx.query(
      'INSERT INTO app.realtor_profiles (user_id) VALUES ($1) ON CONFLICT DO NOTHING',
      [userId],
    ),
  );
  return getRealtor(db, userId);
}

export async function updateRealtor(
  db: DatabaseConnection,
  userId: string,
  fields: {
    publicName?: string | undefined;
    bio?: string | null | undefined;
    specialization?: string | null | undefined;
    serviceAreas?: string[] | undefined;
    languages?: string[] | undefined;
  },
): Promise<RealtorProfile> {
  await getOrCreateRealtor(db, userId);

  const assignments: string[] = [];
  const values: unknown[] = [];
  let index = 1;
  const add = (column: string, value: unknown): void => {
    assignments.push(`${column} = $${index}`);
    values.push(value);
    index += 1;
  };

  if (fields.publicName !== undefined) add('public_name', fields.publicName);
  if (fields.bio !== undefined) add('bio', fields.bio);
  if (fields.specialization !== undefined)
    add('specialization', fields.specialization);
  if (fields.serviceAreas !== undefined)
    add('service_areas', fields.serviceAreas);
  if (fields.languages !== undefined) add('languages', fields.languages);

  if (assignments.length > 0) {
    add('updated_at', new Date());
    values.push(userId);
    await db.transaction((tx) =>
      tx.query(
        `UPDATE app.realtor_profiles SET ${assignments.join(', ')} WHERE user_id = $${index}`,
        values,
      ),
    );
  }

  return getRealtor(db, userId);
}

export async function createAgency(
  db: DatabaseConnection,
  ownerUserId: string,
  input: {
    name: string;
    slug: string;
    description?: string | null | undefined;
  },
): Promise<Agency> {
  try {
    const result = await db.transaction((tx) =>
      tx.query<{
        id: string;
        name: string;
        slug: string;
        description: string | null;
        owner_user_id: string;
        status: string;
      }>(
        `INSERT INTO app.agencies (name, slug, description, owner_user_id)
         VALUES ($1, $2, $3, $4)
         RETURNING id, name, slug, description, owner_user_id, status`,
        [input.name, input.slug, input.description ?? null, ownerUserId],
      ),
    );
    const agencyId = result.rows[0]?.id;
    if (agencyId === undefined) {
      throw new Error('failed to create agency');
    }
    await db.transaction((tx) =>
      tx.query(
        `INSERT INTO app.agency_memberships (agency_id, user_id, role, status)
         VALUES ($1, $2, 'owner', 'active')
         ON CONFLICT DO NOTHING`,
        [agencyId, ownerUserId],
      ),
    );
    const row = result.rows[0];
    if (!row) {
      throw new Error('failed to create agency');
    }
    return mapAgency(row);
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code === '23505') {
      throw new ConflictError('agency slug already used');
    }
    throw error;
  }
}

export async function getAgency(
  db: DatabaseConnection,
  agencyId: string,
): Promise<Agency> {
  const result = await db.transaction((tx) =>
    tx.query('SELECT * FROM app.agencies WHERE id = $1', [agencyId]),
  );
  if (result.rowCount === null || result.rowCount === 0) {
    throw new NotFoundError('agency not found');
  }
  return mapAgency(result.rows[0]!);
}

export async function updateAgency(
  db: DatabaseConnection,
  agencyId: string,
  fields: {
    name?: string | undefined;
    slug?: string | undefined;
    description?: string | null | undefined;
  },
): Promise<Agency> {
  const assignments: string[] = [];
  const values: unknown[] = [];
  let index = 1;
  const add = (column: string, value: unknown): void => {
    assignments.push(`${column} = $${index}`);
    values.push(value);
    index += 1;
  };

  if (fields.name !== undefined) add('name', fields.name);
  if (fields.slug !== undefined) add('slug', fields.slug);
  if (fields.description !== undefined) add('description', fields.description);

  if (assignments.length === 0) {
    return getAgency(db, agencyId);
  }

  add('updated_at', new Date());
  values.push(agencyId);

  try {
    await db.transaction((tx) =>
      tx.query(
        `UPDATE app.agencies SET ${assignments.join(', ')} WHERE id = $${index}`,
        values,
      ),
    );
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code === '23505') {
      throw new ConflictError('agency slug already used');
    }
    throw error;
  }

  return getAgency(db, agencyId);
}

export async function getMembership(
  db: DatabaseConnection,
  agencyId: string,
  userId: string,
): Promise<AgencyMembership | null> {
  const result = await db.transaction((tx) =>
    tx.query<{
      agency_id: string;
      user_id: string;
      role: AgencyRole;
      status: string;
    }>(
      'SELECT agency_id, user_id, role, status FROM app.agency_memberships WHERE agency_id = $1 AND user_id = $2',
      [agencyId, userId],
    ),
  );
  if (result.rowCount === null || result.rowCount === 0) {
    return null;
  }
  const row = result.rows[0];
  if (!row) {
    return null;
  }
  return {
    agencyId: row.agency_id,
    userId: row.user_id,
    role: row.role,
    status: row.status as AgencyMembership['status'],
  };
}

export async function requireActiveMembership(
  db: DatabaseConnection,
  agencyId: string,
  userId: string,
  minimumRole: AgencyRole = 'admin',
): Promise<AgencyMembership> {
  const membership = await getMembership(db, agencyId, userId);
  if (membership === null || membership.status !== 'active') {
    throw new ForbiddenError('not an active agency member');
  }

  const order: Record<AgencyRole, number> = { member: 0, admin: 1, owner: 2 };
  if (order[membership.role] < order[minimumRole]) {
    throw new ForbiddenError('insufficient agency role');
  }

  return membership;
}

export async function listAgencyMembers(
  db: DatabaseConnection,
  agencyId: string,
): Promise<AgencyMembership[]> {
  const result = await db.transaction((tx) =>
    tx.query<{
      agency_id: string;
      user_id: string;
      role: AgencyRole;
      status: string;
    }>(
      'SELECT agency_id, user_id, role, status FROM app.agency_memberships WHERE agency_id = $1 ORDER BY created_at ASC',
      [agencyId],
    ),
  );
  return result.rows.map((row) => ({
    agencyId: row.agency_id,
    userId: row.user_id,
    role: row.role,
    status: row.status as AgencyMembership['status'],
  }));
}

export async function addAgencyMember(
  db: DatabaseConnection,
  agencyId: string,
  userId: string,
  role: AgencyRole,
): Promise<AgencyMembership> {
  const existing = await getMembership(db, agencyId, userId);
  if (existing !== null) {
    throw new ConflictError('user is already a member');
  }

  const result = await db.transaction((tx) =>
    tx.query<{
      agency_id: string;
      user_id: string;
      role: AgencyRole;
      status: string;
    }>(
      `INSERT INTO app.agency_memberships (agency_id, user_id, role, status)
       VALUES ($1, $2, $3, 'active')
       RETURNING agency_id, user_id, role, status`,
      [agencyId, userId, role],
    ),
  );
  const row = result.rows[0];
  if (!row) {
    throw new Error('failed to add agency member');
  }
  return {
    agencyId: row.agency_id,
    userId: row.user_id,
    role: row.role,
    status: row.status as AgencyMembership['status'],
  };
}
