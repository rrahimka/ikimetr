import type { MigrationBuilder } from 'node-pg-migrate';

export const shorthands = undefined;

export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`
    CREATE TABLE app.listings (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      source varchar(40) NOT NULL,
      external_id varchar(255) NULL,
      transaction_type varchar(20) NOT NULL DEFAULT 'sale',
      property_type varchar(40) NULL,
      status varchar(20) NOT NULL DEFAULT 'active',
      visibility varchar(20) NOT NULL DEFAULT 'public',
      seller_type varchar(20) NOT NULL DEFAULT 'unknown',
      district varchar(120) NULL,
      address varchar(400) NULL,
      latitude double precision NULL,
      longitude double precision NULL,
      price_amount bigint NULL,
      currency varchar(3) NOT NULL DEFAULT 'AZN',
      rooms smallint NULL,
      area numeric(10,2) NULL,
      floor smallint NULL,
      total_floors smallint NULL,
      renovation varchar(40) NULL,
      source_status varchar(20) NULL,
      freshness_status varchar(20) NOT NULL DEFAULT 'confirmed',
      first_seen_at timestamptz NOT NULL DEFAULT now(),
      last_seen_at timestamptz NOT NULL DEFAULT now(),
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX app_idx_listings_public ON app.listings (visibility, status, created_at DESC);
    CREATE INDEX app_idx_listings_transaction ON app.listings (transaction_type);
    CREATE INDEX app_idx_listings_district ON app.listings (district);
    CREATE INDEX app_idx_listings_price ON app.listings (price_amount);
    CREATE INDEX app_idx_listings_rooms ON app.listings (rooms);
    CREATE INDEX app_idx_listings_area ON app.listings (area);
    CREATE INDEX app_idx_listings_seller ON app.listings (seller_type);

    CREATE TABLE app.external_listings (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      listing_id uuid NOT NULL REFERENCES app.listings(id) ON DELETE CASCADE,
      source varchar(40) NOT NULL,
      external_id varchar(255) NOT NULL,
      source_url text NULL,
      seller_type varchar(20) NOT NULL DEFAULT 'unknown',
      phone_hash varchar(64) NULL,
      raw_payload jsonb NOT NULL,
      normalized_payload jsonb NOT NULL,
      source_status varchar(20) NULL,
      dedup_status varchar(20) NOT NULL DEFAULT 'new',
      dedup_listing_id uuid NULL REFERENCES app.listings(id) ON DELETE SET NULL,
      first_seen_at timestamptz NOT NULL DEFAULT now(),
      last_seen_at timestamptz NOT NULL DEFAULT now(),
      ingested_at timestamptz NOT NULL DEFAULT now(),
      evidence jsonb NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE (source, external_id)
    );
    CREATE INDEX app_idx_ext_listing_phone ON app.external_listings (phone_hash);
    CREATE INDEX app_idx_ext_listing_listing ON app.external_listings (listing_id);
    CREATE INDEX app_idx_ext_listing_url ON app.external_listings (source_url);
  `);
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`
    DROP TABLE IF EXISTS app.external_listings;
    DROP TABLE IF EXISTS app.listings;
  `);
}
