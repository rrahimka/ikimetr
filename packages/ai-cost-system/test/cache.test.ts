import { createHmac } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

import {
  buildApprovedInputHash,
  buildCacheKey,
  CacheSecurityError,
  CacheValidationError,
  isVerifiedCacheHit,
  parseCacheMetadata,
  SingleFlight,
} from '../src/index.js';

const hashA = 'a'.repeat(64);
const hashB = 'b'.repeat(64);
const baseKeyInput = {
  namespace: 'provider-request' as const,
  taskId: 'task-1',
  taskType: 'routine-code-result',
  dataClass: 'internal' as const,
  dataPolicyHash: hashB,
  inputProtection: 'sha256' as const,
  policyVersion: '1.0.0',
  routingConfigHash: hashA,
  promptVersion: 'prompt-v1',
  route: 'cheap-cloud' as const,
  provider: 'deepseek' as const,
  modelRevision: 'deepseek-test-r1',
  taskSpecHash: hashA,
  approvedInputHashes: [hashA, hashB],
  diffHash: hashB,
  errorFingerprint: null,
  toolVersions: { node: '24.18.0', pnpm: '10.17.1' },
  dependencyVersions: { zod: '4.4.3' },
  verificationProfileHash: hashA,
};

describe('cache key and protected input fingerprints', () => {
  it('is stable for identical input and changes for meaningful fields', () => {
    const original = buildCacheKey(baseKeyInput);

    expect(buildCacheKey({ ...baseKeyInput })).toBe(original);
    expect(
      buildCacheKey({ ...baseKeyInput, promptVersion: 'prompt-v2' }),
    ).not.toBe(original);
    expect(
      buildCacheKey({ ...baseKeyInput, namespace: 'verified-artifact' }),
    ).not.toBe(original);
    expect(
      buildCacheKey({
        ...baseKeyInput,
        approvedInputHashes: [...baseKeyInput.approvedInputHashes].reverse(),
      }),
    ).not.toBe(original);
  });

  it('hashes non-secret input without retaining the raw value', () => {
    const value = new TextEncoder().encode('approved internal fixture');

    expect(
      buildApprovedInputHash({
        dataClass: 'internal',
        value,
        persistent: true,
      }),
    ).toMatch(/^[a-f0-9]{64}$/u);
  });

  it('always denies secret input and denies sensitive persistence by default', () => {
    const value = new TextEncoder().encode('not-persisted');

    expect(() =>
      buildApprovedInputHash({
        dataClass: 'secret',
        value,
        persistent: false,
      }),
    ).toThrow(CacheSecurityError);
    expect(() =>
      buildApprovedInputHash({
        dataClass: 'sensitive',
        value,
        persistent: true,
      }),
    ).toThrow(CacheSecurityError);
  });

  it('requires an approved injected HMAC for sensitive persistent input', () => {
    const value = new TextEncoder().encode('sensitive fixture');
    const expected = createHmac('sha256', 'test-only-key')
      .update(value)
      .digest('hex');

    expect(
      buildApprovedInputHash({
        dataClass: 'sensitive',
        value,
        persistent: true,
        sensitivePersistenceApproved: true,
        hmac: {
          digest(input) {
            return createHmac('sha256', 'test-only-key')
              .update(input)
              .digest('hex');
          },
        },
      }),
    ).toBe(expected);
    expect(() =>
      buildApprovedInputHash({
        dataClass: 'sensitive',
        value,
        persistent: true,
        sensitivePersistenceApproved: true,
      }),
    ).toThrow(CacheSecurityError);
    expect(() =>
      buildApprovedInputHash({
        dataClass: 'sensitive',
        value,
        persistent: true,
        sensitivePersistenceApproved: true,
        hmac: { digest: () => 'malformed' },
      }),
    ).toThrow(CacheSecurityError);
  });
});

describe('strict cache metadata eligibility', () => {
  const verified = {
    schema_version: 1,
    namespace: 'verified-artifact' as const,
    cache_key: hashA,
    state: 'verified' as const,
    data_class: 'internal' as const,
    persistent: true,
    input_protection: 'sha256' as const,
    sensitive_persistence_approved: false,
    created_at: '2026-08-09T10:00:00.000Z',
    expires_at: '2026-08-09T13:00:00.000Z',
    result_hash: hashB,
    verification_evidence_hash: hashA,
    reason_code: null,
  };

  it('accepts strict verified metadata and reuses only before expiry', () => {
    const metadata = parseCacheMetadata(verified);

    expect(isVerifiedCacheHit(metadata, new Date('2026-08-09T12:00:00Z'))).toBe(
      true,
    );
    expect(isVerifiedCacheHit(metadata, new Date(verified.expires_at))).toBe(
      false,
    );
  });

  it.each(['pending', 'unverified', 'negative', 'quarantined'] as const)(
    'does not reuse %s metadata',
    (state) => {
      const value = {
        ...verified,
        namespace:
          state === 'negative'
            ? ('negative' as const)
            : state === 'quarantined'
              ? ('verified-artifact' as const)
              : ('provider-request' as const),
        state,
        result_hash: state === 'unverified' ? hashB : null,
        verification_evidence_hash: null,
        reason_code:
          state === 'negative' || state === 'quarantined'
            ? 'verification-failed'
            : null,
      };

      expect(
        isVerifiedCacheHit(
          parseCacheMetadata(value),
          new Date('2026-08-09T12:00:00Z'),
        ),
      ).toBe(false);
    },
  );

  it('rejects malformed or poisoned metadata without echoing raw content', () => {
    expect(() =>
      parseCacheMetadata({ ...verified, raw_prompt: 'must-not-survive' }),
    ).toThrow(CacheValidationError);
    expect(() =>
      parseCacheMetadata({
        ...verified,
        verification_evidence_hash: null,
      }),
    ).toThrow(CacheValidationError);
    expect(() =>
      parseCacheMetadata({ ...verified, data_class: 'secret' }),
    ).toThrow(CacheValidationError);
    expect(() =>
      parseCacheMetadata({
        ...verified,
        data_class: 'sensitive',
        input_protection: 'sha256',
        sensitive_persistence_approved: false,
      }),
    ).toThrow(CacheValidationError);
  });
});

describe('SingleFlight', () => {
  it('runs a concurrent computation once and labels leader/reuse', async () => {
    const singleFlight = new SingleFlight<{ readonly answer: number }>();
    let resolve!: (value: { readonly answer: number }) => void;
    const pending = new Promise<{ readonly answer: number }>((done) => {
      resolve = done;
    });
    const operation = vi.fn(() => pending);

    const leader = singleFlight.run(hashA, operation);
    const reused = singleFlight.run(hashA, operation);
    const value = Object.freeze({ answer: 42 });
    resolve(value);

    await expect(leader).resolves.toEqual({ disposition: 'leader', value });
    await expect(reused).resolves.toEqual({ disposition: 'reused', value });
    expect(operation).toHaveBeenCalledTimes(1);
  });

  it('removes a rejected computation so a later call can retry', async () => {
    const singleFlight = new SingleFlight<number>();
    const operation = vi
      .fn<() => Promise<number>>()
      .mockRejectedValueOnce(new Error('expected failure'))
      .mockResolvedValueOnce(7);

    await expect(singleFlight.run(hashA, operation)).rejects.toThrow(
      'expected failure',
    );
    await expect(singleFlight.run(hashA, operation)).resolves.toEqual({
      disposition: 'leader',
      value: 7,
    });
    expect(operation).toHaveBeenCalledTimes(2);
  });
});
