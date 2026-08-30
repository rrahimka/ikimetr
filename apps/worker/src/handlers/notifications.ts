import type { DatabaseTransaction } from '@ikimetr/database';

import { PermanentJobError } from '../job-processor.js';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

const URGENT_TYPES = new Set([
  'new_message',
  'request_activity',
  'property_match',
]);
const DND_RESPECTED_TYPES = new Set(['new_owner_listing', 'system_notice']);

interface NotificationPayload {
  userId: string;
  type: string;
  referenceType?: string | null;
  referenceId?: string | null;
  title?: string | null;
  body?: string | null;
  idempotencyKey?: string | null;
}

interface Preferences {
  disabledTypes: string[];
  dndEnabled: boolean;
  dndStart: string;
  dndEnd: string;
}

function parsePayload(input: unknown): NotificationPayload {
  if (typeof input !== 'object' || input === null) {
    throw new PermanentJobError('notification payload must be an object');
  }
  const candidate = input as Record<string, unknown>;
  if (
    typeof candidate['userId'] !== 'string' ||
    !UUID_RE.test(candidate['userId'])
  ) {
    throw new PermanentJobError('notification.userId must be a uuid');
  }
  if (typeof candidate['type'] !== 'string' || candidate['type'].length === 0) {
    throw new PermanentJobError('notification.type must be a non-empty string');
  }
  return {
    userId: candidate['userId'],
    type: candidate['type'],
    referenceType:
      typeof candidate['referenceType'] === 'string'
        ? candidate['referenceType']
        : null,
    referenceId:
      typeof candidate['referenceId'] === 'string'
        ? candidate['referenceId']
        : null,
    title: typeof candidate['title'] === 'string' ? candidate['title'] : null,
    body: typeof candidate['body'] === 'string' ? candidate['body'] : null,
    idempotencyKey:
      typeof candidate['idempotencyKey'] === 'string'
        ? candidate['idempotencyKey']
        : null,
  };
}

async function getPreferences(
  tx: DatabaseTransaction,
  userId: string,
): Promise<Preferences> {
  const result = await tx.query<{
    disabled_types: unknown;
    dnd_enabled: boolean;
    dnd_start: string;
    dnd_end: string;
  }>(
    `SELECT disabled_types, dnd_enabled, dnd_start, dnd_end
     FROM app.notification_preferences WHERE user_id = $1`,
    [userId],
  );
  if (result.rowCount === null || result.rowCount === 0) {
    return {
      disabledTypes: [],
      dndEnabled: true,
      dndStart: '23:00',
      dndEnd: '07:00',
    };
  }
  const row = result.rows[0];
  if (!row) {
    return {
      disabledTypes: [],
      dndEnabled: true,
      dndStart: '23:00',
      dndEnd: '07:00',
    };
  }
  const disabled = Array.isArray(row.disabled_types)
    ? (row.disabled_types as string[])
    : typeof row.disabled_types === 'string'
      ? (JSON.parse(row.disabled_types) as string[])
      : [];
  return {
    disabledTypes: disabled,
    dndEnabled: row.dnd_enabled,
    dndStart: row.dnd_start,
    dndEnd: row.dnd_end,
  };
}

function minutesOfDay(value: string): number {
  const parts = value.split(':');
  const hours = Number(parts[0]);
  const minutes = Number(parts[1]);
  return hours * 60 + minutes;
}

function computeVisibleAfter(type: string, prefs: Preferences): Date {
  if (
    !prefs.dndEnabled ||
    !DND_RESPECTED_TYPES.has(type) ||
    URGENT_TYPES.has(type)
  ) {
    return new Date();
  }
  const start = minutesOfDay(prefs.dndStart);
  const end = minutesOfDay(prefs.dndEnd);
  const now = new Date();
  const nowMinutes = now.getHours() * 60 + now.getMinutes();

  const inWindow =
    start < end
      ? nowMinutes >= start && nowMinutes < end
      : nowMinutes >= start || nowMinutes < end;
  if (!inWindow) {
    return new Date();
  }

  const target = new Date(now);
  if (nowMinutes < end) {
    target.setHours(
      Number(prefs.dndEnd.split(':')[0]),
      Number(prefs.dndEnd.split(':')[1]),
      0,
      0,
    );
  } else {
    target.setDate(target.getDate() + 1);
    target.setHours(
      Number(prefs.dndEnd.split(':')[0]),
      Number(prefs.dndEnd.split(':')[1]),
      0,
      0,
    );
  }
  return target;
}

export async function handleNotificationDeliver(
  tx: DatabaseTransaction,
  payload: unknown,
  job: { id: string; idempotencyKey: string | null },
): Promise<void> {
  const data = parsePayload(payload);
  const prefs = await getPreferences(tx, data.userId);
  if (prefs.disabledTypes.includes(data.type)) {
    return;
  }
  // Exactly-once notification creation must be keyed on the durable job
  // identity, not on a key the caller chooses to embed in the payload JSON.
  // Production outbox jobs (messaging/billing) set app.jobs.idempotency_key but
  // intentionally do NOT include it in the notification payload, so replays of
  // the same job would otherwise insert duplicate notifications. Fall back to
  // the stable job id only for legacy rows without a durable key.
  const notificationKey = job.idempotencyKey ?? `job:${job.id}`;
  const visibleAfter = computeVisibleAfter(data.type, prefs);
  await tx.query(
    `INSERT INTO app.notifications
      (user_id, type, reference_type, reference_id, title, body, payload, idempotency_key, visible_after)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    ON CONFLICT (idempotency_key) DO NOTHING`,
    [
      data.userId,
      data.type,
      data.referenceType,
      data.referenceId,
      data.title,
      data.body,
      JSON.stringify(data),
      notificationKey,
      visibleAfter,
    ],
  );
}
