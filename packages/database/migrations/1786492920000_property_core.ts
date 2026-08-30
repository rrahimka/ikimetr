import type { MigrationBuilder } from 'node-pg-migrate';

export const shorthands = undefined;

export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`
    CREATE TABLE app.properties (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      owner_user_id uuid NOT NULL REFERENCES app.users(id) ON DELETE CASCADE,
      agency_id uuid NULL REFERENCES app.agencies(id) ON DELETE SET NULL,
      transaction_type varchar(20) NOT NULL DEFAULT 'sale',
      status varchar(20) NOT NULL DEFAULT 'draft',
      title varchar(200) NOT NULL DEFAULT '',
      description text NULL,
      price_amount bigint NULL,
      currency varchar(3) NOT NULL DEFAULT 'AZN',
      district varchar(120) NULL,
      address varchar(400) NULL,
      latitude double precision NULL,
      longitude double precision NULL,
      rooms smallint NULL,
      area numeric(10,2) NULL,
      floor smallint NULL,
      total_floors smallint NULL,
      renovation varchar(40) NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX app_idx_properties_owner ON app.properties (owner_user_id);
    CREATE INDEX app_idx_properties_agency ON app.properties (agency_id);

    CREATE TABLE app.property_status_history (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      property_id uuid NOT NULL REFERENCES app.properties(id) ON DELETE CASCADE,
      status varchar(20) NOT NULL,
      changed_by_user_id uuid NOT NULL REFERENCES app.users(id) ON DELETE RESTRICT,
      changed_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX app_idx_status_history_property ON app.property_status_history (property_id);

    CREATE TABLE app.property_images (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      property_id uuid NOT NULL REFERENCES app.properties(id) ON DELETE CASCADE,
      url varchar(1024) NOT NULL,
      ordering integer NOT NULL DEFAULT 0,
      is_primary boolean NOT NULL DEFAULT false,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX app_idx_property_images_property ON app.property_images (property_id);
  `);
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`
    DROP TABLE IF EXISTS app.property_images;
    DROP TABLE IF EXISTS app.property_status_history;
    DROP TABLE IF EXISTS app.properties;
  `);
}
