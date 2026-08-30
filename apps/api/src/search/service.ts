import type {
  DatabaseConnection,
  DatabaseTransaction,
} from '@ikimetr/database';

import type { SearchQuery } from './schema.js';

export interface PublicListing {
  id: string;
  source: string;
  externalId: string | null;
  transactionType: string;
  propertyType: string | null;
  title: string | null;
  district: string | null;
  priceAmount: number | null;
  currency: string;
  rooms: number | null;
  area: number | null;
  floor: number | null;
  renovation: string | null;
  sellerType: string;
  createdAt: string;
}

interface ListingRow {
  id: string;
  source: string;
  external_id: string | null;
  transaction_type: string;
  property_type: string | null;
  title: string | null;
  district: string | null;
  price_amount: string | null;
  currency: string;
  rooms: number | null;
  area: string | null;
  floor: number | null;
  renovation: string | null;
  seller_type: string;
  created_at: string;
}

function toPublicListing(row: unknown): PublicListing {
  const r = row as ListingRow;
  return {
    id: r.id,
    source: r.source,
    externalId: r.external_id,
    transactionType: r.transaction_type,
    propertyType: r.property_type,
    title: r.title,
    district: r.district,
    priceAmount: r.price_amount === null ? null : Number(r.price_amount),
    currency: r.currency,
    rooms: r.rooms,
    area: r.area === null ? null : Number(r.area),
    floor: r.floor,
    renovation: r.renovation,
    sellerType: r.seller_type,
    createdAt: r.created_at,
  };
}

export interface ListingFilter {
  operation?: string | undefined;
  propertyType?: string | undefined;
  district?: string | undefined;
  priceMin?: number | undefined;
  priceMax?: number | undefined;
  rooms?: number | undefined;
  areaMin?: number | undefined;
  areaMax?: number | undefined;
  floor?: number | undefined;
  renovation?: string | undefined;
  source?: string | undefined;
  status?: string | undefined;
  sellerType?: string | undefined;
}

interface ListingQueryOptions {
  visibility: 'public' | 'internal';
  filters: ListingFilter;
  sort: SearchQuery['sort'];
  limit: number;
  cursor?: string | undefined;
}

interface SortSpec {
  column: string;
  direction: 'ASC' | 'DESC';
  tiebreak: 'ASC' | 'DESC';
}

function sortSpec(sort: SearchQuery['sort']): SortSpec {
  switch (sort) {
    case 'price_asc':
      return { column: 'price_amount', direction: 'ASC', tiebreak: 'ASC' };
    case 'price_desc':
      return { column: 'price_amount', direction: 'DESC', tiebreak: 'DESC' };
    case 'newest':
    default:
      return { column: 'created_at', direction: 'DESC', tiebreak: 'DESC' };
  }
}

function encodeCursor(value: string, id: string): string {
  return Buffer.from(`${value}|${id}`).toString('base64');
}

function decodeCursor(cursor: string): [string, string] | null {
  try {
    const decoded = Buffer.from(cursor, 'base64').toString('utf8');
    const parts = decoded.split('|');
    const value = parts[0];
    const id = parts[1];
    if (
      value !== undefined &&
      id !== undefined &&
      value.length > 0 &&
      id.length > 0
    ) {
      return [value, id];
    }
  } catch {
    // ignore malformed cursor
  }
  return null;
}

