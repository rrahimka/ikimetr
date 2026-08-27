import type { DatabaseConnection } from '@ikimetr/database';
import type {
  AdminListQuery,
  AdminStatusUpdate,
  AdminSubscriptionOverride,
} from './schema.js';
import { writeAudit } from '../audit.js';

export interface AdminRow {
  id: string;
  status: string;
  [key: string]: unknown;
}

export async function listUsers(
  db: DatabaseConnection,
  query: AdminListQuery,
): Promise<AdminRow[]> {
  const result = await db.transaction(async (tx) => {
    return tx.query<{
      id: string;
      email: string;
      status: string;
      created_at: string;
    }>(
      `SELECT u.id, ai.email, u.status, u.created_at
       FROM app.users u
       LEFT JOIN app.auth_identities ai ON ai.user_id = u.id
       ORDER BY u.created_at DESC
       LIMIT $1 OFFSET $2`,
      [query.limit, query.offset],
    );
  });
  return result.rows.map((r) => ({
    id: r.id,
    email: r.email,
    status: r.status,
    createdAt: r.created_at,
  }));
}

export async function listRealtors(
  db: DatabaseConnection,
  query: AdminListQuery,
): Promise<AdminRow[]> {
  const result = await db.transaction(async (tx) => {
    return tx.query<{
      user_id: string;
      status: string;
      public_name: string;
      verification_status: string;
    }>(
      `SELECT user_id, status, public_name, verification_status
       FROM app.realtor_profiles
       ORDER BY updated_at DESC
       LIMIT $1 OFFSET $2`,
      [query.limit, query.offset],
    );
  });
  return result.rows.map((r) => ({
    id: r.user_id,
    status: r.status,
    publicName: r.public_name,
    verificationStatus: r.verification_status,
  }));
}

export async function listAgencies(
  db: DatabaseConnection,
  query: AdminListQuery,
): Promise<AdminRow[]> {
  const result = await db.transaction(async (tx) => {
    return tx.query<{ id: string; name: string; slug: string; status: string }>(
      `SELECT id, name, slug, status FROM app.agencies
       ORDER BY created_at DESC LIMIT $1 OFFSET $2`,
      [query.limit, query.offset],
    );
  });
  return result.rows.map((r) => ({
    id: r.id,
    name: r.name,
    slug: r.slug,
    status: r.status,
  }));
}

export async function listListings(
  db: DatabaseConnection,
  query: AdminListQuery,
): Promise<AdminRow[]> {
  const result = await db.transaction(async (tx) => {
    return tx.query<{
      id: string;
      status: string;
      district: string | null;
      source_status: string | null;
      created_at: string;
    }>(
      `SELECT id, status, district, source_status, created_at FROM app.listings
       ORDER BY created_at DESC LIMIT $1 OFFSET $2`,
      [query.limit, query.offset],
    );
  });
  return result.rows.map((r) => ({
    id: r.id,
    status: r.status,
    district: r.district,
    sourceStatus: r.source_status,
    createdAt: r.created_at,
  }));
}

export async function listExternalListings(
  db: DatabaseConnection,
  query: AdminListQuery,
): Promise<AdminRow[]> {
  const result = await db.transaction(async (tx) => {
    return tx.query<{
      id: string;
      source: string | null;
      source_status: string | null;
      dedup_status: string | null;
      last_seen_at: string | null;
    }>(
      `SELECT id, source, source_status, dedup_status, last_seen_at
       FROM app.external_listings
       ORDER BY last_seen_at DESC NULLS LAST LIMIT $1 OFFSET $2`,
      [query.limit, query.offset],
    );
  });
  return result.rows.map((r) => ({
    id: r.id,
    status: r.source_status ?? 'unknown',
    source: r.source,
    sourceStatus: r.source_status,
    dedupStatus: r.dedup_status,
    lastSeenAt: r.last_seen_at,
  }));
}

