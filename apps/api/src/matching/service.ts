import type {
  DatabaseConnection,
  DatabaseTransaction,
} from '@ikimetr/database';

import { NotFoundError } from '../errors.js';
import type { ClientRequest } from '../requests/service.js';

export interface MatchReason {
  code: string;
  detail: string;
}

export interface MatchResult {
  listingId: string;
  matched: boolean;
  score: number;
  reasons: MatchReason[];
}

interface CandidateRow {
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

export interface MatchedListing {
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
  score: number;
  reasons: MatchReason[];
}

function toMatchedListing(
  row: CandidateRow,
  score: number,
  reasons: MatchReason[],
): MatchedListing {
  return {
    id: row.id,
    source: row.source,
    externalId: row.external_id,
    transactionType: row.transaction_type,
    propertyType: row.property_type,
    title: row.title,
    district: row.district,
    priceAmount: row.price_amount === null ? null : Number(row.price_amount),
    currency: row.currency,
    rooms: row.rooms,
    area: row.area === null ? null : Number(row.area),
    floor: row.floor,
    renovation: row.renovation,
    sellerType: row.seller_type,
    createdAt: row.created_at,
    score,
    reasons,
  };
}

function evaluate(request: ClientRequest, row: CandidateRow): MatchResult {
  const reasons: MatchReason[] = [];
  let matched = true;

  if (row.transaction_type !== request.operation) {
    matched = false;
    reasons.push({
      code: 'operation_mismatch',
      detail: `listing is ${row.transaction_type}`,
    });
  }

  if (request.district && row.district) {
    if (row.district.toLowerCase() !== request.district.toLowerCase()) {
      matched = false;
      reasons.push({
        code: 'district_mismatch',
        detail: `listing district ${row.district}`,
      });
    }
  }

  if (request.propertyType && row.property_type) {
    if (row.property_type !== request.propertyType) {
      matched = false;
      reasons.push({
        code: 'property_type_mismatch',
        detail: `listing type ${row.property_type}`,
      });
    }
  }

  const price = row.price_amount === null ? null : Number(row.price_amount);
  if (price !== null) {
    if (request.priceMax !== null && price > request.priceMax) {
      matched = false;
      reasons.push({ code: 'price_over_max', detail: `price ${price}` });
    }
    if (request.priceMin !== null && price < request.priceMin) {
      matched = false;
      reasons.push({ code: 'price_under_min', detail: `price ${price}` });
    }
  }

  if (row.rooms !== null) {
    if (request.roomsMin !== null && row.rooms < request.roomsMin) {
      matched = false;
      reasons.push({ code: 'rooms_too_few', detail: `rooms ${row.rooms}` });
    }
    if (request.roomsMax !== null && row.rooms > request.roomsMax) {
      matched = false;
      reasons.push({ code: 'rooms_too_many', detail: `rooms ${row.rooms}` });
    }
  }

  if (!matched) {
    return { listingId: row.id, matched: false, score: 0, reasons };
  }

  reasons.push({ code: 'eligible', detail: 'hard constraints satisfied' });
  let score = 60;

  if (
    row.district &&
    request.district &&
    row.district.toLowerCase() === request.district.toLowerCase()
  ) {
    score += 15;
    reasons.push({ code: 'district_matched', detail: row.district });
  }
  if (price !== null) {
    if (request.priceMax !== null && price <= request.priceMax) {
      score += 10;
      reasons.push({ code: 'price_within_budget', detail: `price ${price}` });
    }
    if (request.priceMin !== null && price >= request.priceMin) {
      score += 5;
      reasons.push({ code: 'price_above_min', detail: `price ${price}` });
    }
  }
  if (
    row.rooms !== null &&
    (request.roomsMin !== null || request.roomsMax !== null)
  ) {
    const minOk = request.roomsMin === null || row.rooms >= request.roomsMin;
    const maxOk = request.roomsMax === null || row.rooms <= request.roomsMax;
    if (minOk && maxOk) {
      score += 10;
      reasons.push({ code: 'rooms_match', detail: `rooms ${row.rooms}` });
    }
  }
  const area = row.area === null ? null : Number(row.area);
  if (area !== null) {
    if (request.areaMin !== null && area >= request.areaMin) {
      score += 10;
      reasons.push({ code: 'area_above_min', detail: `area ${area}` });
    }
    if (request.areaMax !== null && area <= request.areaMax) {
      score += 5;
      reasons.push({ code: 'area_below_max', detail: `area ${area}` });
    }
  }
  if (
    row.floor !== null &&
    (request.floorMin !== null || request.floorMax !== null)
  ) {
    const minOk = request.floorMin === null || row.floor >= request.floorMin;
    const maxOk = request.floorMax === null || row.floor <= request.floorMax;
    if (minOk && maxOk) {
      score += 5;
      reasons.push({ code: 'floor_match', detail: `floor ${row.floor}` });
    }
  }
  if (request.renovation && row.renovation === request.renovation) {
    score += 10;
    reasons.push({ code: 'renovation_match', detail: request.renovation });
  }

  score = Math.max(0, Math.min(100, score));
  return { listingId: row.id, matched: true, score, reasons };
}

async function fetchCandidates(
  db: DatabaseConnection,
  request: ClientRequest,
): Promise<CandidateRow[]> {
  return db.transaction(async (tx: DatabaseTransaction) => {
    const result = await tx.query(
      `SELECT id, source, external_id, transaction_type, property_type, title,
              district, price_amount, currency, rooms, area, floor, renovation,
              seller_type, created_at
       FROM app.listings
       WHERE visibility = 'public' AND status = 'active'
         AND transaction_type = $1
       ORDER BY created_at DESC, id DESC`,
      [request.operation],
    );
    return result.rows as CandidateRow[];
  });
}

export async function matchRequest(
  db: DatabaseConnection,
  requestId: string,
  userId: string,
): Promise<{ request: ClientRequest; matches: MatchedListing[] }> {
  const request = await loadOwnedRequest(db, requestId, userId);
  const candidates = await fetchCandidates(db, request);

  const evaluated = candidates
    .map((row) => ({ row, result: evaluate(request, row) }))
    .filter((entry) => entry.result.matched)
    .sort((a, b) => {
      if (b.result.score !== a.result.score) {
        return b.result.score - a.result.score;
      }
      return (
        new Date(b.row.created_at).getTime() -
        new Date(a.row.created_at).getTime()
      );
    });

  const matches = evaluated.map((entry) =>
    toMatchedListing(entry.row, entry.result.score, entry.result.reasons),
  );

  await persistMatches(db, requestId, evaluated);

  return { request, matches };
}

async function loadOwnedRequest(
  db: DatabaseConnection,
  requestId: string,
  userId: string,
): Promise<ClientRequest> {
  const result = await db.transaction((tx: DatabaseTransaction) =>
    tx.query('SELECT * FROM app.client_requests WHERE id = $1', [requestId]),
  );
  if (result.rowCount === null || result.rowCount === 0) {
    throw new NotFoundError('request not found');
  }
  const row = result.rows[0] as {
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
  };
  if (row.user_id !== userId) {
    throw new NotFoundError('request not found');
  }
  return {
    id: row.id,
    userId: row.user_id,
    operation: row.operation,
    propertyType: row.property_type,
    district: row.district,
    priceMin: row.price_min === null ? null : Number(row.price_min),
    priceMax: row.price_max === null ? null : Number(row.price_max),
    roomsMin: row.rooms_min,
    roomsMax: row.rooms_max,
    areaMin: row.area_min === null ? null : Number(row.area_min),
    areaMax: row.area_max === null ? null : Number(row.area_max),
    floorMin: row.floor_min,
    floorMax: row.floor_max,
    renovation: row.renovation,
    freeText: null,
    status: 'active',
    createdAt: '',
    updatedAt: '',
  };
}

async function persistMatches(
  db: DatabaseConnection,
  requestId: string,
  evaluated: { row: CandidateRow; result: MatchResult }[],
): Promise<void> {
  await db.transaction(async (tx: DatabaseTransaction) => {
    await tx.query('DELETE FROM app.request_matches WHERE request_id = $1', [
      requestId,
    ]);
    for (const entry of evaluated) {
      await tx.query(
        `INSERT INTO app.request_matches (request_id, listing_id, score, reasons, algorithm_version)
         VALUES ($1, $2, $3, $4, 'v1')
         ON CONFLICT (request_id, listing_id)
         DO UPDATE SET score = EXCLUDED.score, reasons = EXCLUDED.reasons, updated_at = now()`,
        [
          requestId,
          entry.row.id,
          entry.result.score,
          JSON.stringify(entry.result.reasons),
        ],
      );
    }
  });
}

export async function matchListing(
  db: DatabaseConnection,
  listingId: string,
  userId: string,
): Promise<{ listingId: string; requests: ClientRequest[] }> {
  const listingResult = await db.transaction((tx: DatabaseTransaction) =>
    tx.query(
      `SELECT id, transaction_type, district, property_type, price_amount, currency,
              rooms, area, floor, renovation
       FROM app.listings WHERE id = $1 AND visibility = 'public' AND status = 'active'`,
      [listingId],
    ),
  );
  if (listingResult.rowCount === null || listingResult.rowCount === 0) {
    throw new NotFoundError('listing not found');
  }
  const lr = listingResult.rows[0] as {
    id: string;
    transaction_type: string;
    district: string | null;
    property_type: string | null;
    price_amount: string | null;
    currency: string;
    rooms: number | null;
    area: string | null;
    floor: number | null;
    renovation: string | null;
  };
  const price = lr.price_amount === null ? null : Number(lr.price_amount);
  const area = lr.area === null ? null : Number(lr.area);

  const requests = await db.transaction((tx: DatabaseTransaction) =>
    tx.query(
      `SELECT * FROM app.client_requests
       WHERE user_id = $1 AND status <> 'archived' AND operation = $2`,
      [userId, lr.transaction_type],
    ),
  );

  const matched: ClientRequest[] = [];
  for (const raw of requests.rows) {
    const req = toClientRequest(raw);
    let ok = true;
    if (
      req.district &&
      lr.district &&
      lr.district.toLowerCase() !== req.district.toLowerCase()
    ) {
      ok = false;
    }
    if (
      req.propertyType &&
      lr.property_type &&
      lr.property_type !== req.propertyType
    ) {
      ok = false;
    }
    if (price !== null) {
      if (req.priceMax !== null && price > req.priceMax) ok = false;
      if (req.priceMin !== null && price < req.priceMin) ok = false;
    }
    if (lr.rooms !== null) {
      if (req.roomsMin !== null && lr.rooms < req.roomsMin) ok = false;
      if (req.roomsMax !== null && lr.rooms > req.roomsMax) ok = false;
    }
    if (area !== null) {
      if (req.areaMin !== null && area < req.areaMin) ok = false;
      if (req.areaMax !== null && area > req.areaMax) ok = false;
    }
    if (ok) {
      matched.push(req);
    }
  }

  return { listingId, requests: matched };
}

function toClientRequest(raw: unknown): ClientRequest {
  const r = raw as {
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
  };
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
