import type { ColumnDefinitions, MigrationBuilder } from 'node-pg-migrate';

export const shorthands: ColumnDefinitions | undefined = undefined;

export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ikimetr_app') THEN
    CREATE ROLE ikimetr_app NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ikimetr_worker') THEN
    CREATE ROLE ikimetr_worker NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ikimetr_migrator') THEN
    CREATE ROLE ikimetr_migrator NOLOGIN;
  END IF;
END
$$;
`);

  pgm.sql(
    'ALTER ROLE ikimetr_app WITH NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION',
  );
  pgm.sql(
    'ALTER ROLE ikimetr_worker WITH NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION',
  );
  pgm.sql(
    'ALTER ROLE ikimetr_migrator WITH NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION',
  );

  pgm.createExtension('postgis', { ifNotExists: true });
  pgm.createExtension('pgcrypto', { ifNotExists: true });
  pgm.createExtension('citext', { ifNotExists: true });

  pgm.createSchema('app', {
    authorization: 'ikimetr_migrator',
    ifNotExists: true,
  });
  pgm.createSchema('audit', {
    authorization: 'ikimetr_migrator',
    ifNotExists: true,
  });
  pgm.createSchema('ingestion', {
    authorization: 'ikimetr_migrator',
    ifNotExists: true,
  });

  pgm.sql('ALTER SCHEMA migration OWNER TO ikimetr_migrator');
  pgm.sql('ALTER TABLE migration.pgmigrations OWNER TO ikimetr_migrator');
  pgm.sql('REVOKE CREATE ON SCHEMA public FROM PUBLIC');
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.dropSchema('ingestion', { ifExists: true });
  pgm.dropSchema('audit', { ifExists: true });
  pgm.dropSchema('app', { ifExists: true });
  pgm.dropExtension('citext', { ifExists: true });
  pgm.dropExtension('pgcrypto', { ifExists: true });
  pgm.dropExtension('postgis', { ifExists: true });
  pgm.sql('GRANT CREATE ON SCHEMA public TO PUBLIC');

  // Cluster-wide NOLOGIN roles intentionally survive local database rollback.
}
