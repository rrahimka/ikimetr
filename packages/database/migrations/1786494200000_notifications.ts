import type { MigrationBuilder } from 'node-pg-migrate';

export const shorthands = undefined;

export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`
    CREATE TABLE app.notifications (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id uuid NOT NULL REFERENCES app.users(id) ON DELETE CASCADE,
      type varchar(40) NOT NULL,
      reference_type varchar(40) NULL,
      reference_id uuid NULL,
      title varchar(200) NULL,
      body text NULL,
      payload jsonb NOT NULL DEFAULT '{}'::jsonb,
      idempotency_key varchar(120) NULL UNIQUE,
      read boolean NOT NULL DEFAULT false,
      visible_after timestamptz NOT NULL DEFAULT now(),
      created_at timestamptz NOT NULL DEFAULT now()
    );

    CREATE INDEX app_idx_notif_user ON app.notifications (user_id, created_at DESC, id DESC);

    CREATE TABLE app.notification_preferences (
      user_id uuid PRIMARY KEY REFERENCES app.users(id) ON DELETE CASCADE,
      disabled_types jsonb NOT NULL DEFAULT '[]'::jsonb,
      dnd_enabled boolean NOT NULL DEFAULT true,
      dnd_start time NOT NULL DEFAULT '23:00',
      dnd_end time NOT NULL DEFAULT '07:00',
      updated_at timestamptz NOT NULL DEFAULT now()
    );
  `);
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`
    DROP TABLE IF EXISTS app.notification_preferences;
    DROP TABLE IF EXISTS app.notifications;
  `);
}
