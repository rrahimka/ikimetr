import type { MigrationBuilder } from 'node-pg-migrate';

export const shorthands = undefined;

export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`
    ALTER TABLE app.listings
    ADD COLUMN title varchar(200) NULL,
    ADD COLUMN description text NULL;
  `);
  pgm.sql(
    `CREATE INDEX IF NOT EXISTS idx_listings_title ON app.listings (title);`,
  );
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`
    ALTER TABLE app.listings
    DROP COLUMN IF EXISTS title,
    DROP COLUMN IF EXISTS description;
  `);
}
