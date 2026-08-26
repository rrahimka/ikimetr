import type { DatabaseConnection } from '@ikimetr/database';

import { ForbiddenError, NotFoundError } from '../errors.js';
import { canEditProperty, type AgencyMembership } from '../authz.js';
import type { CreatePropertyInput } from '../schemas.js';

export interface Property {
  id: string;
  ownerUserId: string;
  agencyId: string | null;
  transactionType: string;
  status: string;
  title: string;
  description: string | null;
  priceAmount: number | null;
  currency: string;
  district: string | null;
  address: string | null;
  latitude: number | null;
  longitude: number | null;
  rooms: number | null;
  area: number | null;
  floor: number | null;
  totalFloors: number | null;
  renovation: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PropertyImage {
  id: string;
  propertyId: string;
  url: string;
  ordering: number;
  isPrimary: boolean;
  createdAt: string;
}

export interface PropertyActor {
  userId: string;
  membership: AgencyMembership | null;
}

interface PropertyRow {
  id: string;
  owner_user_id: string;
  agency_id: string | null;
  transaction_type: string;
  status: string;
  title: string;
  description: string | null;
  price_amount: string | null;
  currency: string;
  district: string | null;
  address: string | null;
  latitude: number | null;
  longitude: number | null;
  rooms: number | null;
  area: string | null;
  floor: number | null;
  total_floors: number | null;
  renovation: string | null;
  created_at: string;
  updated_at: string;
}

interface PropertyImageRow {
  id: string;
  property_id: string;
  url: string;
  ordering: number;
  is_primary: boolean;
  created_at: string;
}

function mapProperty(row: unknown): Property {
  const r = row as PropertyRow;
  return {
    id: r.id,
    ownerUserId: r.owner_user_id,
    agencyId: r.agency_id,
    transactionType: r.transaction_type,
    status: r.status,
    title: r.title,
    description: r.description,
    priceAmount: r.price_amount === null ? null : Number(r.price_amount),
    currency: r.currency,
    district: r.district,
    address: r.address,
    latitude: r.latitude,
    longitude: r.longitude,
    rooms: r.rooms,
    area: r.area === null ? null : Number(r.area),
    floor: r.floor,
    totalFloors: r.total_floors,
    renovation: r.renovation,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function mapPropertyImage(row: unknown): PropertyImage {
  const r = row as PropertyImageRow;
  return {
    id: r.id,
    propertyId: r.property_id,
    url: r.url,
    ordering: r.ordering,
    isPrimary: r.is_primary,
    createdAt: r.created_at,
  };
}

export async function getProperty(
  db: DatabaseConnection,
  propertyId: string,
): Promise<Property> {
  const result = await db.transaction((tx) =>
    tx.query('SELECT * FROM app.properties WHERE id = $1', [propertyId]),
  );
  if (result.rowCount === null || result.rowCount === 0) {
    throw new NotFoundError('property not found');
  }
  return mapProperty(result.rows[0]);
}

function assertCanEdit(property: Property, actor: PropertyActor): void {
  if (!canEditProperty(property, actor.userId, actor.membership)) {
    throw new ForbiddenError('not allowed to modify this property');
  }
}

export async function createProperty(
  db: DatabaseConnection,
  ownerUserId: string,
  agencyId: string | null,
  input: CreatePropertyInput,
): Promise<Property> {
  return db.transaction(async (tx) => {
    const result = await tx.query<Record<string, unknown>>(
      `INSERT INTO app.properties (
        owner_user_id, agency_id, transaction_type, title, description,
        price_amount, currency, district, address, latitude, longitude,
        rooms, area, floor, total_floors, renovation
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
      RETURNING *`,
      [
        ownerUserId,
        agencyId,
        input.transactionType,
        input.title,
        input.description ?? null,
        input.priceAmount ?? null,
        input.currency,
        input.district ?? null,
        input.address ?? null,
        input.latitude ?? null,
        input.longitude ?? null,
        input.rooms ?? null,
        input.area ?? null,
        input.floor ?? null,
        input.totalFloors ?? null,
        input.renovation ?? null,
      ],
    );
    const property = mapProperty(result.rows[0]);

    await tx.query(
      'INSERT INTO app.property_status_history (property_id, status, changed_by_user_id) VALUES ($1, $2, $3)',
      [property.id, 'draft', ownerUserId],
    );

    return property;
  });
}

export async function updateProperty(
  db: DatabaseConnection,
  propertyId: string,
  fields: {
    title?: string | undefined;
    description?: string | null | undefined;
    priceAmount?: number | null | undefined;
    currency?: string | undefined;
    district?: string | null | undefined;
    address?: string | null | undefined;
    latitude?: number | null | undefined;
    longitude?: number | null | undefined;
    rooms?: number | null | undefined;
    area?: number | null | undefined;
    floor?: number | null | undefined;
    totalFloors?: number | null | undefined;
    renovation?: string | null | undefined;
  },
  actor: PropertyActor,
): Promise<Property> {
  const property = await getProperty(db, propertyId);
  assertCanEdit(property, actor);

  const assignments: string[] = [];
  const values: unknown[] = [];
  let index = 1;
  const add = (column: string, value: unknown): void => {
    assignments.push(`${column} = $${index}`);
    values.push(value);
    index += 1;
  };

  if (fields.title !== undefined) add('title', fields.title);
  if (fields.description !== undefined) add('description', fields.description);
  if (fields.priceAmount !== undefined) add('price_amount', fields.priceAmount);
  if (fields.currency !== undefined) add('currency', fields.currency);
  if (fields.district !== undefined) add('district', fields.district);
  if (fields.address !== undefined) add('address', fields.address);
  if (fields.latitude !== undefined) add('latitude', fields.latitude);
  if (fields.longitude !== undefined) add('longitude', fields.longitude);
  if (fields.rooms !== undefined) add('rooms', fields.rooms);
  if (fields.area !== undefined) add('area', fields.area);
  if (fields.floor !== undefined) add('floor', fields.floor);
  if (fields.totalFloors !== undefined) add('total_floors', fields.totalFloors);
  if (fields.renovation !== undefined) add('renovation', fields.renovation);

  if (assignments.length === 0) {
    return property;
  }

  add('updated_at', new Date());
  values.push(propertyId);

  await db.transaction((tx) =>
    tx.query(
      `UPDATE app.properties SET ${assignments.join(', ')} WHERE id = $${index}`,
      values,
    ),
  );

  return getProperty(db, propertyId);
}

export async function changePropertyStatus(
  db: DatabaseConnection,
  propertyId: string,
  status: string,
  actor: PropertyActor,
): Promise<Property> {
  const property = await getProperty(db, propertyId);
  assertCanEdit(property, actor);

  const updated = await db.transaction(async (tx) => {
    const result = await tx.query<Record<string, unknown>>(
      'UPDATE app.properties SET status = $1, updated_at = now() WHERE id = $2 RETURNING *',
      [status, propertyId],
    );
    await tx.query(
      'INSERT INTO app.property_status_history (property_id, status, changed_by_user_id) VALUES ($1, $2, $3)',
      [propertyId, status, actor.userId],
    );
    const row = result.rows[0];
    if (!row) {
      throw new NotFoundError('property not found');
    }
    return mapProperty(row);
  });
  return updated;
}

export async function listOwnProperties(
  db: DatabaseConnection,
  userId: string,
  options: { limit: number; cursor?: string | undefined },
): Promise<{ properties: Property[]; nextCursor: string | null }> {
  const values: unknown[] = [userId, options.limit + 1];
  let cursorClause = '';
  if (options.cursor) {
    const [ts, id] = options.cursor.split('|');
    if (ts && id) {
      cursorClause = ' AND (created_at, id) < ($3::timestamptz, $4::uuid)';
      values.push(ts, id);
    }
  }

  const result = await db.transaction((tx) =>
    tx.query(
      `SELECT * FROM app.properties
       WHERE owner_user_id = $1${cursorClause}
       ORDER BY created_at DESC, id DESC
       LIMIT $2`,
      values,
    ),
  );

  const rows = result.rows.map(mapProperty);
  const hasMore = rows.length > options.limit;
  const page = hasMore ? rows.slice(0, options.limit) : rows;
  const last = page[page.length - 1];
  const nextCursor = hasMore && last ? `${last.createdAt}|${last.id}` : null;

  return { properties: page, nextCursor };
}

export async function addPropertyImage(
  db: DatabaseConnection,
  propertyId: string,
  input: {
    url: string;
    ordering?: number | undefined;
    isPrimary?: boolean | undefined;
  },
  actor: PropertyActor,
): Promise<PropertyImage> {
  const property = await getProperty(db, propertyId);
  assertCanEdit(property, actor);

  return db.transaction(async (tx) => {
    if (input.isPrimary) {
      await tx.query(
        'UPDATE app.property_images SET is_primary = false WHERE property_id = $1',
        [propertyId],
      );
    }
    const result = await tx.query(
      `INSERT INTO app.property_images (property_id, url, ordering, is_primary)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [propertyId, input.url, input.ordering ?? 0, input.isPrimary ?? false],
    );
    const row = result.rows[0];
    if (!row) {
      throw new Error('failed to add property image');
    }
    return mapPropertyImage(row);
  });
}

export async function getPropertyImages(
  db: DatabaseConnection,
  propertyId: string,
): Promise<PropertyImage[]> {
  const result = await db.transaction((tx) =>
    tx.query(
      'SELECT * FROM app.property_images WHERE property_id = $1 ORDER BY ordering ASC, created_at ASC',
      [propertyId],
    ),
  );
  return result.rows.map((row) => mapPropertyImage(row));
}
