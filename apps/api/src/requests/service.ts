import type {
  DatabaseConnection,
  DatabaseTransaction,
} from '@ikimetr/database';

import { NotFoundError } from '../errors.js';
import type { CreateRequestInput, UpdateRequestInput } from './schema.js';

export interface ClientRequest {
  id: string;
  userId: string;
  operation: string;
  propertyType: string | null;
  district: string | null;
  priceMin: number | null;
  priceMax: number | null;
  roomsMin: number | null;
  roomsMax: number | null;
  areaMin: number | null;
  areaMax: number | null;
  floorMin: number | null;
  floorMax: number | null;
  renovation: string | null;
  freeText: string | null;
  status: string;
  createdAt: string;
  updatedAt: string;
}

interface RequestRow {
  id: string;
  user_id: string;
  operation: string;
  property_type: string | null;
  district: string | null;
  price_min: string | null;
  price_max: string | null;
  rooms_min: number | null;
  rooms_max: number | null;
  area_min: string | null;
  area_max: string | null;
  floor_min: number | null;
  floor_max: number | null;
  renovation: string | null;
  free_text: string | null;
  status: string;
  created_at: string;
  updated_at: string;
}

function toRequest(row: unknown): ClientRequest {
  const r = row as RequestRow;
  return {
    id: r.id,
    userId: r.user_id,
    operation: r.operation,
    propertyType: r.property_type,
    district: r.district,
    priceMin: r.price_min === null ? null : Number(r.price_min),
    priceMax: r.price_max === null ? null : Number(r.price_max),
    roomsMin: r.rooms_min,
    roomsMax: r.rooms_max,
    areaMin: r.area_min === null ? null : Number(r.area_min),
    areaMax: r.area_max === null ? null : Number(r.area_max),
    floorMin: r.floor_min,
    floorMax: r.floor_max,
    renovation: r.renovation,
    freeText: r.free_text,
    status: r.status,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

const REQUEST_COLUMNS = [
  'user_id',
  'operation',
  'property_type',
  'district',
  'price_min',
  'price_max',
  'rooms_min',
  'rooms_max',
  'area_min',
  'area_max',
  'floor_min',
  'floor_max',
  'renovation',
  'free_text',
];

export async function createRequest(
  db: DatabaseConnection,
  userId: string,
  input: CreateRequestInput,
): Promise<ClientRequest> {
  const values = [
    userId,
    input.operation,
    input.propertyType ?? null,
    input.district ?? null,
    input.priceMin ?? null,
    input.priceMax ?? null,
    input.roomsMin ?? null,
    input.roomsMax ?? null,
    input.areaMin ?? null,
    input.areaMax ?? null,
    input.floorMin ?? null,
    input.floorMax ?? null,
    input.renovation ?? null,
    input.freeText ?? null,
  ];
  return db.transaction(async (tx: DatabaseTransaction) => {
    const result = await tx.query(
      `INSERT INTO app.client_requests (${REQUEST_COLUMNS.join(', ')})
       VALUES (${REQUEST_COLUMNS.map((_, i) => `$${i + 1}`).join(', ')})
       RETURNING *`,
      values,
    );
    const row = result.rows[0];
    if (!row) {
      throw new Error('failed to create request');
    }
    return toRequest(row);
  });
}

async function loadRequest(
  db: DatabaseConnection,
  requestId: string,
): Promise<ClientRequest> {
  const result = await db.transaction((tx: DatabaseTransaction) =>
    tx.query('SELECT * FROM app.client_requests WHERE id = $1', [requestId]),
  );
  if (result.rowCount === null || result.rowCount === 0) {
    throw new NotFoundError('request not found');
  }
  const row = result.rows[0];
  if (!row) {
    throw new NotFoundError('request not found');
  }
  return toRequest(row);
}

export async function getRequest(
  db: DatabaseConnection,
  requestId: string,
  userId: string,
): Promise<ClientRequest> {
  const request = await loadRequest(db, requestId);
  if (request.userId !== userId) {
    throw new NotFoundError('request not found');
  }
  return request;
}

export async function listRequests(
  db: DatabaseConnection,
  userId: string,
  options: { limit: number; cursor?: string | undefined },
): Promise<{ requests: ClientRequest[]; nextCursor: string | null }> {
  const values: unknown[] = [userId, options.limit + 1];
  let cursorClause = '';
  if (options.cursor) {
    const [ts, id] = options.cursor.split('|');
    if (ts && id) {
      cursorClause = ' AND (created_at, id) < ($3::timestamptz, $4::uuid)';
      values.push(ts, id);
    }
  }
  const result = await db.transaction((tx: DatabaseTransaction) =>
    tx.query(
      `SELECT * FROM app.client_requests
       WHERE user_id = $1 AND status <> 'archived'${cursorClause}
       ORDER BY created_at DESC, id DESC
       LIMIT $2`,
      values,
    ),
  );
  const rows = result.rows.map(toRequest);
  const hasMore = rows.length > options.limit;
  const page = hasMore ? rows.slice(0, options.limit) : rows;
  const last = page[page.length - 1];
  const nextCursor = hasMore && last ? `${last.createdAt}|${last.id}` : null;
  return { requests: page, nextCursor };
}

export async function updateRequest(
  db: DatabaseConnection,
  requestId: string,
  userId: string,
  fields: UpdateRequestInput,
): Promise<ClientRequest> {
  const existing = await loadRequest(db, requestId);
  if (existing.userId !== userId) {
    throw new NotFoundError('request not found');
  }

  const assignments: string[] = [];
  const values: unknown[] = [];
  let index = 1;
  const assign = (column: string, value: unknown): void => {
    assignments.push(`${column} = $${index}`);
    values.push(value);
    index += 1;
  };

  if (fields.operation !== undefined) assign('operation', fields.operation);
  if (fields.propertyType !== undefined)
    assign('property_type', fields.propertyType);
  if (fields.district !== undefined) assign('district', fields.district);
  if (fields.priceMin !== undefined) assign('price_min', fields.priceMin);
  if (fields.priceMax !== undefined) assign('price_max', fields.priceMax);
  if (fields.roomsMin !== undefined) assign('rooms_min', fields.roomsMin);
  if (fields.roomsMax !== undefined) assign('rooms_max', fields.roomsMax);
  if (fields.areaMin !== undefined) assign('area_min', fields.areaMin);
  if (fields.areaMax !== undefined) assign('area_max', fields.areaMax);
  if (fields.floorMin !== undefined) assign('floor_min', fields.floorMin);
  if (fields.floorMax !== undefined) assign('floor_max', fields.floorMax);
  if (fields.renovation !== undefined) assign('renovation', fields.renovation);
  if (fields.freeText !== undefined) assign('free_text', fields.freeText);

  if (assignments.length === 0) {
    return existing;
  }
  assign('updated_at', new Date());
  values.push(existing.id);

  return db.transaction(async (tx: DatabaseTransaction) => {
    const result = await tx.query(
      `UPDATE app.client_requests SET ${assignments.join(', ')} WHERE id = $${index} RETURNING *`,
      values,
    );
    const row = result.rows[0];
    if (!row) {
      throw new NotFoundError('request not found');
    }
    return toRequest(row);
  });
}

export async function archiveRequest(
  db: DatabaseConnection,
  requestId: string,
  userId: string,
): Promise<ClientRequest> {
  const existing = await loadRequest(db, requestId);
  if (existing.userId !== userId) {
    throw new NotFoundError('request not found');
  }
  return db.transaction(async (tx: DatabaseTransaction) => {
    const result = await tx.query(
      `UPDATE app.client_requests SET status = 'archived', updated_at = now()
       WHERE id = $1 RETURNING *`,
      [existing.id],
    );
    const row = result.rows[0];
    if (!row) {
      throw new NotFoundError('request not found');
    }
    return toRequest(row);
  });
}