export async function listRequests(
  db: DatabaseConnection,
  query: AdminListQuery,
): Promise<AdminRow[]> {
  const result = await db.transaction(async (tx) => {
    return tx.query<{
      id: string;
      status: string;
      operation: string;
      district: string | null;
      created_at: string;
    }>(
      `SELECT id, status, operation, district, created_at FROM app.client_requests
       ORDER BY created_at DESC LIMIT $1 OFFSET $2`,
      [query.limit, query.offset],
    );
  });
  return result.rows.map((r) => ({
    id: r.id,
    status: r.status,
    operation: r.operation,
    district: r.district,
    createdAt: r.created_at,
  }));
}

export async function listSubscriptions(
  db: DatabaseConnection,
  query: AdminListQuery,
): Promise<AdminRow[]> {
  const result = await db.transaction(async (tx) => {
    return tx.query<{
      id: string;
      user_id: string;
      plan_code: string;
      status: string;
      expires_at: string | null;
    }>(
      `SELECT s.id, s.user_id, p.code AS plan_code, s.status, s.expires_at
       FROM app.subscriptions s
       JOIN app.plans p ON p.id = s.plan_id
       ORDER BY s.created_at DESC LIMIT $1 OFFSET $2`,
      [query.limit, query.offset],
    );
  });
  return result.rows.map((r) => ({
    id: r.id,
    userId: r.user_id,
    planCode: r.plan_code,
    status: r.status,
    expiresAt: r.expires_at,
  }));
}

export async function getAuditLog(
  db: DatabaseConnection,
  query: AdminListQuery,
): Promise<unknown[]> {
  const result = await db.transaction(async (tx) => {
    return tx.query<{
      id: string;
      actor_user_id: string | null;
      actor_type: string;
      action: string;
      target_type: string;
      target_id: string | null;
      metadata: unknown;
      created_at: string;
    }>(
      `SELECT id, actor_user_id, actor_type, action, target_type, target_id, metadata, created_at
       FROM audit.audit_log
       ORDER BY created_at DESC LIMIT $1 OFFSET $2`,
      [query.limit, query.offset],
    );
  });
  return result.rows.map((r) => ({
    id: r.id,
    actorUserId: r.actor_user_id,
    actorType: r.actor_type,
    action: r.action,
    targetType: r.target_type,
    targetId: r.target_id,
    metadata: r.metadata,
    createdAt: r.created_at,
  }));
}

async function setStatus(
  db: DatabaseConnection,
  actorUserId: string,
  table: string,
  idColumn: string,
  id: string,
  status: string,
  action: string,
  targetType: string,
): Promise<AdminRow> {
  const result = await db.transaction(async (tx) => {
    const updated = await tx.query<{ id: string; status: string }>(
      `UPDATE ${table} SET status = $1, updated_at = now() WHERE ${idColumn} = $2
       RETURNING ${idColumn} AS id, status`,
      [status, id],
    );
    if (updated.rowCount === 0) {
      const err = new Error('not_found') as Error & { code?: string };
      err.code = 'not_found';
      throw err;
    }
    await writeAudit(tx, {
      actorUserId,
      action,
      targetType,
      targetId: id,
      metadata: { status },
    });
    return updated;
  });
  const row = result.rows[0]!;
  return { id: row.id, status: row.status };
}

import { NotFoundError } from '../errors.js';

export async function setUserStatus(
  db: DatabaseConnection,
  actorUserId: string,
  userId: string,
  input: AdminStatusUpdate,
): Promise<AdminRow> {
  try {
    return await setStatus(
      db,
      actorUserId,
      'app.users',
      'id',
      userId,
      input.status,
      'user.status.update',
      'user',
    );
  } catch (err) {
    if ((err as { code?: string }).code === 'not_found') {
      throw new NotFoundError('user not found');
    }
    throw err;
  }
}

export async function setRealtorStatus(
  db: DatabaseConnection,
  actorUserId: string,
  userId: string,
  input: AdminStatusUpdate,
): Promise<AdminRow> {
  try {
    return await setStatus(
      db,
      actorUserId,
      'app.realtor_profiles',
      'user_id',
      userId,
      input.status,
      'realtor.status.update',
      'realtor',
    );
  } catch (err) {
    if ((err as { code?: string }).code === 'not_found') {
      throw new NotFoundError('realtor not found');
    }
    throw err;
  }
}

