import { z } from 'zod';

import { canonicalize, sha256 } from './canonical.js';
import { ConfigValidationError } from './errors.js';
import { assertNoSecretLikeValues } from './json.js';

const sha256Hex = z.string().regex(/^[a-f0-9]{64}$/u);
const boundedVersion = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:+/-]*$/u);
const reasonCode = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z][a-z0-9-]*$/u);
const utcTimestamp = z
  .iso.datetime()
  .refine((value) => value.endsWith('Z'), 'timestamp must use UTC');
const versionRecord = z
  .record(boundedVersion, boundedVersion)
  .refine((value) => Object.keys(value).length <= 64, 'too many versions');

const cacheKeyInputSchema = z
  .object({
    namespace: z.enum([
      'provider-request',
      'verified-artifact',
      'negative',
    ]),
    taskId: boundedVersion,
    taskType: boundedVersion,
    dataClass: z.enum(['public', 'internal', 'sensitive']),
    dataPolicyHash: sha256Hex,
    inputProtection: z.enum(['sha256', 'hmac-sha256']),
    policyVersion: boundedVersion,
    routingConfigHash: sha256Hex,
    promptVersion: boundedVersion,
    route: z.enum(['deterministic', 'local', 'cheap-cloud', 'strong']),
    provider: z.enum([
      'local-ai',
      'deepseek',
      'qwen',
      'codex',
      'claude',
    ]),
    modelRevision: boundedVersion,
    taskSpecHash: sha256Hex,
    approvedInputHashes: z.array(sha256Hex).max(256),
    diffHash: sha256Hex.nullable(),
    errorFingerprint: sha256Hex.nullable(),
    toolVersions: versionRecord,
    dependencyVersions: versionRecord,
    verificationProfileHash: sha256Hex,
  })
  .strict();

const cacheMetadataSchema = z
  .object({
    schema_version: z.literal(1),
    namespace: z.enum([
      'provider-request',
      'verified-artifact',
      'negative',
    ]),
    cache_key: sha256Hex,
    state: z.enum([
      'pending',
      'unverified',
      'verified',
      'negative',
      'quarantined',
    ]),
    data_class: z.enum(['public', 'internal', 'sensitive']),
    persistent: z.boolean(),
    input_protection: z.enum(['sha256', 'hmac-sha256']),
    sensitive_persistence_approved: z.boolean(),
    created_at: utcTimestamp,
    expires_at: utcTimestamp,
    result_hash: sha256Hex.nullable(),
    verification_evidence_hash: sha256Hex.nullable(),
    reason_code: reasonCode.nullable(),
  })
  .strict()
  .superRefine((metadata, context) => {
    if (Date.parse(metadata.expires_at) <= Date.parse(metadata.created_at)) {
      context.addIssue({
        code: 'custom',
        path: ['expires_at'],
        message: 'cache expiry must be after creation',
      });
    }

    if (
      metadata.state === 'verified' &&
      (metadata.result_hash === null ||
        metadata.verification_evidence_hash === null ||
        metadata.reason_code !== null)
    ) {
      context.addIssue({
        code: 'custom',
        message: 'verified cache metadata is incomplete',
      });
    }
    if (
      metadata.state === 'unverified' &&
      (metadata.result_hash === null ||
        metadata.verification_evidence_hash !== null ||
        metadata.reason_code !== null)
    ) {
      context.addIssue({
        code: 'custom',
        message: 'unverified cache metadata is inconsistent',
      });
    }
    if (
      metadata.state === 'pending' &&
      (metadata.result_hash !== null ||
        metadata.verification_evidence_hash !== null ||
        metadata.reason_code !== null)
    ) {
      context.addIssue({
        code: 'custom',
        message: 'pending cache metadata is inconsistent',
      });
    }
    if (
      metadata.state === 'negative' &&
      (metadata.result_hash !== null ||
        metadata.verification_evidence_hash !== null ||
        metadata.reason_code === null)
    ) {
      context.addIssue({
        code: 'custom',
        message: 'negative cache metadata is inconsistent',
      });
    }
    if (metadata.state === 'quarantined' && metadata.reason_code === null) {
      context.addIssue({
        code: 'custom',
        message: 'quarantined cache metadata requires a reason code',
      });
    }
    const expectedNamespace =
      metadata.state === 'negative'
        ? 'negative'
        : metadata.state === 'verified'
          ? 'verified-artifact'
          : metadata.state === 'quarantined'
            ? metadata.namespace
            : 'provider-request';
    if (metadata.namespace !== expectedNamespace) {
      context.addIssue({
        code: 'custom',
        path: ['namespace'],
        message: 'cache namespace is inconsistent with state',
      });
    }
    if (
      metadata.data_class === 'sensitive' &&
      metadata.persistent &&
      (metadata.input_protection !== 'hmac-sha256' ||
        !metadata.sensitive_persistence_approved)
    ) {
      context.addIssue({
        code: 'custom',
        message: 'sensitive persistent metadata is not HMAC-protected',
      });
    }
    if (
      metadata.data_class !== 'sensitive' &&
      metadata.sensitive_persistence_approved
    ) {
      context.addIssue({
        code: 'custom',
        message: 'sensitive approval is invalid for this data class',
      });
    }
  });

