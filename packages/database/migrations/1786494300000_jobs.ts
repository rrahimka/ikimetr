import type { MigrationBuilder } from 'node-pg-migrate';

export const shorthands = undefined;

export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`
    CREATE TABLE app.jobs (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      type varchar(60) NOT NULL,
      payload jsonb NOT NULL DEFAULT '{}'::jsonb,
      idempotency_key varchar(120) NULL UNIQUE,
      status varchar(20) NOT NULL DEFAULT 'queued',
      attempts integer NOT NULL DEFAULT 0,
      max_attempts integer NOT NULL DEFAULT 5,
      last_error text NULL,
      scheduled_at timestamptz NOT NULL DEFAULT now(),
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );

    CREATE INDEX app_idx_jobs_status ON app.jobs (status, scheduled_at);
  `);
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`DROP TABLE IF EXISTS app.jobs;`);
}
