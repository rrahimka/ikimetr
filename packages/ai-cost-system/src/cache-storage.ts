import { constants } from 'node:fs';
import {
  lstat,
  mkdir,
  open,
  readdir,
  realpath,
  rename,
  stat,
  unlink,
} from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { randomUUID } from 'node:crypto';

import { canonicalize } from './canonical.js';
import {
  type CacheEntry,
  CacheEntrySecurityError,
  CacheEntryValidationError,
  parseCacheEntry,
} from './cache-entry.js';
import { ConfigValidationError } from './errors.js';
import { parseJsonStrict } from './json.js';

const stateDirectoryName = '.ai-cost';
const cacheDirectoryName = 'cache';
const cacheNamespaces = new Set([
  'provider-request',
  'verified-artifact',
  'negative',
]);
const sha256Pattern = /^[a-f0-9]{64}$/u;

export class CacheStorageError extends Error {
  public constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'CacheStorageError';
  }
}

export class CacheStorage {
  private operationQueue: Promise<void> = Promise.resolve();

  private constructor(
    private readonly repositoryRoot: string,
    private readonly stateDirectory: string,
    private readonly cacheDirectory: string,
  ) {}

  public static async open(repositoryRoot: string): Promise<CacheStorage> {
    try {
      const resolvedRoot = await realpath(repositoryRoot);
      const rootMetadata = await stat(resolvedRoot);
      if (!rootMetadata.isDirectory()) {
        throw new CacheStorageError('Repository root is not a directory');
      }
      const stateDirectory = join(resolvedRoot, stateDirectoryName);
      const cacheDirectory = join(stateDirectory, cacheDirectoryName);
      await ensureDirectory(resolvedRoot, stateDirectory, true);
      await ensureDirectory(stateDirectory, cacheDirectory, true);
      return new CacheStorage(resolvedRoot, stateDirectory, cacheDirectory);
    } catch (error) {
      throw asStorageError(error, 'Unable to open cache storage');
    }
  }

  public async append(
    entry: CacheEntry,
  ): Promise<Readonly<{ disposition: 'written' | 'existing' }>> {
    let validated: CacheEntry;
    try {
      validated = parseCacheEntry(entry);
      validateAddress(validated.namespace, validated.cache_key);
    } catch (error) {
      throw asStorageError(error, 'Cache revision is invalid');
    }

    const operation = this.operationQueue.then(async () => {
      await this.verifyRootBoundary();
      const keyDirectory = await this.ensureKeyDirectory(
        validated.namespace,
        validated.cache_key,
      );
      const finalPath = join(keyDirectory, `${validated.entry_hash}.json`);
      assertContained(keyDirectory, finalPath);
      const serialized = canonicalize(validated);

      const existing = await readExistingRevision(finalPath);
      if (existing !== null) {
        if (canonicalize(existing) !== serialized) {
          throw new CacheStorageError(
            'Content-addressed cache revision conflicts with existing data',
          );
        }
        return Object.freeze({ disposition: 'existing' as const });
      }

      const temporaryPath = join(
        keyDirectory,
        `.${validated.entry_hash}.${randomUUID()}.tmp`,
      );
      assertContained(keyDirectory, temporaryPath);
      const noFollow = constants.O_NOFOLLOW ?? 0;
      let handle;
      try {
        handle = await open(
          temporaryPath,
          constants.O_CREAT |
            constants.O_EXCL |
            constants.O_WRONLY |
            noFollow,
          0o600,
        );
        const bytes = Buffer.from(serialized, 'utf8');
        let offset = 0;
        while (offset < bytes.byteLength) {
          const { bytesWritten } = await handle.write(
            bytes,
            offset,
            bytes.byteLength - offset,
            null,
          );
          if (bytesWritten <= 0) {
            throw new CacheStorageError('Cache write made no progress');
          }
          offset += bytesWritten;
        }
        await handle.sync();
        await handle.close();
        handle = undefined;

        const appeared = await readExistingRevision(finalPath);
        if (appeared !== null) {
          if (canonicalize(appeared) !== serialized) {
            throw new CacheStorageError(
              'Concurrent cache revision conflicts with existing data',
            );
          }
          await unlink(temporaryPath);
          return Object.freeze({ disposition: 'existing' as const });
        }

        await rename(temporaryPath, finalPath);
        const persisted = await readRevisionFile(finalPath);
        if (canonicalize(persisted) !== serialized) {
          throw new CacheStorageError('Published cache revision failed verification');
        }
        return Object.freeze({ disposition: 'written' as const });
      } catch (error) {
        throw asStorageError(error, 'Cache revision write failed');
      } finally {
        await handle?.close().catch(() => undefined);
        await unlink(temporaryPath).catch((error: unknown) => {
          if (!isNodeError(error) || error.code !== 'ENOENT') {
            return undefined;
          }
          return undefined;
        });
      }
    });

    this.operationQueue = operation.then(
      () => undefined,
      () => undefined,
    );
    return operation;
  }