export type DataClass = 'public' | 'internal' | 'sensitive' | 'secret';
export type CacheKeyInput = z.input<typeof cacheKeyInputSchema>;
export type CacheMetadata = z.infer<typeof cacheMetadataSchema>;

export interface HmacSha256Provider {
  digest(value: Uint8Array): string;
}

export class CacheSecurityError extends Error {
  public constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'CacheSecurityError';
  }
}

export class CacheValidationError extends Error {
  public constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'CacheValidationError';
  }
}

export function buildApprovedInputHash(options: {
  readonly dataClass: DataClass;
  readonly value: Uint8Array;
  readonly persistent: boolean;
  readonly sensitivePersistenceApproved?: boolean;
  readonly hmac?: HmacSha256Provider;
}): string {
  if (!(options.value instanceof Uint8Array)) {
    throw new CacheValidationError('Cache input must be bytes');
  }
  if (options.dataClass === 'secret') {
    throw new CacheSecurityError('Secret data is never cacheable');
  }
  if (
    !['public', 'internal', 'sensitive'].includes(options.dataClass)
  ) {
    throw new CacheValidationError('Cache data class is invalid');
  }

  if (options.dataClass === 'sensitive' && options.persistent) {
    if (!options.sensitivePersistenceApproved || options.hmac === undefined) {
      throw new CacheSecurityError(
        'Sensitive persistent caching requires approval and injected HMAC',
      );
    }
    let digest: string;
    try {
      digest = options.hmac.digest(options.value);
    } catch (error) {
      throw new CacheSecurityError('Injected HMAC failed', { cause: error });
    }
    if (!/^[a-f0-9]{64}$/u.test(digest)) {
      throw new CacheSecurityError('Injected HMAC returned an invalid digest');
    }
    return digest;
  }

  return sha256(options.value);
}

export function buildCacheKey(input: CacheKeyInput): string {
  assertCacheValueHasNoSecrets(input, 'cache key input');
  const result = cacheKeyInputSchema.safeParse(input);
  if (!result.success) {
    throw new CacheValidationError('Cache key input failed strict validation');
  }
  return sha256(canonicalize(result.data));
}

export function parseCacheMetadata(value: unknown): CacheMetadata {
  assertCacheValueHasNoSecrets(value, 'cache metadata');
  const result = cacheMetadataSchema.safeParse(value);
  if (!result.success) {
    throw new CacheValidationError('Cache metadata failed strict validation');
  }
  return deepFreeze(result.data);
}

function assertCacheValueHasNoSecrets(value: unknown, label: string): void {
  try {
    assertNoSecretLikeValues(value, label);
  } catch (error) {
    if (error instanceof ConfigValidationError) {
      throw new CacheSecurityError(`${label} contains prohibited data`, {
        cause: error,
      });
    }
    throw error;
  }
}

export function isVerifiedCacheHit(
  metadata: CacheMetadata,
  now: Date,
): boolean {
  if (!Number.isFinite(now.getTime())) {
    return false;
  }
  return (
    metadata.state === 'verified' &&
    metadata.result_hash !== null &&
    metadata.verification_evidence_hash !== null &&
    Date.parse(metadata.expires_at) > now.getTime()
  );
}

function deepFreeze<T>(value: T): T {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) {
    return value;
  }
  for (const child of Object.values(value)) {
    deepFreeze(child);
  }
  return Object.freeze(value);
}
