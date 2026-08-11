import { createHmac } from 'node:crypto';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import type { HmacSha256Provider } from '../src/cache.js';
import {
  buildClearCachePayload,
  buildSealedCachePayload,
  CacheEntrySecurityError,
  finalizeCacheEntry,
  openSealedCachePayload,
  type SensitiveCacheCodec,
} from '../src/cache-entry.js';
import {
  CacheRuntimeError,
  VerifiedCacheRuntime,
} from '../src/cache-runtime.js';
import { CacheStorage } from '../src/cache-storage.js';
import { AccountingLedger } from '../src/ledger.js';
import { makePendingInput, makeUnverifiedInput } from './cache-fixture.js';

const hmac: HmacSha256Provider = {
  digest: (value) =>
    createHmac('sha256', 'synthetic-test-key').update(value).digest('hex'),
};

const codec: SensitiveCacheCodec = {
  codecId: 'test-local-sealed-v1',
  seal: async (value) => Uint8Array.from(value, (byte) => byte ^ 0xaa),
  open: async (value) => Uint8Array.from(value, (byte) => byte ^ 0xaa),
};

async function temporaryRepository(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'ikimetr-cache-sensitive-'));
}

describe('sealed sensitive cache payload', () => {
  it('stores no plaintext PII and verifies HMAC after opening', async () => {
    const payload = await buildSealedCachePayload({
      resultKind: 'structured-result',
      value: { contact: 'person@example.com', summary: 'approved result' },
      maxBytes: 1024,
      codec,
      hmac,
    });

    expect(JSON.stringify(payload)).not.toContain('person@example.com');
    expect(payload.protection).toBe('sealed');
    expect(
      await openSealedCachePayload(payload, { codec, hmac, maxBytes: 1024 }),
    ).toEqual({ contact: 'person@example.com', summary: 'approved result' });
  });

  it('fails closed without the injected codec or HMAC', async () => {
    await expect(
      buildSealedCachePayload({
        resultKind: 'structured-result',
        value: { summary: 'result' },
        maxBytes: 1024,
        codec: undefined as unknown as SensitiveCacheCodec,
        hmac,
      }),
    ).rejects.toBeInstanceOf(CacheEntrySecurityError);
    await expect(
      buildSealedCachePayload({
        resultKind: 'structured-result',
        value: { summary: 'result' },
        maxBytes: 1024,
        codec,
        hmac: undefined as unknown as HmacSha256Provider,
      }),
    ).rejects.toBeInstanceOf(CacheEntrySecurityError);
  });

  it('rejects clear Sensitive payloads and every Secret entry', () => {
    expect(() =>
      finalizeCacheEntry(
        makePendingInput({
          data_class: 'sensitive',
          input_protection: 'hmac-sha256',
          sensitive_persistence_approved: true,
        }),
      ),
    ).not.toThrow();
    expect(() =>
      finalizeCacheEntry(
        makeUnverifiedInput(
          finalizeCacheEntry(
            makePendingInput({
              data_class: 'sensitive',
              input_protection: 'hmac-sha256',
              sensitive_persistence_approved: true,
            }),
          ),
          {
            data_class: 'sensitive',
            input_protection: 'hmac-sha256',
            sensitive_persistence_approved: true,
            payload: buildClearCachePayload({
              resultKind: 'structured-result',
              value: { summary: 'must-be-sealed' },
              maxBytes: 1024,
            }),
          },
        ),
      ),
    ).toThrow(CacheEntrySecurityError);
    expect(() =>
      finalizeCacheEntry({
        ...makePendingInput(),
        data_class: 'secret',
      } as never),
    ).toThrow(CacheEntrySecurityError);
  });
});

describe('ledger-scoped Sensitive approval', () => {
  async function appendApproval(
    ledger: AccountingLedger,
    decision: 'approved' | 'denied' | 'revoked',
    eventId: string,
  ): Promise<void> {
    await ledger.append({
      event_version: 1,
      event_id: eventId,
      event_type: 'ApprovalEvent',
      occurred_at: '2026-08-09T10:00:00.000Z',
      approval_id: `approval-${eventId}`,
      task_id: 'task-sensitive',
      decision,
      scope: 'sensitive-cache',
      approver_hash: 'a'.repeat(64),
      reason_code: 'explicit-user-approval',
    });
  }

  it('denies by default and persists only sealed data after approval', async () => {
    const repositoryRoot = await temporaryRepository();
    const ledger = await AccountingLedger.open(repositoryRoot);
    const deniedRuntime = await VerifiedCacheRuntime.open({
      repositoryRoot,
      ledger,
      sensitiveCodec: codec,
      hmac,
    });
    const sensitivePending = makePendingInput({
      task_id: 'task-sensitive',
      data_class: 'sensitive',
      input_protection: 'hmac-sha256',
      sensitive_persistence_approved: true,
    });
    await expect(deniedRuntime.begin(sensitivePending)).rejects.toBeInstanceOf(
      CacheRuntimeError,
    );

    await appendApproval(ledger, 'approved', 'approval-event-1');
    const noCeilingRuntime = await VerifiedCacheRuntime.open({
      repositoryRoot,
      ledger,
      sensitiveCodec: codec,
      hmac,
    });
    await expect(noCeilingRuntime.begin(sensitivePending)).rejects.toBeInstanceOf(
      CacheRuntimeError,
    );

    const runtime = await VerifiedCacheRuntime.open({
      repositoryRoot,
      ledger,
      sensitiveCodec: codec,
      hmac,
      maxSensitivePayloadBytes: 1024,
    });
    const pending = await runtime.begin(sensitivePending);
    const payload = await buildSealedCachePayload({
      resultKind: 'structured-result',
      value: { contact: 'person@example.com', summary: 'approved result' },
      maxBytes: 1024,
      codec,
      hmac,
    });
    const unverified = await runtime.storeUnverified(
      pending,
      makeUnverifiedInput(pending, { payload }),
    );
    expect(JSON.stringify(unverified)).not.toContain('person@example.com');

    const stored = await (
      await CacheStorage.open(repositoryRoot)
    ).readRevisions('provider-request', pending.cache_key);
    expect(JSON.stringify(stored)).not.toContain('person@example.com');
  });

  it('denies after a later approval revocation and without a codec', async () => {
    const repositoryRoot = await temporaryRepository();
    const ledger = await AccountingLedger.open(repositoryRoot);
    await appendApproval(ledger, 'approved', 'approval-event-1');
    await appendApproval(ledger, 'revoked', 'approval-event-2');
    const revokedRuntime = await VerifiedCacheRuntime.open({
      repositoryRoot,
      ledger,
      sensitiveCodec: codec,
      hmac,
    });
    const pending = makePendingInput({
      task_id: 'task-sensitive',
      data_class: 'sensitive',
      input_protection: 'hmac-sha256',
      sensitive_persistence_approved: true,
    });
    await expect(revokedRuntime.begin(pending)).rejects.toBeInstanceOf(
      CacheRuntimeError,
    );

    const noCodecRoot = await temporaryRepository();
    const noCodecLedger = await AccountingLedger.open(noCodecRoot);
    await appendApproval(noCodecLedger, 'approved', 'approval-event-3');
    const noCodecRuntime = await VerifiedCacheRuntime.open({
      repositoryRoot: noCodecRoot,
      ledger: noCodecLedger,
      hmac,
    });
    await expect(noCodecRuntime.begin(pending)).rejects.toBeInstanceOf(
      CacheRuntimeError,
    );
  });
});
