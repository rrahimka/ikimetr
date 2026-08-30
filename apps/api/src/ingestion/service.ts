import type {
  DatabaseConnection,
  DatabaseTransaction,
} from '@ikimetr/database';

import {
  canonicalizeUrl,
  normalizePhone,
  normalizePrice,
  normalizeText,
} from './normalization.js';
import type { IngestionPayload } from './contract.js';

export type IngestionAction = 'created' | 'linked' | 'updated';

export interface IngestionResult {
  externalListingId: string;
  listingId: string;
  action: IngestionAction;
  dedupStatus: 'new' | 'duplicate' | 'merged';
}

interface ListingInput {
  source: string;
  externalId: string;
  url: string;
  sellerType: string;
  transactionType: string;
  propertyType: string | null;
  title: string | null;
  description: string | null;
  priceAmount: number | null;
  currency: string;
  district: string | null;
  address: string | null;
  rooms: number | null;
  area: number | null;
  floor: number | null;
  totalFloors: number | null;
  renovation: string | null;
  latitude: number | null;
  longitude: number | null;
  sourceStatus: string | null;
  phoneHash: string | null;
  normalizedPayload: unknown;
  rawPayload: unknown;
  evidence: unknown;
}

const LISTING_COLUMNS = [
  'source',
  'external_id',
  'transaction_type',
  'property_type',
  'title',
  'description',
  'status',
  'visibility',
  'seller_type',
  'district',
  'address',
  'latitude',
  'longitude',
  'price_amount',
  'currency',
  'rooms',
  'area',
  'floor',
  'total_floors',
  'renovation',
  'source_status',
  'freshness_status',
  'first_seen_at',
  'last_seen_at',
];

function buildListingInput(payload: IngestionPayload): ListingInput {
  const p = payload.payload;
  const price = normalizePrice(p.price?.amount, p.price?.currency);
  const phone = normalizePhone(p.contact?.phone);

  const normalizedPayload: Record<string, unknown> = {
    operation: p.operation ?? 'sale',
    propertyType: p.propertyType ?? null,
    title: normalizeText(p.title),
    description: normalizeText(p.description),
    price:
      price.amount === null
        ? null
        : { amount: price.amount, currency: price.currency },
    district: normalizeText(p.district),
    address: normalizeText(p.address),
    rooms: p.rooms ?? null,
    area: p.area ?? null,
    floor: p.floor ?? null,
    totalFloors: p.totalFloors ?? null,
    renovation: p.renovation ?? null,
    latitude: p.latitude ?? null,
    longitude: p.longitude ?? null,
    images: p.images ?? null,
    sourceStatus: p.sourceStatus ?? null,
  };
  if (p.contact?.name) {
    normalizedPayload.contact = { name: p.contact.name };
  }

  const rawPayload = structuredClone(payload) as Record<string, unknown>;
  const rawInner = (rawPayload.payload ?? {}) as Record<string, unknown>;
  if (rawInner.contact && typeof rawInner.contact === 'object') {
    const contact = { ...(rawInner.contact as Record<string, unknown>) };
    delete contact.phone;
    rawInner.contact = contact;
  }

  return {
    source: payload.source,
    externalId: payload.externalId,
    url: canonicalizeUrl(payload.url) ?? payload.url,
    sellerType: payload.sellerType,
    transactionType: p.operation ?? 'sale',
    propertyType: p.propertyType ?? null,
    title: normalizeText(p.title),
    description: normalizeText(p.description),
    priceAmount: price.amount,
    currency: price.currency,
    district: normalizeText(p.district),
    address: normalizeText(p.address),
    rooms: p.rooms ?? null,
    area: p.area ?? null,
    floor: p.floor ?? null,
    totalFloors: p.totalFloors ?? null,
    renovation: p.renovation ?? null,
    latitude: p.latitude ?? null,
    longitude: p.longitude ?? null,
    sourceStatus: p.sourceStatus ?? null,
    phoneHash: phone.hash,
    normalizedPayload,
    rawPayload,
    evidence: p.evidence ?? null,
  };
}

