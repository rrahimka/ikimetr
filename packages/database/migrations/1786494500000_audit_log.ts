import type { MigrationBuilder } from 'node-pg-migrate';

export const shorthands = undefined;

export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`
    CREATE TABLE audit.audit_log (
      id bigserial PRIMARY KEY,
      actor_user_id uuid NULL,
      actor_type varchar(40) NOT NULL DEFAULT 'user',
      action varchar(80) NOT NULL,
      target_type varchar(80) NOT NULL,
      target_id varchar(120) NULL,
      metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
      created_at timestamptz NOT NULL DEFAULT now()
    );

    CREATE INDEX audit_idx_audit_action_time ON audit.audit_log (action, created_at DESC);
    CREATE INDEX audit_idx_audit_target ON audit.audit_log (target_type, target_id);
  `);
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`DROP TABLE IF EXISTS audit.audit_log;`);
}