function buildWhere(
  options: ListingQueryOptions,
  values: unknown[],
): { clause: string; cursorHandled: boolean } {
  const conditions: string[] = ['visibility = $1'];
  values.push(options.visibility);

  const f = options.filters;
  if (f.status) {
    values.push(f.status);
    conditions.push(`status = $${values.length}`);
  } else {
    conditions.push(`status = 'active'`);
  }
  if (f.sellerType) {
    values.push(f.sellerType);
    conditions.push(`seller_type = $${values.length}`);
  }
  if (f.operation) {
    values.push(f.operation);
    conditions.push(`transaction_type = $${values.length}`);
  }
  if (f.propertyType) {
    values.push(f.propertyType);
    conditions.push(`property_type = $${values.length}`);
  }
  if (f.district) {
    values.push(f.district);
    conditions.push(`district = $${values.length}`);
  }
  if (f.source) {
    values.push(f.source);
    conditions.push(`source = $${values.length}`);
  }
  if (f.renovation) {
    values.push(f.renovation);
    conditions.push(`renovation = $${values.length}`);
  }
  if (typeof f.priceMin === 'number' && typeof f.priceMax === 'number') {
    values.push(f.priceMin, f.priceMax);
    conditions.push(
      `price_amount BETWEEN $${values.length - 1} AND $${values.length}`,
    );
  } else if (typeof f.priceMin === 'number') {
    values.push(f.priceMin);
    conditions.push(`price_amount >= $${values.length}`);
  } else if (typeof f.priceMax === 'number') {
    values.push(f.priceMax);
    conditions.push(`price_amount <= $${values.length}`);
  }
  if (typeof f.rooms === 'number') {
    values.push(f.rooms);
    conditions.push(`rooms = $${values.length}`);
  }
  if (typeof f.floor === 'number') {
    values.push(f.floor);
    conditions.push(`floor = $${values.length}`);
  }
  if (typeof f.areaMin === 'number' && typeof f.areaMax === 'number') {
    values.push(f.areaMin, f.areaMax);
    conditions.push(`area BETWEEN $${values.length - 1} AND $${values.length}`);
  } else if (typeof f.areaMin === 'number') {
    values.push(f.areaMin);
    conditions.push(`area >= $${values.length}`);
  } else if (typeof f.areaMax === 'number') {
    values.push(f.areaMax);
    conditions.push(`area <= $${values.length}`);
  }

  let cursorHandled = false;
  const spec = sortSpec(options.sort);
  const decoded = options.cursor ? decodeCursor(options.cursor) : null;
  if (decoded) {
    const [value, id] = decoded;
    if (options.sort === 'newest') {
      values.push(value, id);
      conditions.push(
        `(created_at, id) < ($${values.length - 1}::timestamptz, $${values.length}::uuid)`,
      );
      cursorHandled = true;
    } else if (spec.column === 'price_amount') {
      const numeric = Number(value);
      if (Number.isFinite(numeric)) {
        values.push(numeric, id);
        const op = spec.direction === 'ASC' ? '>' : '<';
        conditions.push(
          `(price_amount, id) ${op} ($${values.length - 1}::bigint, $${values.length}::uuid)`,
        );
        cursorHandled = true;
      }
    }
  }

  if (options.sort !== 'newest' && spec.column === 'price_amount') {
    conditions.push('price_amount IS NOT NULL');
  }

  return { clause: conditions.join(' AND '), cursorHandled };
}

async function queryListings(
  db: DatabaseConnection,
  options: ListingQueryOptions,
): Promise<{ listings: PublicListing[]; nextCursor: string | null }> {
  const values: unknown[] = [];
  const { clause } = buildWhere(options, values);

  const spec = sortSpec(options.sort);
  const orderBy = `ORDER BY ${spec.column} ${spec.direction}, id ${spec.tiebreak}`;
  const limitValue = options.limit + 1;
  values.push(limitValue);
  const limitClause = `LIMIT $${values.length}`;

  const result = await db.transaction((tx: DatabaseTransaction) =>
    tx.query(
      `SELECT id, source, external_id, transaction_type, property_type, title,
              district, price_amount, currency, rooms, area, floor, renovation,
              seller_type, created_at
       FROM app.listings
       WHERE ${clause}
       ${orderBy}
       ${limitClause}`,
      values,
    ),
  );

  const rows = result.rows.map(toPublicListing);
  const hasMore = rows.length > options.limit;
  const page = hasMore ? rows.slice(0, options.limit) : rows;
  const last = page[page.length - 1];
  let nextCursor: string | null = null;
  if (hasMore && last) {
    const value =
      options.sort === 'newest'
        ? new Date(last.createdAt).toISOString()
        : String(last.priceAmount);
    nextCursor = encodeCursor(value, last.id);
  }

  return { listings: page, nextCursor };
}

export function searchListings(
  db: DatabaseConnection,
  query: SearchQuery,
): Promise<{ listings: PublicListing[]; nextCursor: string | null }> {
  const filters: ListingFilter = {
    operation: query.operation,
    propertyType: query.propertyType,
    district: query.district,
    priceMin: query.priceMin,
    priceMax: query.priceMax,
    rooms: query.rooms,
    areaMin: query.areaMin,
    areaMax: query.areaMax,
    floor: query.floor,
    renovation: query.renovation,
    source: query.source,
    status: query.status,
    sellerType: query.sellerType,
  };
  return queryListings(db, {
    visibility: 'public',
    filters,
    sort: query.sort,
    limit: query.limit,
    cursor: query.cursor,
  });
}

export function ownerFeedListings(
  db: DatabaseConnection,
  query: SearchQuery,
): Promise<{ listings: PublicListing[]; nextCursor: string | null }> {
  const filters: ListingFilter = {
    operation: query.operation,
    propertyType: query.propertyType,
    district: query.district,
    priceMin: query.priceMin,
    priceMax: query.priceMax,
    rooms: query.rooms,
    areaMin: query.areaMin,
    areaMax: query.areaMax,
    floor: query.floor,
    renovation: query.renovation,
    source: query.source,
    status: query.status,
    sellerType: 'owner',
  };
  return queryListings(db, {
    visibility: 'public',
    filters,
    sort: query.sort,
    limit: query.limit,
    cursor: query.cursor,
  });
}
