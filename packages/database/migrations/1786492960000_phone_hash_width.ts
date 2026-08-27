import type { MigrationBuilder } from 'node-pg-migrate';

export const shorthands = undefined;

export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(
    'ALTER TABLE app.external_listings ALTER COLUMN phone_hash TYPE varchar(80);',
  );
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(
    'ALTER TABLE app.external_listings ALTER COLUMN phone_hash TYPE varchar(64);',
  );
}
