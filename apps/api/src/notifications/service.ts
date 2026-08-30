import type { DatabaseConnection } from '@ikimetr/database';

import { NotFoundError } from '../errors.js';
import type { Page } from '../messaging/service.js';
import type { NotificationQuery, UpdatePreferencesInput } from './schema.js';

export interface NotificationRecord {
  id: string;
  userId: string;
  type: string;
  referenceType: string | null;
  referenceId: string | null;
  title: string | null;
  body: string | null;
  read: boolean;
  visibleAfter: Date;
  createdAt: Date;
}

export interface NotificationPreferences {
  userId: string;
  disabledTypes: string[];
  dndEnabled: boolean;
  dndStart: string;
  dndEnd: string;
}

export async function listNotifications(
  db: DatabaseConnection,
  userId: string,
  query: NotificationQuery,
): Promise<Page<NotificationRecord>> {
  const limit = Math.min(query.limit, 100);
  const cursorCreatedAt = query.cursor
    ? await getNotificationCreatedAt(db, query.cursor)
    : null;

  const result = await db.transaction((tx) =>
    tx.query<NotificationRow>(
      `SELECT id, user_id, type, reference_type, reference_id,
              title, body, read, visible_after, created_at
       FROM app.notifications
       WHERE user_id = $1 AND visible_after <= now()
         AND ($2::uuid IS NULL OR (created_at, id) < ($3::timestamptz, $2::uuid))
       ORDER BY created_at DESC, id DESC
       LIMIT $4`,
      [userId, query.cursor ?? null, cursorCreatedAt, limit + 1],
    ),
  );

  return pageFrom(
    result.rows.slice(0, limit).map((row) => toNotification(row)),
    limit,
    (n) => n.id,
  );
}

export async function getNotification(
  db: DatabaseConnection,
  id: string,
  userId: string,
): Promise<NotificationRecord> {
  const result = await db.transaction((tx) =>
    tx.query<NotificationRow>(
      `SELECT id, user_id, type, reference_type, reference_id,
              title, body, read, visible_after, created_at
       FROM app.notifications WHERE id = $1`,
      [id],
    ),
  );
  const row = result.rows[0];
  if (!row || row.user_id !== userId) {
    throw new NotFoundError('notification not found');
  }
  return toNotification(row);
}

export async function markNotificationRead(
  db: DatabaseConnection,
  id: string,
  userId: string,
): Promise<NotificationRecord> {
  const result = await db.transaction((tx) =>
    tx.query<NotificationRow>(
      `UPDATE app.notifications SET read = true
       WHERE id = $1 AND user_id = $2 AND read = false
       RETURNING id, user_id, type, reference_type, reference_id,
                 title, body, read, visible_after, created_at`,
      [id, userId],
    ),
  );
  if (result.rowCount === null || result.rowCount === 0) {
    throw new NotFoundError('notification not found');
  }
  return toNotification(result.rows[0]!);
}

export async function getNotificationPreferences(
  db: DatabaseConnection,
  userId: string,
): Promise<NotificationPreferences> {
  const existing = await db.transaction((tx) =>
    tx.query<PreferencesRow>(
      `SELECT user_id, disabled_types, dnd_enabled, dnd_start, dnd_end
       FROM app.notification_preferences WHERE user_id = $1`,
      [userId],
    ),
  );
  if (existing.rowCount !== null && existing.rowCount > 0) {
    return toPreferences(existing.rows[0]!);
  }
  const created = await db.transaction((tx) =>
    tx.query<PreferencesRow>(
      `INSERT INTO app.notification_preferences (user_id)
       VALUES ($1)
       RETURNING user_id, disabled_types, dnd_enabled, dnd_start, dnd_end`,
      [userId],
    ),
  );
  const row = created.rows[0];
  if (!row) {
    throw new Error('notification preferences insert failed');
  }
  return toPreferences(row);
}

export async function updateNotificationPreferences(
  db: DatabaseConnection,
  userId: string,
  fields: UpdatePreferencesInput,
): Promise<NotificationPreferences> {
  const current = await getNotificationPreferences(db, userId);
  const next: NotificationPreferences = {
    userId,
    disabledTypes: fields.disabledTypes ?? current.disabledTypes,
    dndEnabled: fields.dndEnabled ?? current.dndEnabled,
    dndStart: fields.dndStart ?? current.dndStart,
    dndEnd: fields.dndEnd ?? current.dndEnd,
  };
  const result = await db.transaction((tx) =>
    tx.query<PreferencesRow>(
      `INSERT INTO app.notification_preferences
         (user_id, disabled_types, dnd_enabled, dnd_start, dnd_end)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (user_id)
       DO UPDATE SET
         disabled_types = $2,
         dnd_enabled = $3,
         dnd_start = $4,
         dnd_end = $5,
         updated_at = now()
       RETURNING user_id, disabled_types, dnd_enabled, dnd_start, dnd_end`,
      [
        userId,
        JSON.stringify(next.disabledTypes),
        next.dndEnabled,
        next.dndStart,
        next.dndEnd,
      ],
    ),
  );
  const row = result.rows[0];
  if (!row) {
    throw new Error('notification preferences upsert failed');
  }
  return toPreferences(row);
}

interface NotificationRow {
  id: string;
  user_id: string;
  type: string;
  reference_type: string | null;
  reference_id: string | null;
  title: string | null;
  body: string | null;
  read: boolean;
  visible_after: Date;
  created_at: Date;
}

interface PreferencesRow {
  user_id: string;
  disabled_types: unknown;
  dnd_enabled: boolean;
  dnd_start: string;
  dnd_end: string;
}

function toNotification(row: unknown): NotificationRecord {
  const r = row as NotificationRow;
  return {
    id: r.id,
    userId: r.user_id,
    type: r.type,
    referenceType: r.reference_type,
    referenceId: r.reference_id,
    title: r.title,
    body: r.body,
    read: r.read,
    visibleAfter: r.visible_after,
    createdAt: r.created_at,
  };
}

function toPreferences(row: unknown): NotificationPreferences {
  const r = row as PreferencesRow;
  const disabled = Array.isArray(r.disabled_types)
    ? r.disabled_types
    : typeof r.disabled_types === 'string'
      ? JSON.parse(r.disabled_types)
      : [];
  return {
    userId: r.user_id,
    disabledTypes: disabled as string[],
    dndEnabled: r.dnd_enabled,
    dndStart: r.dnd_start,
    dndEnd: r.dnd_end,
  };
}

async function getNotificationCreatedAt(
  db: DatabaseConnection,
  id: string,
): Promise<Date | null> {
  const result = await db.transaction((tx) =>
    tx.query<{ created_at: Date }>(
      'SELECT created_at FROM app.notifications WHERE id = $1',
      [id],
    ),
  );
  return result.rowCount !== null && result.rowCount > 0
    ? result.rows[0]!.created_at
    : null;
}

function pageFrom<T>(
  items: T[],
  limit: number,
  cursorOf: (item: T) => string,
): Page<T> {
  const hasMore = items.length === limit;
  const last = items[items.length - 1];
  return {
    items,
    nextCursor: hasMore && last ? cursorOf(last) : null,
  };
}
