import type { MigrationBuilder } from 'node-pg-migrate';

export const shorthands = undefined;

export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`
    CREATE TABLE app.client_requests (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id uuid NOT NULL REFERENCES app.users(id) ON DELETE CASCADE,
      operation varchar(20) NOT NULL,
      property_type varchar(40) NULL,
      district varchar(120) NULL,
      price_min bigint NULL,
      price_max bigint NULL,
      rooms_min smallint NULL,
      rooms_max smallint NULL,
      area_min numeric(10,2) NULL,
      area_max numeric(10,2) NULL,
      floor_min smallint NULL,
      floor_max smallint NULL,
      renovation varchar(40) NULL,
      free_text text NULL,
      status varchar(20) NOT NULL DEFAULT 'active',
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX app_idx_requests_user ON app.client_requests (user_id);

    CREATE TABLE app.request_matches (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      request_id uuid NOT NULL REFERENCES app.client_requests(id) ON DELETE CASCADE,
      listing_id uuid NOT NULL REFERENCES app.listings(id) ON DELETE CASCADE,
      score numeric(6,3) NOT NULL DEFAULT 0,
      reasons jsonb NOT NULL DEFAULT '[]'::jsonb,
      algorithm_version varchar(20) NOT NULL DEFAULT 'v1',
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE (request_id, listing_id)
    );
    CREATE INDEX app_idx_request_matches_request ON app.request_matches (request_id);
  `);
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`
    DROP TABLE IF EXISTS app.request_matches;
    DROP TABLE IF EXISTS app.client_requests;
  `);
}
