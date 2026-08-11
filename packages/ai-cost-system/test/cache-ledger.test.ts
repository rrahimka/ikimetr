import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { VerifiedCacheRuntime } from '../src/cache-runtime.js';
import { AccountingLedger } from '../src/ledger.js';
import { LedgerValidationError, parseLedgerEvent } from '../src/ledger-events.js';
import {
  makePendingInput,
  makeUnverifiedInput,
  shaA,
  shaB,
} from './cache-fixture.js';

function cacheEvent(action: string): Record<string, unknown> {
  return {
    event_version: 1,
    event_id: `cache-${action}`,
    event_type: 'CacheEvent',
    occurred_at: '2026-08-09T10:00:00.000Z',
    cache_key: shaA,
    namespace: 'provider-request',
    action,
    entry_hash: action === 'lookup' || action === 'miss' ? null : shaB,
    state: action === 'quarantine' ? 'quarantined' : 'unverified',
    result_hash: null,
    reason_code: action === 'miss' ? 'not-found' : null,
  };
}

describe('strict cache ledger events', () => {
  it.each([
    'lookup',
    'hit',
    'miss',
    'write',
    'invalidate',
    'quarantine',
    'negative-hit',
    'verified-reuse',
  ])('accepts the %s action without raw content', (action) => {
    expect(parseLedgerEvent(cacheEvent(action))).toMatchObject({
      event_type: 'CacheEvent',
      action,
    });
  });

  it('rejects raw prompt, log, and PII fields', () => {
    for (const field of ['raw_prompt', 'raw_logs', 'email']) {
      expect(() =>
        parseLedgerEvent({ ...cacheEvent('write'), [field]: 'prohibited' }),
      ).toThrow(LedgerValidationError);
    }
  });

  it('audits immutable cache writes in the real append-only ledger', async () => {
    const repositoryRoot = await mkdtemp(
      join(tmpdir(), 'ikimetr-cache-ledger-'),
    );
    const ledger = await AccountingLedger.open(repositoryRoot);
    const runtime = await VerifiedCacheRuntime.open({
      repositoryRoot,
      ledger,
    });
    const pending = await runtime.begin(makePendingInput());
    const unverified = await runtime.storeUnverified(
      pending,
      makeUnverifiedInput(pending),
    );

    const writes = (await ledger.replay()).filter(
      (event) => event.event_type === 'CacheEvent' && event.action === 'write',
    );
    expect(writes).toHaveLength(2);
    expect(writes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          event_id: pending.provenance.write_event_id,
          cache_key: pending.cache_key,
          entry_hash: pending.entry_hash,
          state: 'pending',
        }),
        expect.objectContaining({
          event_id: unverified.provenance.write_event_id,
          cache_key: unverified.cache_key,
          entry_hash: unverified.entry_hash,
          state: 'unverified',
        }),
      ]),
    );
  });
});
