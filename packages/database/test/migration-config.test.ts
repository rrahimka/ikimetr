import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { assertLocalMigrationEnvironment } from '../migration/assert-local.js';

interface PackageManifest {
  devDependencies?: Record<string, string>;
  scripts?: Record<string, string>;
}

const repositoryRoot = fileURLToPath(new URL('../../../', import.meta.url));
const databaseRoot = resolve(repositoryRoot, 'packages/database');

async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, 'utf8')) as T;
}

describe('database migration command contract', () => {
  it('pins the approved migration engine and exposes root entrypoints', async () => {
    const rootPackage = await readJson<PackageManifest>(
      resolve(repositoryRoot, 'package.json'),
    );
    const databasePackage = await readJson<PackageManifest>(
      resolve(databaseRoot, 'package.json'),
    );

    expect(databasePackage.devDependencies?.['node-pg-migrate']).toBe('9.0.0');
    expect(rootPackage.scripts).toMatchObject({
      'db:migrate:create': 'pnpm --filter @ikimetr/database db:migrate:create',
      'db:migrate:down:local':
        'pnpm --filter @ikimetr/database db:migrate:down:local',
      'db:migrate:up': 'pnpm --filter @ikimetr/database db:migrate:up',
      'db:migrate:verify': 'pnpm --filter @ikimetr/database db:migrate:verify',
    });
  });

  it('keeps locking, transaction, and one-step local down fail closed', async () => {
    const databasePackage = await readJson<PackageManifest>(
      resolve(databaseRoot, 'package.json'),
    );
    const up = databasePackage.scripts?.['db:migrate:up'];
    const down = databasePackage.scripts?.['db:migrate:down:local'];

    expect(up).toContain(
      '--single-transaction --lock --advisory-lock-mode fail',
    );
    expect(down).toContain('down 1');
    expect(down).toContain(
      '--single-transaction --lock --advisory-lock-mode fail',
    );

    for (const script of [up, down]) {
      expect(script).not.toContain('--fake');
      expect(script).not.toContain('--no-lock');
      expect(script).not.toContain('DATABASE_URL=');
      expect(script).not.toMatch(/postgres(?:ql)?:\/\//u);
    }
  });

  it('runs TypeScript guards without the tsx IPC server', async () => {
    const databasePackage = await readJson<PackageManifest>(
      resolve(databaseRoot, 'package.json'),
    );

    expect(databasePackage.scripts?.['db:migrate:verify']).toBe(
      'node --import tsx migration/verify-manifest.ts',
    );
    expect(databasePackage.scripts?.['db:migrate:down:local']).toMatch(
      /^node --import tsx migration\/assert-local\.ts/u,
    );
  });

  it('uses the approved static migration configuration', async () => {
    const config = await readJson<unknown>(
      resolve(databaseRoot, 'migration.config.json'),
    );

    expect(config).toEqual({
      dir: 'migrations',
      'migrations-schema': 'migration',
      'create-migrations-schema': true,
      'migrations-table': 'pgmigrations',
      'migration-file-language': 'ts',
      'migration-filename-format': 'timestamp',
      'check-order': true,
      'ignore-pattern': 'manifest\\.json',
      verbose: false,
      'advisory-lock-mode': 'fail',
    });
  });

  it('rejects production rollback before migration execution', () => {
    expect(() =>
      assertLocalMigrationEnvironment({
        NODE_ENV: 'production',
      } as NodeJS.ProcessEnv),
    ).toThrow('Production migration rollback is disabled');
    expect(() =>
      assertLocalMigrationEnvironment({
        NODE_ENV: 'test',
      } as NodeJS.ProcessEnv),
    ).not.toThrow();
  });
});
