import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  assertAllowedCacheTransition,
  buildClearCachePayload,
  CacheEntrySecurityError,
  CacheEntryValidationError,
  deriveCacheKeyForEntry,
  finalizeCacheEntry,
  parseCacheEntry,
  type CacheEntryInput,
} from '../src/cache-entry.js';

const hash = (value: string): string =>
  createHash('sha256').update(value, 'utf8').digest('hex');

const shaA = 'a'.repeat(64);
const shaB = 'b'.repeat(64);
const shaC = 'c'.repeat(64);
const shaD = 'd'.repeat(64);

function baseEntryInput(
  overrides: Partial<CacheEntryInput> = {},
): CacheEntryInput {
  const candidate: CacheEntryInput = {
    schema_version: 1,
    entry_id: 'entry-1',
    task_id: 'task-1',
    parent_entry_hash: shaA,
    cache_key: shaB,
    namespace: 'provider-request',
    state: 'unverified',
    task_type: 'routine-code-result',
    route: 'local',
    provider: 'local-ai',
    model_revision: 'model-1',
    prompt_version: 'prompt-1',
    policy_version: 'policy-1',
    config_hash: shaC,
    verification_profile_hash: shaD,
    task_spec_hash: shaA,
    input_hashes: [shaB, shaC],
    diff_hash: null,
    error_fingerprint: null,
    patch_hash: null,
    created_at: '2026-08-09T10:00:00.000Z',
    expires_at: '2026-08-09T11:00:00.000Z',
    provenance: {
      lineage_id: 'lineage-1',
      producer_kind: 'provider',
      producer_id: 'local-ai',
      source_cache_key: shaA,
      source_entry_hash: shaA,
      write_event_id: 'cache-write-1',
    },
    data_class: 'internal',
    input_protection: 'sha256',
    sensitive_persistence_approved: false,
    data_policy_hash: shaD,
    tool_versions: { node: '24.18.0' },
    dependency_versions: { zod: '4.4.3' },
    payload: buildClearCachePayload({
      resultKind: 'structured-result',
      value: { details: { z: 2, a: 1 }, answer: 'ok' },
      maxBytes: 512,
    }),
    verification_evidence: null,
    outcome_reason: null,
    ...overrides,
  };
  return overrides.cache_key === undefined
    ? { ...candidate, cache_key: deriveCacheKeyForEntry(candidate) }
    : candidate;
}

describe('strict canonical cache entries', () => {
  it('canonicalizes a clear payload and covers it with stable hashes', () => {
    const payload = buildClearCachePayload({
      resultKind: 'structured-result',
      value: { details: { z: 2, a: 1 }, answer: 'ok' },
      maxBytes: 512,
    });
    const reordered = buildClearCachePayload({
      resultKind: 'structured-result',
      value: { answer: 'ok', details: { a: 1, z: 2 } },
      maxBytes: 512,
    });

    expect(payload.result_hash).toBe(
      hash('{"answer":"ok","details":{"a":1,"z":2}}'),
    );
    expect(reordered).toEqual(payload);

    const first = finalizeCacheEntry(baseEntryInput({ payload }));
    const second = finalizeCacheEntry(baseEntryInput({ payload: reordered }));
    expect(second.entry_hash).toBe(first.entry_hash);
    expect(parseCacheEntry(JSON.parse(JSON.stringify(first)))).toEqual(first);
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.payload)).toBe(true);
  });

  it('rejects raw-content and PII fields or values', () => {
    expect(() =>
      buildClearCachePayload({
        resultKind: 'structured-result',
        value: { raw_prompt: 'summarize this' },
        maxBytes: 512,
      }),
    ).toThrow(CacheEntrySecurityError);
    expect(() =>
      buildClearCachePayload({
        resultKind: 'structured-result',
        value: { contact: 'person@example.com' },
        maxBytes: 512,
      }),
    ).toThrow(CacheEntrySecurityError);
    expect(() =>
      finalizeCacheEntry({
        ...baseEntryInput(),
        raw_logs: ['not allowed'],
      } as CacheEntryInput),
    ).toThrow(CacheEntrySecurityError);
  });

  it('rejects unsupported JSON and payloads above the explicit ceiling', () => {
    expect(() =>
      buildClearCachePayload({
        resultKind: 'structured-result',
        value: { score: Number.NaN },
        maxBytes: 512,
      }),
    ).toThrow(CacheEntryValidationError);
    expect(() =>
      buildClearCachePayload({
        resultKind: 'structured-result',
        value: { answer: undefined },
        maxBytes: 512,
      }),
    ).toThrow(CacheEntryValidationError);
    expect(() =>
      buildClearCachePayload({
        resultKind: 'structured-result',
        value: { answer: 'too large' },
        maxBytes: 4,
      }),
    ).toThrow(CacheEntryValidationError);
  });

  it('rejects a checksum mismatch', () => {
    const entry = finalizeCacheEntry(baseEntryInput());
    expect(() => parseCacheEntry({ ...entry, entry_hash: shaD })).toThrow(
      CacheEntryValidationError,
    );
  });

  it('rejects a cache key not derived from the compatibility metadata', () => {
    const draft = { ...baseEntryInput(), cache_key: shaB };
    const derivedKey = deriveCacheKeyForEntry(draft);
    expect(derivedKey).toMatch(/^[a-f0-9]{64}$/u);
    expect(() =>
      finalizeCacheEntry({ ...draft, cache_key: derivedKey }),
    ).not.toThrow();
    expect(() => finalizeCacheEntry(draft)).toThrow(
      CacheEntryValidationError,
    );
  });

  it('rejects a provider self-marked verified revision', () => {
    const providerMarked = baseEntryInput({
      namespace: 'verified-artifact',
      state: 'verified',
      verification_evidence: {
        schema_version: 1,
        required_stages: ['lint'],
        completed_stages: ['lint'],
        stages: [
          {
            stage_id: 'lint',
            command_id: 'lint',
            exit_code: 0,
            evidence_hash: shaA,
            tool_version: 'eslint-9',
            duration_ms: 10,
          },
        ],
        authority_id: 'trusted-test-pipeline',
        authority_version: 'authority-1',
        verification_profile_hash: shaD,
        verified_at: '2026-08-09T10:30:00.000Z',
      },
    });

    expect(() => finalizeCacheEntry(providerMarked)).toThrow(
      CacheEntryValidationError,
    );
  });
});

describe('cache state machine', () => {
  it.each([
    [null, 'pending'],
    ['pending', 'unverified'],
    ['pending', 'negative'],
    ['unverified', 'verified'],
    ['unverified', 'negative'],
    ['pending', 'quarantined'],
    ['unverified', 'quarantined'],
    ['verified', 'quarantined'],
    ['negative', 'quarantined'],
  ] as const)('allows %s -> %s', (from, to) => {
    expect(() => assertAllowedCacheTransition(from, to)).not.toThrow();
  });

  it.each([
    ['negative', 'verified'],
    ['quarantined', 'verified'],
    ['verified', 'unverified'],
    ['negative', 'pending'],
    ['quarantined', 'pending'],
  ] as const)('rejects %s -> %s', (from, to) => {
    expect(() => assertAllowedCacheTransition(from, to)).toThrow(
      CacheEntryValidationError,
    );
  });
});