interface CanonicalCandidate {
  listingId: string;
  dedupStatus: 'duplicate' | 'merged';
}

async function findCanonicalListing(
  tx: DatabaseTransaction,
  input: ListingInput,
): Promise<CanonicalCandidate | null> {
  if (input.url) {
    const byUrl = await tx.query<{ listing_id: string }>(
      'SELECT listing_id FROM app.external_listings WHERE source_url = $1 LIMIT 1',
      [input.url],
    );
    const urlRow = byUrl.rows[0];
    if (urlRow && urlRow.listing_id) {
      return { listingId: urlRow.listing_id, dedupStatus: 'duplicate' };
    }
  }

  if (input.phoneHash) {
    const byPhone = await tx.query<{
      listing_id: string;
      district: string | null;
      price_amount: string | null;
      rooms: number | null;
      area: string | null;
      floor: number | null;
    }>(
      `SELECT e.listing_id, l.district, l.price_amount, l.rooms, l.area, l.floor
       FROM app.external_listings e
       JOIN app.listings l ON l.id = e.listing_id
       WHERE e.phone_hash = $1`,
      [input.phoneHash],
    );
    for (const row of byPhone.rows) {
      if (
        row.listing_id &&
        row.district === input.district &&
        Number(row.price_amount ?? '') === Number(input.priceAmount ?? '') &&
        Number(row.rooms ?? '') === Number(input.rooms ?? '') &&
        Number(row.area ?? '') === Number(input.area ?? '') &&
        Number(row.floor ?? '') === Number(input.floor ?? '')
      ) {
        return { listingId: row.listing_id, dedupStatus: 'merged' };
      }
    }
  }

  return null;
}

async function createListing(
  tx: DatabaseTransaction,
  input: ListingInput,
): Promise<string> {
  const values = [
    input.source,
    input.externalId,
    input.transactionType,
    input.propertyType,
    input.title,
    input.description,
    'active',
    'public',
    input.sellerType,
    input.district,
    input.address,
    input.latitude,
    input.longitude,
    input.priceAmount,
    input.currency,
    input.rooms,
    input.area,
    input.floor,
    input.totalFloors,
    input.renovation,
    input.sourceStatus,
    'confirmed',
    new Date(),
    new Date(),
  ];
  const result = await tx.query<{ id: string }>(
    `INSERT INTO app.listings (${LISTING_COLUMNS.join(', ')})
     VALUES (${LISTING_COLUMNS.map((_, i) => `$${i + 1}`).join(', ')})
     RETURNING id`,
    values,
  );
  const row = result.rows[0];
  if (!row) {
    throw new Error('failed to create listing');
  }
  return row.id;
}

async function insertExternalListing(
  tx: DatabaseTransaction,
  listingId: string,
  input: ListingInput,
  dedupStatus: 'new' | 'duplicate' | 'merged',
): Promise<{ id: string; listingId: string; inserted: boolean }> {
  const result = await tx.query<{
    id: string;
    listing_id: string;
    inserted: boolean;
  }>(
    `INSERT INTO app.external_listings (
       listing_id, source, external_id, source_url, seller_type, phone_hash,
       raw_payload, normalized_payload, source_status, dedup_status,
       first_seen_at, last_seen_at, ingested_at, evidence
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,now(),now(),now(),$11)
     ON CONFLICT (source, external_id) DO UPDATE SET
       source_url = EXCLUDED.source_url,
       seller_type = EXCLUDED.seller_type,
       phone_hash = EXCLUDED.phone_hash,
       raw_payload = EXCLUDED.raw_payload,
       normalized_payload = EXCLUDED.normalized_payload,
       source_status = EXCLUDED.source_status,
       dedup_status = EXCLUDED.dedup_status,
       last_seen_at = now(),
       ingested_at = now()
     RETURNING id, listing_id, (xmax = 0) AS inserted`,
    [
      listingId,
      input.source,
      input.externalId,
      input.url,
      input.sellerType,
      input.phoneHash,
      JSON.stringify(input.rawPayload),
      JSON.stringify(input.normalizedPayload),
      input.sourceStatus,
      dedupStatus,
      JSON.stringify(input.evidence ?? null),
    ],
  );
  const row = result.rows[0];
  if (!row) {
    throw new Error('failed to create external listing');
  }
  return {
    id: row.id,
    listingId: row.listing_id,
    inserted: row.inserted,
  };
}

