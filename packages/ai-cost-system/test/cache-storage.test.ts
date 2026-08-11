import { mkdir, mkdtemp, readFile, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { CacheStorage, CacheStorageError } from '../src/cache-storage.js';
import { makeUnverifiedEntry, shaB, shaD } from './cache-fixture.js';

async function temporaryRepository(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'ikimetr-cache-storage-'));
}

describe('immutable cache storage', () => {
  it('writes and reads content-addressed revisions without overwriting', async () => {
    const repositoryRoot = await temporaryRepository();
    const storage = await CacheStorage.open(repositoryRoot);
    const first = makeUnverifiedEntry();
    const second = makeUnverifiedEntry({
      entry_id: 'entry-2',
      provenance: {
        ...first.provenance,
        write_event_id: 'cache-write-2',
      },
    });

    expect(await storage.append(first)).toEqual({ disposition: 'written' });
    expect(await storage.append(first)).toEqual({ disposition: 'existing' });
    expect(await storage.append(second)).toEqual({ disposition: 'written' });

    const revisions = await storage.readRevisions(
      'provider-request',
      first.cache_key,
    );
    expect(revisions.map((entry) => entry.entry_hash).sort()).toEqual(
      [first.entry_hash, second.entry_hash].sort(),
    );

    const expectedPath = join(
      repositoryRoot,
      '.ai-cost',
      'cache',
      'provider-request',
      first.cache_key.slice(0, 2),
      first.cache_key,
      `${first.entry_hash}.json`,
    );
    expect(JSON.parse(await readFile(expectedPath, 'utf8'))).toEqual(first);
  });

  it('rejects traversal-like namespaces and cache keys', async () => {
    const storage = await CacheStorage.open(await temporaryRepository());
    await expect(
      storage.readRevisions('../negative' as 'negative', shaB),
    ).rejects.toBeInstanceOf(CacheStorageError);
    await expect(
      storage.readRevisions('negative', '../escape'),
    ).rejects.toBeInstanceOf(CacheStorageError);
  });

  it('rejects a symlinked cache boundary', async () => {
    const repositoryRoot = await temporaryRepository();
    const outside = await temporaryRepository();
    await mkdir(join(repositoryRoot, '.ai-cost'));
    await symlink(outside, join(repositoryRoot, '.ai-cost', 'cache'), 'dir');

    await expect(CacheStorage.open(repositoryRoot)).rejects.toBeInstanceOf(
      CacheStorageError,
    );
  });

  it('rejects a symlinked immutable revision', async () => {
    const repositoryRoot = await temporaryRepository();
    const outside = await temporaryRepository();
    const storage = await CacheStorage.open(repositoryRoot);
    const entry = makeUnverifiedEntry();
    const revisionDirectory = join(
      repositoryRoot,
      '.ai-cost',
      'cache',
      'provider-request',
      entry.cache_key.slice(0, 2),
      entry.cache_key,
    );
    const outsideRevision = join(outside, 'outside.json');
    await mkdir(revisionDirectory, { recursive: true });
    await writeFile(outsideRevision, JSON.stringify(entry), 'utf8');
    await symlink(
      outsideRevision,
      join(revisionDirectory, `${entry.entry_hash}.json`),
      'file',
    );

    await expect(
      storage.readRevisions('provider-request', entry.cache_key),
    ).rejects.toBeInstanceOf(CacheStorageError);
  });

  it.each([
    ['partial JSON', '{"schema_version":1'],
    ['malformed JSON', '{not-json}'],
  ])('rejects %s in a final revision', async (_label, contents) => {
    const repositoryRoot = await temporaryRepository();
    const storage = await CacheStorage.open(repositoryRoot);
    const finalPath = join(
      repositoryRoot,
      '.ai-cost',
      'cache',
      'provider-request',
      shaB.slice(0, 2),
      shaB,
      `${shaD}.json`,
    );
    await mkdir(dirname(finalPath), { recursive: true });
    await writeFile(finalPath, contents, 'utf8');

    await expect(
      storage.readRevisions('provider-request', shaB),
    ).rejects.toBeInstanceOf(CacheStorageError);
  });

  it('rejects a checksum mismatch instead of trusting the filename', async () => {
    const repositoryRoot = await temporaryRepository();
    const storage = await CacheStorage.open(repositoryRoot);
    const entry = makeUnverifiedEntry();
    const finalPath = join(
      repositoryRoot,
      '.ai-cost',
      'cache',
      'provider-request',
      shaB.slice(0, 2),
      shaB,
      `${shaD}.json`,
    );
    await mkdir(dirname(finalPath), { recursive: true });
    await writeFile(
      finalPath,
      JSON.stringify({ ...entry, entry_hash: shaD }),
      'utf8',
    );

    await expect(
      storage.readRevisions('provider-request', shaB),
    ).rejects.toBeInstanceOf(CacheStorageError);
  });
});
