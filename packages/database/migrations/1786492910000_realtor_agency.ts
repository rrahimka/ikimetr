import type { MigrationBuilder } from 'node-pg-migrate';

export const shorthands = undefined;

export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`
    CREATE TABLE app.agencies (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      name varchar(160) NOT NULL,
      slug varchar(160) NOT NULL UNIQUE,
      description varchar(2000) NULL,
      owner_user_id uuid NOT NULL REFERENCES app.users(id) ON DELETE RESTRICT,
      status varchar(20) NOT NULL DEFAULT 'active',
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );

    CREATE TABLE app.realtor_profiles (
      user_id uuid PRIMARY KEY REFERENCES app.users(id) ON DELETE CASCADE,
      status varchar(20) NOT NULL DEFAULT 'pending',
      public_name varchar(160) NOT NULL DEFAULT '',
      bio varchar(2000) NULL,
      specialization varchar(80) NULL,
      service_areas text[] NOT NULL DEFAULT '{}',
      languages text[] NOT NULL DEFAULT '{}',
      agency_id uuid NULL REFERENCES app.agencies(id) ON DELETE SET NULL,
      verification_status varchar(20) NOT NULL DEFAULT 'unverified',
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );

    CREATE TABLE app.agency_memberships (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      agency_id uuid NOT NULL REFERENCES app.agencies(id) ON DELETE CASCADE,
      user_id uuid NOT NULL REFERENCES app.users(id) ON DELETE CASCADE,
      role varchar(20) NOT NULL,
      status varchar(20) NOT NULL DEFAULT 'active',
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE (agency_id, user_id)
    );
    CREATE INDEX app_idx_memberships_user ON app.agency_memberships (user_id);
  `);
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`
    DROP TABLE IF EXISTS app.agency_memberships;
    DROP TABLE IF EXISTS app.realtor_profiles;
    DROP TABLE IF EXISTS app.agencies;
  `);
}