  public async readRevisions(
    namespace: 'provider-request' | 'verified-artifact' | 'negative',
    cacheKey: string,
  ): Promise<readonly CacheEntry[]> {
    try {
      validateAddress(namespace, cacheKey);
      await this.operationQueue;
      await this.verifyRootBoundary();
      const keyDirectory = this.keyDirectory(namespace, cacheKey);
      const metadata = await safeLstat(keyDirectory);
      if (metadata === null) {
        return Object.freeze([]);
      }
      await verifyDirectory(this.cacheDirectory, keyDirectory);

      const directoryEntries = await readdir(keyDirectory, {
        withFileTypes: true,
      });
      const revisions: CacheEntry[] = [];
      for (const directoryEntry of directoryEntries) {
        if (
          !directoryEntry.isFile() ||
          !/^[a-f0-9]{64}\.json$/u.test(directoryEntry.name)
        ) {
          throw new CacheStorageError(
            'Cache key directory contains an unexpected entry',
          );
        }
        const path = join(keyDirectory, directoryEntry.name);
        const revision = await readRevisionFile(path);
        if (
          revision.namespace !== namespace ||
          revision.cache_key !== cacheKey ||
          `${revision.entry_hash}.json` !== directoryEntry.name
        ) {
          throw new CacheStorageError(
            'Cache revision address does not match its content',
          );
        }
        revisions.push(revision);
      }
      revisions.sort((left, right) =>
        left.entry_hash.localeCompare(right.entry_hash),
      );
      return Object.freeze(revisions);
    } catch (error) {
      throw asStorageError(error, 'Cache revision read failed');
    }
  }

  private async verifyRootBoundary(): Promise<void> {
    await verifyDirectory(this.repositoryRoot, this.stateDirectory);
    await verifyDirectory(this.stateDirectory, this.cacheDirectory);
  }

  private async ensureKeyDirectory(
    namespace: CacheEntry['namespace'],
    cacheKey: string,
  ): Promise<string> {
    const namespaceDirectory = join(this.cacheDirectory, namespace);
    const prefixDirectory = join(namespaceDirectory, cacheKey.slice(0, 2));
    const keyDirectory = join(prefixDirectory, cacheKey);
    await ensureDirectory(this.cacheDirectory, namespaceDirectory, true);
    await ensureDirectory(namespaceDirectory, prefixDirectory, true);
    await ensureDirectory(prefixDirectory, keyDirectory, true);
    return keyDirectory;
  }

  private keyDirectory(
    namespace: CacheEntry['namespace'],
    cacheKey: string,
  ): string {
    const path = join(
      this.cacheDirectory,
      namespace,
      cacheKey.slice(0, 2),
      cacheKey,
    );
    assertContained(this.cacheDirectory, path);
    return path;
  }
}

function validateAddress(namespace: string, cacheKey: string): void {
  if (!cacheNamespaces.has(namespace) || !sha256Pattern.test(cacheKey)) {
    throw new CacheStorageError('Cache address failed strict validation');
  }
}

async function ensureDirectory(
  parent: string,
  path: string,
  create: boolean,
): Promise<void> {
  assertContained(parent, path);
  let metadata = await safeLstat(path);
  if (metadata === null && create) {
    try {
      await mkdir(path, { mode: 0o700 });
    } catch (error) {
      if (!isNodeError(error) || error.code !== 'EEXIST') {
        throw error;
      }
    }
    metadata = await safeLstat(path);
  }
  if (metadata === null || metadata.isSymbolicLink() || !metadata.isDirectory()) {
    throw new CacheStorageError('Cache storage directory is unsafe');
  }
  const resolved = await realpath(path);
  assertContained(await realpath(parent), resolved);
}

async function verifyDirectory(parent: string, path: string): Promise<void> {
  return ensureDirectory(parent, path, false);
}

async function readExistingRevision(path: string): Promise<CacheEntry | null> {
  const metadata = await safeLstat(path);
  if (metadata === null) {
    return null;
  }
  return readRevisionFile(path);
}

async function readRevisionFile(path: string): Promise<CacheEntry> {
  const metadata = await lstat(path);
  if (metadata.isSymbolicLink() || !metadata.isFile()) {
    throw new CacheStorageError('Cache revision is not a safe regular file');
  }
  const noFollow = constants.O_NOFOLLOW ?? 0;
  const handle = await open(path, constants.O_RDONLY | noFollow);
  let source: string;
  try {
    const openedMetadata = await handle.stat();
    if (!openedMetadata.isFile()) {
      throw new CacheStorageError('Cache revision is not a safe regular file');
    }
    source = await handle.readFile('utf8');
  } finally {
    await handle.close();
  }
  try {
    return parseCacheEntry(parseJsonStrict(source, 'cache revision'));
  } catch (error) {
    if (
      error instanceof ConfigValidationError ||
      error instanceof CacheEntryValidationError ||
      error instanceof CacheEntrySecurityError
    ) {
      throw new CacheStorageError('Cache revision content is invalid', {
        cause: error,
      });
    }
    throw error;
  }
}

function assertContained(parent: string, child: string): void {
  const resolvedParent = resolve(parent);
  const resolvedChild = resolve(child);
  const pathFromParent = relative(resolvedParent, resolvedChild);
  if (
    pathFromParent === '' ||
    pathFromParent === '..' ||
    pathFromParent.startsWith(`..${sep}`) ||
    isAbsolute(pathFromParent)
  ) {
    throw new CacheStorageError('Cache path escaped its storage boundary');
  }
}

async function safeLstat(path: string): Promise<Awaited<ReturnType<typeof lstat>> | null> {
  try {
    return await lstat(path);
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}

function asStorageError(error: unknown, message: string): CacheStorageError {
  if (error instanceof CacheStorageError) {
    return error;
  }
  return new CacheStorageError(message, { cause: error });
}