export async function setAgencyStatus(
  db: DatabaseConnection,
  actorUserId: string,
  agencyId: string,
  input: AdminStatusUpdate,
): Promise<AdminRow> {
  try {
    return await setStatus(
      db,
      actorUserId,
      'app.agencies',
      'id',
      agencyId,
      input.status,
      'agency.status.update',
      'agency',
    );
  } catch (err) {
    if ((err as { code?: string }).code === 'not_found') {
      throw new NotFoundError('agency not found');
    }
    throw err;
  }
}

export async function setListingStatus(
  db: DatabaseConnection,
  actorUserId: string,
  listingId: string,
  input: AdminStatusUpdate,
): Promise<AdminRow> {
  try {
    return await setStatus(
      db,
      actorUserId,
      'app.listings',
      'id',
      listingId,
      input.status,
      'listing.status.update',
      'listing',
    );
  } catch (err) {
    if ((err as { code?: string }).code === 'not_found') {
      throw new NotFoundError('listing not found');
    }
    throw err;
  }
}

export async function setExternalListingStatus(
  db: DatabaseConnection,
  actorUserId: string,
  listingId: string,
  input: AdminStatusUpdate,
): Promise<AdminRow> {
  try {
    return await setStatus(
      db,
      actorUserId,
      'app.external_listings',
      'listing_id',
      listingId,
      input.status,
      'external_listing.status.update',
      'external_listing',
    );
  } catch (err) {
    if ((err as { code?: string }).code === 'not_found') {
      throw new NotFoundError('external listing not found');
    }
    throw err;
  }
}

export async function setRequestStatus(
  db: DatabaseConnection,
  actorUserId: string,
  requestId: string,
  input: AdminStatusUpdate,
): Promise<AdminRow> {
  try {
    return await setStatus(
      db,
      actorUserId,
      'app.client_requests',
      'id',
      requestId,
      input.status,
      'request.status.update',
      'request',
    );
  } catch (err) {
    if ((err as { code?: string }).code === 'not_found') {
      throw new NotFoundError('request not found');
    }
    throw err;
  }
}

export async function overrideSubscription(
  db: DatabaseConnection,
  actorUserId: string,
  input: AdminSubscriptionOverride,
): Promise<AdminRow> {
  const result = await db.transaction(async (tx) => {
    const plan = await tx.query<{ id: string }>(
      `SELECT id FROM app.plans WHERE code = $1`,
      [input.planCode],
    );
    if (plan.rowCount === 0) {
      const err = new Error('plan_not_found') as Error & { code?: string };
      err.code = 'plan_not_found';
      throw err;
    }
    const planId = plan.rows[0]!.id;

    const updated = await tx.query<{ id: string; status: string }>(
      `UPDATE app.subscriptions SET plan_id = $2, status = $3::varchar, provider = 'admin',
              starts_at = CASE WHEN $3::varchar = 'active' THEN now() ELSE starts_at END,
              expires_at = CASE WHEN $3::varchar = 'active' THEN now() + interval '30 days' ELSE expires_at END,
              renews_at = CASE WHEN $3::varchar = 'active' THEN now() + interval '30 days' ELSE renews_at END,
              updated_at = now()
       WHERE id = (
          SELECT id FROM app.subscriptions WHERE user_id = $1
          ORDER BY created_at DESC LIMIT 1
        )
        RETURNING id, status`,
      [input.userId, planId, input.status],
    );

    let id: string;
    let status: string;
    if (updated.rowCount === 0) {
      const created = await tx.query<{ id: string; status: string }>(
        `INSERT INTO app.subscriptions (user_id, plan_id, status, provider, starts_at, expires_at, renews_at, updated_at)
           VALUES ($1, $2, $3, 'admin', now(), now() + interval '30 days', now() + interval '30 days', now())
           RETURNING id, status`,
        [input.userId, planId, input.status],
      );
      id = created.rows[0]!.id;
      status = created.rows[0]!.status;
    } else {
      id = updated.rows[0]!.id;
      status = updated.rows[0]!.status;
    }

    await writeAudit(tx, {
      actorUserId,
      action: 'subscription.admin.update',
      targetType: 'subscription',
      targetId: id,
      metadata: {
        userId: input.userId,
        planCode: input.planCode,
        status: input.status,
      },
    });
    return { id, status };
  });
  return result;
}
