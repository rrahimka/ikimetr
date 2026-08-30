import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { dirname, isAbsolute, posix, relative, resolve, sep } from 'node:path';
import { TextDecoder } from 'node:util';
import { fileURLToPath, pathToFileURL } from 'node:url';

export interface VerifyMigrationManifestOptions {
  repositoryRoot: string;
  migrationDirectory: string;
  manifestPath: string;
}

interface MigrationManifestEntry {
  path: string;
  sha256: string;
}

interface MigrationManifest {
  version: 1;
  migrations: MigrationManifestEntry[];
}

const sha256Pattern = /^[a-f0-9]{64}$/u;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasExactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
): boolean {
  const actual = Object.keys(value).sort((left, right) =>
    left.localeCompare(right),
  );
  const sortedExpected = [...expected].sort((left, right) =>
    left.localeCompare(right),
  );
  return (
    actual.length === sortedExpected.length &&
    actual.every((key, index) => key === sortedExpected[index])
  );
}

function parseManifest(content: string): MigrationManifest {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content) as unknown;
  } catch {
    throw new Error('Migration manifest is invalid JSON');
  }

  if (
    !isRecord(parsed) ||
    !hasExactKeys(parsed, ['version', 'migrations']) ||
    parsed['version'] !== 1 ||
    !Array.isArray(parsed['migrations']) ||
    !parsed['migrations'].every(
      (entry) =>
        isRecord(entry) &&
        hasExactKeys(entry, ['path', 'sha256']) &&
        typeof entry['path'] === 'string' &&
        typeof entry['sha256'] === 'string',
    )
  ) {
    throw new Error('Migration manifest has an invalid shape');
  }

  return parsed as unknown as MigrationManifest;
}

function toPosixPath(path: string): string {
  return path.split(sep).join('/');
}

function isSafeMigrationPath(
  path: string,
  repositoryRoot: string,
  migrationDirectory: string,
): boolean {
  if (
    path.length === 0 ||
    path.includes('\\') ||
    isAbsolute(path) ||
    posix.isAbsolute(path) ||
    posix.normalize(path) !== path
  ) {
    return false;
  }

  const migrationDirectoryPath = toPosixPath(
    relative(repositoryRoot, migrationDirectory),
  );
  if (
    migrationDirectoryPath.length === 0 ||
    migrationDirectoryPath === '..' ||
    migrationDirectoryPath.startsWith('../')
  ) {
    return false;
  }

  const expectedPrefix = `${migrationDirectoryPath}/`;
  if (!path.startsWith(expectedPrefix)) {
    return false;
  }

  const absolutePath = resolve(repositoryRoot, path);
  const relativeToMigrations = relative(migrationDirectory, absolutePath);
  return (
    relativeToMigrations.length > 0 &&
    relativeToMigrations !== '..' &&
    !relativeToMigrations.startsWith(`..${sep}`) &&
    !isAbsolute(relativeToMigrations)
  );
}

function formatVerificationError(errors: string[]): Error {
  return new Error(
    `Migration manifest verification failed:\n${errors
      .sort((left, right) => left.localeCompare(right))
      .map((error) => `- ${error}`)
      .join('\n')}`,
  );
}

export async function verifyMigrationManifest(
  options: VerifyMigrationManifestOptions,
): Promise<readonly string[]> {
  const repositoryRoot = resolve(options.repositoryRoot);
  const migrationDirectory = resolve(options.migrationDirectory);
  const manifestPath = resolve(options.manifestPath);

  let manifestContent: string;
  try {
    manifestContent = await readFile(manifestPath, 'utf8');
  } catch {
    throw new Error('Migration manifest could not be read');
  }
  const manifest = parseManifest(manifestContent);

  let directoryEntries;
  try {
    directoryEntries = await readdir(migrationDirectory, {
      withFileTypes: true,
    });
  } catch {
    throw new Error('Migration directory could not be read');
  }

  const errors: string[] = [];
  const discoveredPaths = new Set<string>();
  for (const entry of directoryEntries) {
    const entryPath = resolve(migrationDirectory, entry.name);
    if (entryPath === manifestPath) {
      continue;
    }
    if (!entry.isFile()) {
      errors.push(`Unexpected migration directory entry: ${entry.name}`);
      continue;
    }
    discoveredPaths.add(toPosixPath(relative(repositoryRoot, entryPath)));
  }

  const manifestEntries = new Map<string, MigrationManifestEntry>();
  const invalidHashPaths = new Set<string>();
  for (const [index, entry] of manifest.migrations.entries()) {
    if (!isSafeMigrationPath(entry.path, repositoryRoot, migrationDirectory)) {
      errors.push(`Invalid migration path at manifest index ${index}`);
      continue;
    }
    if (manifestEntries.has(entry.path)) {
      errors.push(`Duplicate migration path: ${entry.path}`);
      continue;
    }
    manifestEntries.set(entry.path, entry);
    if (!sha256Pattern.test(entry.sha256)) {
      invalidHashPaths.add(entry.path);
      errors.push(`Invalid SHA-256 for migration: ${entry.path}`);
    }
  }

  for (const path of discoveredPaths) {
    if (!manifestEntries.has(path)) {
      errors.push(`Migration file missing from manifest: ${path}`);
    }
  }
  for (const path of manifestEntries.keys()) {
    if (!discoveredPaths.has(path)) {
      errors.push(`Manifest entry has no migration file: ${path}`);
    }
  }

  const utf8Decoder = new TextDecoder('utf-8', { fatal: true });
  for (const [path, entry] of manifestEntries) {
    if (!discoveredPaths.has(path) || invalidHashPaths.has(path)) {
      continue;
    }

    let bytes: Buffer;
    try {
      bytes = await readFile(resolve(repositoryRoot, path));
    } catch {
      errors.push(`Migration file could not be read: ${path}`);
      continue;
    }

    try {
      utf8Decoder.decode(bytes);
    } catch {
      errors.push(`Migration is not valid UTF-8: ${path}`);
      continue;
    }

    const actualHash = createHash('sha256').update(bytes).digest('hex');
    if (actualHash !== entry.sha256) {
      errors.push(`Migration hash mismatch: ${path}`);
    }
  }

  if (errors.length > 0) {
    throw formatVerificationError(errors);
  }

  return [...discoveredPaths].sort((left, right) => left.localeCompare(right));
}

const entrypoint = process.argv[1];
if (entrypoint && pathToFileURL(resolve(entrypoint)).href === import.meta.url) {
  const databaseRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const repositoryRoot = resolve(databaseRoot, '../..');
  const migrationDirectory = resolve(databaseRoot, 'migrations');
  const manifestPath = resolve(migrationDirectory, 'manifest.json');

  void verifyMigrationManifest({
    repositoryRoot,
    migrationDirectory,
    manifestPath,
  })
    .then((paths) => {
      process.stdout.write(`Verified ${paths.length} migration file(s).\n`);
    })
    .catch((error: unknown) => {
      const message =
        error instanceof Error
          ? error.message
          : 'Migration manifest verification failed';
      process.stderr.write(`${message}\n`);
      process.exitCode = 1;
    });
}
