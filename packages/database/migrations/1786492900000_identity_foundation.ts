import type { MigrationBuilder } from 'node-pg-migrate';

export const shorthands = undefined;

export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`
    CREATE TABLE app.users (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      status varchar(20) NOT NULL DEFAULT 'active',
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );

    CREATE TABLE app.auth_identities (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id uuid NOT NULL REFERENCES app.users(id) ON DELETE CASCADE,
      provider varchar(40) NOT NULL DEFAULT 'email',
      email varchar(320) NOT NULL,
      email_normalized varchar(320) NOT NULL,
      password_hash varchar(200) NULL,
      verified boolean NOT NULL DEFAULT false,
      created_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE (email_normalized, provider)
    );

    CREATE TABLE app.sessions (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id uuid NOT NULL REFERENCES app.users(id) ON DELETE CASCADE,
      token_hash varchar(64) NOT NULL,
      expires_at timestamptz NOT NULL,
      revoked_at timestamptz NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      ip_address varchar(64) NULL,
      user_agent varchar(400) NULL
    );
    CREATE INDEX app_idx_sessions_token_hash ON app.sessions (token_hash);

    CREATE TABLE app.profiles (
      user_id uuid PRIMARY KEY REFERENCES app.users(id) ON DELETE CASCADE,
      display_name varchar(120) NOT NULL DEFAULT '',
      avatar_url varchar(512) NULL,
      phone varchar(40) NULL,
      phone_visible boolean NOT NULL DEFAULT false,
      language varchar(8) NOT NULL DEFAULT 'az',
      locale varchar(8) NOT NULL DEFAULT 'az',
      bio varchar(1000) NULL,
      updated_at timestamptz NOT NULL DEFAULT now()
    );
  `);
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`
    DROP TABLE IF EXISTS app.profiles;
    DROP TABLE IF EXISTS app.sessions;
    DROP TABLE IF EXISTS app.auth_identities;
    DROP TABLE IF EXISTS app.users;
  `);
}