async function getExternalListing(
  tx: DatabaseTransaction,
  source: string,
  externalId: string,
): Promise<{ id: string; listing_id: string; dedup_status: string } | null> {
  const result = await tx.query<{
    id: string;
    listing_id: string;
    dedup_status: string;
  }>(
    'SELECT id, listing_id, dedup_status FROM app.external_listings WHERE source = $1 AND external_id = $2',
    [source, externalId],
  );
  if (result.rowCount === null || result.rowCount === 0) {
    return null;
  }
  return result.rows[0] ?? null;
}

async function updateExternalListing(
  tx: DatabaseTransaction,
  externalId: string,
  input: ListingInput,
): Promise<void> {
  await tx.query(
    `UPDATE app.external_listings
     SET source_url = $1, seller_type = $2, phone_hash = $3,
         raw_payload = $4, normalized_payload = $5, source_status = $6,
         last_seen_at = now(), ingested_at = now()
     WHERE id = $7`,
    [
      input.url,
      input.sellerType,
      input.phoneHash,
      JSON.stringify(input.rawPayload),
      JSON.stringify(input.normalizedPayload),
      input.sourceStatus,
      externalId,
    ],
  );
}

async function refreshListing(
  tx: DatabaseTransaction,
  listingId: string,
  input: ListingInput,
): Promise<void> {
  await tx.query(
    `UPDATE app.listings
     SET title = $1, description = $2, price_amount = $3, currency = $4,
         district = $5, address = $6, rooms = $7, area = $8, floor = $9,
         total_floors = $10, renovation = $11, source_status = $12,
         last_seen_at = now(), updated_at = now()
     WHERE id = $13`,
    [
      input.title,
      input.description,
      input.priceAmount,
      input.currency,
      input.district,
      input.address,
      input.rooms,
      input.area,
      input.floor,
      input.totalFloors,
      input.renovation,
      input.sourceStatus,
      listingId,
    ],
  );
}

export async function ingestListing(
  db: DatabaseConnection,
  payload: IngestionPayload,
): Promise<IngestionResult> {
  const input = buildListingInput(payload);

  return db.transaction(async (tx) => {
    const candidate = await findCanonicalListing(tx, input);
    const linked = candidate !== null;

    let listingId: string;
    let createdNewListing = false;
    if (candidate) {
      listingId = candidate.listingId;
    } else {
      listingId = await createListing(tx, input);
      createdNewListing = true;
    }

    const existingExternal = await getExternalListing(
      tx,
      input.source,
      input.externalId,
    );
    let externalListingId: string;
    let action: IngestionAction;
    let isDuplicate = false;
    if (existingExternal) {
      externalListingId = existingExternal.id;
      await updateExternalListing(tx, existingExternal.id, input);
      action = 'updated';
      isDuplicate = true;
    } else {
      const created = await insertExternalListing(
        tx,
        listingId,
        input,
        candidate ? candidate.dedupStatus : 'new',
      );
      externalListingId = created.id;
      if (created.inserted) {
        action = createdNewListing ? 'created' : 'linked';
      } else {
        if (createdNewListing && created.listingId !== listingId) {
          await tx.query('DELETE FROM app.listings WHERE id = $1', [listingId]);
        }
        listingId = created.listingId;
        await updateExternalListing(tx, created.id, input);
        action = 'updated';
        isDuplicate = true;
      }
    }

    if (action !== 'created') {
      await refreshListing(tx, listingId, input);
    }
    await tx.query(
      'UPDATE app.listings SET last_seen_at = now(), updated_at = now() WHERE id = $1',
      [listingId],
    );

    const dedupStatus: 'new' | 'duplicate' | 'merged' = linked
      ? isDuplicate
        ? 'duplicate'
        : 'merged'
      : 'new';

    return { externalListingId, listingId, action, dedupStatus };
  });
}
