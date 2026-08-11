import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import type { CacheEntry, CacheEntryInput } from '../src/cache-entry.js';
import {
  type CacheCompatibilityContext,
  CacheRuntimeError,
  VerifiedCacheRuntime,
} from '../src/cache-runtime.js';
import { AccountingLedger } from '../src/ledger.js';
import { makePendingInput, makeUnverifiedInput } from './cache-fixture.js';

async function temporaryRepository(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'ikimetr-cache-negative-'));
}

function negativeInput(
  parent: CacheEntry,
  overrides: Partial<CacheEntryInput> = {},
): CacheEntryInput {
  return makeUnverifiedInput(parent, {
    entry_id: 'negative-1',
    namespace: 'negative',
    state: 'negative',
    expires_at: '2026-08-09T10:05:00.000Z',
    provenance: {
      ...parent.provenance,
      producer_kind: 'runtime',
      producer_id: 'coordinator',
      source_cache_key: parent.cache_key,
      source_entry_hash: parent.entry_hash,
      write_event_id: 'cache-write-negative-1',
    },
    payload: null,
    outcome_reason: { code: 'unsupported-task', transient: false },
    ...overrides,
  });
}

function context(entry: CacheEntry): CacheCompatibilityContext {
  return {
    cache_key: entry.cache_key,
    task_id: entry.task_id,
    task_type: entry.task_type,
    route: entry.route,
    provider: entry.provider,
    model_revision: entry.model_revision,
    prompt_version: entry.prompt_version,
    policy_version: entry.policy_version,
    config_hash: entry.config_hash,
    verification_profile_hash: entry.verification_profile_hash,
    task_spec_hash: entry.task_spec_hash,
    input_hashes: entry.input_hashes,
    diff_hash: entry.diff_hash,
    error_fingerprint: entry.error_fingerprint,
    data_class: entry.data_class,
    input_protection: entry.input_protection,
    data_policy_hash: entry.data_policy_hash,
    tool_versions: entry.tool_versions,
    dependency_versions: entry.dependency_versions,
  };
}

describe('bounded negative cache', () => {
  it('denies persistence when the negative TTL is not configured', async () => {
    const repositoryRoot = await temporaryRepository();
    const runtime = await VerifiedCacheRuntime.open({ repositoryRoot });
    const pending = await runtime.begin(makePendingInput());
    await expect(
      runtime.storeNegative(pending, negativeInput(pending)),
    ).rejects.toBeInstanceOf(CacheRuntimeError);
  });

  it('serves an allowed negative only before its explicit expiry', async () => {
    const repositoryRoot = await temporaryRepository();
    const ledger = await AccountingLedger.open(repositoryRoot);
    const runtime = await VerifiedCacheRuntime.open({
      repositoryRoot,
      ledger,
      negativePolicy: {
        ttlMs: 300_000,
        allowedTransientReasonCodes: [],
      },
    });
    const pending = await runtime.begin(makePendingInput());
    const negative = await runtime.storeNegative(
      pending,
      negativeInput(pending),
    );

    const hit = await runtime.lookupNegative(
      context(negative),
      new Date('2026-08-09T10:04:59.999Z'),
    );
    expect(hit.status).toBe('negative-hit');
    expect(hit.reason_code).toBe('unsupported-task');

    const expired = await runtime.lookupNegative(
      context(negative),
      new Date('2026-08-09T10:05:00.000Z'),
    );
    expect(expired.status).toBe('invalidated');
    expect(expired.entry).toBeNull();

    const actions = (await ledger.replay())
      .filter((event) => event.event_type === 'CacheEvent')
      .map((event) => event.action);
    expect(actions).toEqual(
      expect.arrayContaining(['negative-hit', 'invalidate']),
    );

    await expect(
      runtime.storeUnverified(
        pending,
        makeUnverifiedInput(pending, { entry_id: 'late-unverified' }),
      ),
    ).rejects.toBeInstanceOf(CacheRuntimeError);
  });

  it('denies provider outage even when transient failures are allowlisted', async () => {
    const repositoryRoot = await temporaryRepository();
    const runtime = await VerifiedCacheRuntime.open({
      repositoryRoot,
      negativePolicy: {
        ttlMs: 300_000,
        allowedTransientReasonCodes: ['provider-outage'],
      },
    });
    const pending = await runtime.begin(makePendingInput());
    await expect(
      runtime.storeNegative(
        pending,
        negativeInput(pending, {
          outcome_reason: { code: 'provider-outage', transient: true },
        }),
      ),
    ).rejects.toBeInstanceOf(CacheRuntimeError);
  });

  it('permits only explicitly allowlisted transient reason codes', async () => {
    const deniedRoot = await temporaryRepository();
    const denied = await VerifiedCacheRuntime.open({
      repositoryRoot: deniedRoot,
      negativePolicy: {
        ttlMs: 300_000,
        allowedTransientReasonCodes: [],
      },
    });
    const deniedPending = await denied.begin(makePendingInput());
    await expect(
      denied.storeNegative(
        deniedPending,
        negativeInput(deniedPending, {
          outcome_reason: { code: 'transient-malformed-result', transient: true },
        }),
      ),
    ).rejects.toBeInstanceOf(CacheRuntimeError);

    const allowedRoot = await temporaryRepository();
    const allowed = await VerifiedCacheRuntime.open({
      repositoryRoot: allowedRoot,
      negativePolicy: {
        ttlMs: 300_000,
        allowedTransientReasonCodes: ['transient-malformed-result'],
      },
    });
    const allowedPending = await allowed.begin(makePendingInput());
    await expect(
      allowed.storeNegative(
        allowedPending,
        negativeInput(allowedPending, {
          outcome_reason: { code: 'transient-malformed-result', transient: true },
        }),
      ),
    ).resolves.toMatchObject({ state: 'negative' });
  });
});
