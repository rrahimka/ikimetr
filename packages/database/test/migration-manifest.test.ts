import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { verifyMigrationManifest } from '../migration/verify-manifest.js';

const firstPath = 'packages/database/migrations/1786492800000_first.ts';
const secondPath = 'packages/database/migrations/1786492800001_second.ts';
const firstContent = 'export const up = 1;\n';
const secondContent = 'export const up = 2;\n';
const firstHash =
  '1a19a1334b357b3fddc87e45ed7b556f3edde41c1b91f3959b87d33228cee31c';
const secondHash =
  'c13ffd1e77e996b9c9a163d68d321d3623c55d1bc1d6e68a01aec3eda0492fa6';

let repositoryRoot: string;
let migrationDirectory: string;
let manifestPath: string;

beforeEach(async () => {
  repositoryRoot = await mkdtemp(join(tmpdir(), 'ikimetr-manifest-'));
  migrationDirectory = resolve(repositoryRoot, 'packages/database/migrations');
  manifestPath = resolve(migrationDirectory, 'manifest.json');
  await mkdir(migrationDirectory, { recursive: true });
});

afterEach(async () => {
  await rm(repositoryRoot, { force: true, recursive: true });
});

async function writeMigration(path: string, content: string): Promise<void> {
  const absolutePath = resolve(repositoryRoot, path);
  await mkdir(resolve(absolutePath, '..'), { recursive: true });
  await writeFile(absolutePath, content, 'utf8');
}

async function writeManifest(
  migrations: Array<{ path: string; sha256: string }>,
): Promise<void> {
  await writeFile(
    manifestPath,
    `${JSON.stringify({ version: 1, migrations }, null, 2)}\n`,
    'utf8',
  );
}

function verify(): Promise<readonly string[]> {
  return verifyMigrationManifest({
    repositoryRoot,
    migrationDirectory,
    manifestPath,
  });
}

describe('migration manifest verification', () => {
  it('accepts exact bytes and returns stable lexical path ordering', async () => {
    await writeMigration(secondPath, secondContent);
    await writeMigration(firstPath, firstContent);
    await writeManifest([
      { path: secondPath, sha256: secondHash },
      { path: firstPath, sha256: firstHash },
    ]);

    await expect(verify()).resolves.toEqual([firstPath, secondPath]);
  });

  it('rejects a migration file missing from the manifest', async () => {
    await writeMigration(firstPath, firstContent);
    await writeManifest([]);

    await expect(verify()).rejects.toThrow(
      `Migration file missing from manifest: ${firstPath}`,
    );
  });

  it('rejects a manifest entry without a migration file', async () => {
    await writeManifest([{ path: firstPath, sha256: firstHash }]);

    await expect(verify()).rejects.toThrow(
      `Manifest entry has no migration file: ${firstPath}`,
    );
  });

  it('rejects a hash mismatch without exposing bytes or hashes', async () => {
    const sentinel = 'SECRET_MIGRATION_SENTINEL';
    await writeMigration(firstPath, sentinel);
    await writeManifest([{ path: firstPath, sha256: secondHash }]);

    const error = await verify().catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain(
      `Migration hash mismatch: ${firstPath}`,
    );
    expect((error as Error).message).not.toContain(sentinel);
    expect((error as Error).message).not.toContain(firstHash);
    expect((error as Error).message).not.toContain(secondHash);
  });

  it('rejects duplicate normalized paths', async () => {
    await writeMigration(firstPath, firstContent);
    await writeManifest([
      { path: firstPath, sha256: firstHash },
      { path: firstPath, sha256: firstHash },
    ]);

    await expect(verify()).rejects.toThrow(
      `Duplicate migration path: ${firstPath}`,
    );
  });

  it.each([
    '/tmp/absolute.ts',
    'packages/database/migrations/../escape.ts',
    'packages\\database\\migrations\\1786492800000_escape.ts',
  ])('rejects unsafe or non-normalized path %s', async (unsafePath) => {
    await writeManifest([{ path: unsafePath, sha256: firstHash }]);

    await expect(verify()).rejects.toThrow('Invalid migration path');
  });

  it('rejects malformed JSON with a stable content-free error', async () => {
    await writeFile(manifestPath, '{not-json', 'utf8');

    await expect(verify()).rejects.toThrow(
      'Migration manifest is invalid JSON',
    );
  });

  it('rejects a malformed manifest shape', async () => {
    await writeFile(
      manifestPath,
      JSON.stringify({ version: 2, migrations: 'invalid' }),
      'utf8',
    );

    await expect(verify()).rejects.toThrow(
      'Migration manifest has an invalid shape',
    );
  });

  it('rejects invalid SHA-256 syntax before reading a migration', async () => {
    await writeMigration(firstPath, firstContent);
    await writeManifest([{ path: firstPath, sha256: 'ABC123' }]);

    await expect(verify()).rejects.toThrow(
      `Invalid SHA-256 for migration: ${firstPath}`,
    );
  });

  it('sorts all reported violations deterministically', async () => {
    await writeMigration(secondPath, secondContent);
    await writeMigration(firstPath, firstContent);
    await writeManifest([]);

    await expect(verify()).rejects.toThrow(
      [
        'Migration manifest verification failed:',
        `- Migration file missing from manifest: ${firstPath}`,
        `- Migration file missing from manifest: ${secondPath}`,
      ].join('\n'),
    );
  });

  it('rejects non-UTF-8 migration bytes without exposing them', async () => {
    await writeFile(
      resolve(repositoryRoot, firstPath),
      Buffer.from([0xff, 0xfe]),
    );
    await writeManifest([{ path: firstPath, sha256: firstHash }]);

    await expect(verify()).rejects.toThrow(
      `Migration is not valid UTF-8: ${firstPath}`,
    );
  });
});
