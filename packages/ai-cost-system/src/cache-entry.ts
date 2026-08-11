import { z } from 'zod';

import { buildCacheKey, type HmacSha256Provider } from './cache.js';
import { canonicalize, sha256 } from './canonical.js';
import { ConfigValidationError } from './errors.js';
import { assertNoSecretLikeValues, parseJsonStrict } from './json.js';
import {
  hashVerificationEvidence,
  parseVerificationEvidence,
  verificationEvidenceSchema,
} from './verification-evidence.js';

const sha256Hex = z.string().regex(/^[a-f0-9]{64}$/u);
const identifier = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u);
const boundedText = z.string().min(1).max(256);
const utcTimestamp = z.string().refine((value) => {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && value.endsWith('Z');
}, 'timestamp must use UTC');
const versionRecord = z.record(z.string().min(1).max(128), boundedText);
const cacheStateSchema = z.enum([
  'pending',
  'unverified',
  'verified',
  'negative',
  'quarantined',
]);

const clearPayloadSchema = z
  .object({
    protection: z.literal('clear'),
    result_kind: z.enum(['structured-result', 'patch', 'diagnostic']),
    value: z.unknown(),
    result_hash: sha256Hex,
  })
  .strict();

const sealedPayloadSchema = z
  .object({
    protection: z.literal('sealed'),
    result_kind: z.enum(['structured-result', 'patch', 'diagnostic']),
    codec_id: identifier,
    sealed_value_base64: z
      .string()
      .min(1)
      .max(16_777_216)
      .regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u),
    result_hash: sha256Hex,
  })
  .strict();

const payloadSchema = z.discriminatedUnion('protection', [
  clearPayloadSchema,
  sealedPayloadSchema,
]);

const provenanceSchema = z
  .object({
    lineage_id: identifier,
    producer_kind: z.enum(['runtime', 'provider', 'verification-authority']),
    producer_id: identifier,
    source_cache_key: sha256Hex.nullable(),
    source_entry_hash: sha256Hex.nullable(),
    write_event_id: identifier,
  })
  .strict();

const outcomeReasonSchema = z
  .object({
    code: identifier,
    transient: z.boolean(),
  })
  .strict();

const cacheEntryInputSchema = z
  .object({
    schema_version: z.literal(1),
    entry_id: identifier,
    task_id: identifier,
    parent_entry_hash: sha256Hex.nullable(),
    cache_key: sha256Hex,
    namespace: z.enum([
      'provider-request',
      'verified-artifact',
      'negative',
    ]),
    state: cacheStateSchema,
    task_type: identifier,
    route: z.enum(['deterministic', 'local', 'cheap-cloud', 'strong']),
    provider: z.enum([
      'local-ai',
      'deepseek',
      'qwen',
      'codex',
      'claude',
    ]),
    model_revision: boundedText,
    prompt_version: boundedText,
    policy_version: boundedText,
    config_hash: sha256Hex,
    verification_profile_hash: sha256Hex,
    task_spec_hash: sha256Hex,
    input_hashes: z.array(sha256Hex).max(256),
    diff_hash: sha256Hex.nullable(),
    error_fingerprint: sha256Hex.nullable(),
    patch_hash: sha256Hex.nullable(),
    created_at: utcTimestamp,
    expires_at: utcTimestamp,
    provenance: provenanceSchema,
    data_class: z.enum(['public', 'internal', 'sensitive']),
    input_protection: z.enum(['sha256', 'hmac-sha256']),
    sensitive_persistence_approved: z.boolean(),
    data_policy_hash: sha256Hex,
    tool_versions: versionRecord,
    dependency_versions: versionRecord,
    payload: payloadSchema.nullable(),
    verification_evidence: verificationEvidenceSchema.nullable(),
    outcome_reason: outcomeReasonSchema.nullable(),
  })
  .strict();

const cacheEntrySchema = cacheEntryInputSchema
  .extend({
    entry_hash: sha256Hex,
    result_hash: sha256Hex.nullable(),
    verification_evidence_hash: sha256Hex.nullable(),
  })
  .strict();

export type CacheState = z.infer<typeof cacheStateSchema>;
export type ClearCachePayload = z.infer<typeof clearPayloadSchema>;
export type SealedCachePayload = z.infer<typeof sealedPayloadSchema>;
export type CacheEntryInput = z.input<typeof cacheEntryInputSchema>;
export type CacheEntry = z.infer<typeof cacheEntrySchema>;

export class CacheEntryValidationError extends Error {
  public constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'CacheEntryValidationError';
  }
}

export class CacheEntrySecurityError extends Error {
  public constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'CacheEntrySecurityError';
  }
}

export interface SensitiveCacheCodec {
  readonly codecId: string;
  seal(value: Uint8Array): Promise<Uint8Array>;
  open(value: Uint8Array): Promise<Uint8Array>;
}

export function deriveCacheKeyForEntry(
  entry: Pick<
    CacheEntryInput,
    | 'namespace'
    | 'task_id'
    | 'task_type'
    | 'data_class'
    | 'data_policy_hash'
    | 'input_protection'
    | 'policy_version'
    | 'config_hash'
    | 'prompt_version'
    | 'route'
    | 'provider'
    | 'model_revision'
    | 'task_spec_hash'
    | 'input_hashes'
    | 'diff_hash'
    | 'error_fingerprint'
    | 'tool_versions'
    | 'dependency_versions'
    | 'verification_profile_hash'
  >,
): string {
  return buildCacheKey({
    namespace: entry.namespace,
    taskId: entry.task_id,
    taskType: entry.task_type,
    dataClass: entry.data_class,
    dataPolicyHash: entry.data_policy_hash,
    inputProtection: entry.input_protection,
    policyVersion: entry.policy_version,
    routingConfigHash: entry.config_hash,
    promptVersion: entry.prompt_version,
    route: entry.route,
    provider: entry.provider,
    modelRevision: entry.model_revision,
    taskSpecHash: entry.task_spec_hash,
    approvedInputHashes: entry.input_hashes,
    diffHash: entry.diff_hash,
    errorFingerprint: entry.error_fingerprint,
    toolVersions: entry.tool_versions,
    dependencyVersions: entry.dependency_versions,
    verificationProfileHash: entry.verification_profile_hash,
  });
}

function assertDerivedCacheKey(
  entry: Parameters<typeof deriveCacheKeyForEntry>[0] & {
    readonly cache_key: string;
  },
): void {
  if (entry.cache_key !== deriveCacheKeyForEntry(entry)) {
    throw new CacheEntryValidationError(
      'Cache key does not match the entry compatibility metadata',
    );
  }
}

export function buildClearCachePayload(options: {
  readonly resultKind: 'structured-result' | 'patch' | 'diagnostic';
  readonly value: unknown;
  readonly maxBytes: number;
}): ClearCachePayload {
  if (!Number.isSafeInteger(options.maxBytes) || options.maxBytes <= 0) {
    throw new CacheEntryValidationError(
      'Payload byte ceiling must be a positive safe integer',
    );
  }
  assertSafePayloadValue(options.value);
  const canonicalValue = canonicalize(options.value);
  if (Buffer.byteLength(canonicalValue, 'utf8') > options.maxBytes) {
    throw new CacheEntryValidationError('Cache payload exceeds its byte ceiling');
  }
  const value = JSON.parse(canonicalValue) as unknown;
  return deepFreeze({
    protection: 'clear' as const,
    result_kind: options.resultKind,
    value,
    result_hash: sha256(canonicalValue),
  });
}

export async function buildSealedCachePayload(options: {
  readonly resultKind: 'structured-result' | 'patch' | 'diagnostic';
  readonly value: unknown;
  readonly maxBytes: number;
  readonly codec: SensitiveCacheCodec;
  readonly hmac: HmacSha256Provider;
}): Promise<SealedCachePayload> {
  assertPayloadCeiling(options.maxBytes);
  if (
    options.codec === undefined ||
    typeof options.codec.codecId !== 'string' ||
    typeof options.codec.seal !== 'function' ||
    options.hmac === undefined ||
    typeof options.hmac.digest !== 'function'
  ) {
    throw new CacheEntrySecurityError(
      'Sensitive cache requires injected codec and HMAC',
    );
  }
  if (!identifier.safeParse(options.codec.codecId).success) {
    throw new CacheEntrySecurityError('Sensitive codec ID is invalid');
  }
  assertSealableSensitiveValue(options.value);
  const canonicalValue = canonicalize(options.value);
  const clearBytes = Buffer.from(canonicalValue, 'utf8');
  if (clearBytes.byteLength > options.maxBytes) {
    throw new CacheEntryValidationError('Cache payload exceeds its byte ceiling');
  }
  const resultHash = digestHmac(options.hmac, clearBytes);
  let sealed: Uint8Array;
  try {
    sealed = await options.codec.seal(clearBytes);
  } catch (error) {
    throw new CacheEntrySecurityError('Sensitive cache codec seal failed', {
      cause: error,
    });
  }
  if (!(sealed instanceof Uint8Array) || sealed.byteLength === 0) {
    throw new CacheEntrySecurityError(
      'Sensitive cache codec returned an invalid sealed value',
    );
  }
  return deepFreeze({
    protection: 'sealed' as const,
    result_kind: options.resultKind,
    codec_id: options.codec.codecId,
    sealed_value_base64: Buffer.from(sealed).toString('base64'),
    result_hash: resultHash,
  });
}

export async function openSealedCachePayload(
  payload: SealedCachePayload,
  options: Readonly<{
    codec: SensitiveCacheCodec;
    hmac: HmacSha256Provider;
    maxBytes: number;
  }>,
): Promise<unknown> {
  assertPayloadCeiling(options.maxBytes);
  const parsed = sealedPayloadSchema.safeParse(payload);
  if (!parsed.success) {
    throw new CacheEntryValidationError(
      'Sealed cache payload failed strict validation',
    );
  }
  if (
    options.codec === undefined ||
    options.hmac === undefined ||
    typeof options.codec.open !== 'function' ||
    typeof options.hmac.digest !== 'function' ||
    parsed.data.codec_id !== options.codec.codecId
  ) {
    throw new CacheEntrySecurityError(
      'Sensitive cache codec or HMAC is unavailable',
    );
  }
  const sealed = Buffer.from(parsed.data.sealed_value_base64, 'base64');
  let clear: Uint8Array;
  try {
    clear = await options.codec.open(sealed);
  } catch (error) {
    throw new CacheEntrySecurityError('Sensitive cache codec open failed', {
      cause: error,
    });
  }
  if (!(clear instanceof Uint8Array) || clear.byteLength > options.maxBytes) {
    throw new CacheEntrySecurityError(
      'Sensitive cache codec returned invalid plaintext',
    );
  }
  const canonicalValue = Buffer.from(clear).toString('utf8');
  let value: unknown;
  try {
    value = parseJsonStrict(canonicalValue, 'sealed cache payload');
  } catch (error) {
    throw new CacheEntrySecurityError(
      'Sensitive cache plaintext is not strict JSON',
      { cause: error },
    );
  }
  assertSealableSensitiveValue(value);
  if (
    canonicalize(value) !== canonicalValue ||
    digestHmac(options.hmac, clear) !== parsed.data.result_hash
  ) {
    throw new CacheEntrySecurityError(
      'Sensitive cache plaintext integrity check failed',
    );
  }
  return deepFreeze(value);
}

export function finalizeCacheEntry(input: CacheEntryInput): CacheEntry {
  const normalizedInput =
    input.verification_evidence === null
      ? input
      : {
          ...input,
          verification_evidence: parseVerificationEvidence(
            input.verification_evidence,
          ),
        };
  assertSafeEntryValue(normalizedInput);
  const parsed = cacheEntryInputSchema.safeParse(normalizedInput);
  if (!parsed.success) {
    throw new CacheEntryValidationError('Cache entry failed strict validation');
  }
  assertDerivedCacheKey(parsed.data);
  validateEntrySemantics(parsed.data);
  const withoutHash = {
    ...parsed.data,
    result_hash: parsed.data.payload?.result_hash ?? null,
    verification_evidence_hash:
      parsed.data.verification_evidence === null
        ? null
        : hashVerificationEvidence(parsed.data.verification_evidence),
  };
  const entry = {
    ...withoutHash,
    entry_hash: sha256(canonicalize(withoutHash)),
  };
  return parseCacheEntry(entry);
}

export function parseCacheEntry(value: unknown): CacheEntry {
  assertSafeEntryValue(value);
  const parsed = cacheEntrySchema.safeParse(value);
  if (!parsed.success) {
    throw new CacheEntryValidationError('Cache entry failed strict validation');
  }
  assertDerivedCacheKey(parsed.data);
  validateEntrySemantics(parsed.data);
  if (parsed.data.payload?.protection === 'clear') {
    assertSafePayloadValue(parsed.data.payload.value);
    const expectedResultHash = sha256(canonicalize(parsed.data.payload.value));
    if (
      parsed.data.payload.result_hash !== expectedResultHash ||
      parsed.data.result_hash !== expectedResultHash
    ) {
      throw new CacheEntryValidationError('Cache payload checksum mismatch');
    }
  } else if (
    parsed.data.payload?.protection === 'sealed' &&
    parsed.data.result_hash !== parsed.data.payload.result_hash
  ) {
    throw new CacheEntryValidationError('Sealed cache result hash mismatch');
  }
  if (parsed.data.verification_evidence !== null) {
    const evidence = parseVerificationEvidence(
      parsed.data.verification_evidence,
    );
    if (
      parsed.data.verification_evidence_hash !==
      hashVerificationEvidence(evidence)
    ) {
      throw new CacheEntryValidationError(
        'Cache verification evidence checksum mismatch',
      );
    }
  } else if (parsed.data.verification_evidence_hash !== null) {
    throw new CacheEntryValidationError(
      'Cache verification evidence hash is inconsistent',
    );
  }
  const { entry_hash: entryHash, ...withoutHash } = parsed.data;
  if (sha256(canonicalize(withoutHash)) !== entryHash) {
    throw new CacheEntryValidationError('Cache entry checksum mismatch');
  }
  return deepFreeze(parsed.data);
}

export function assertAllowedCacheTransition(
  from: CacheState | null,
  to: CacheState,
): void {
  const allowed =
    (from === null && to === 'pending') ||
    (from === 'pending' &&
      ['unverified', 'negative', 'quarantined'].includes(to)) ||
    (from === 'unverified' &&
      ['verified', 'negative', 'quarantined'].includes(to)) ||
    (from === 'verified' && to === 'quarantined') ||
    (from === 'negative' && to === 'quarantined');
  if (!allowed) {
    throw new CacheEntryValidationError('Cache state transition is not allowed');
  }
}

function validateEntrySemantics(
  entry: z.infer<typeof cacheEntryInputSchema> & {
    readonly result_hash?: string | null;
    readonly verification_evidence_hash?: string | null;
  },
): void {
  if (Date.parse(entry.expires_at) <= Date.parse(entry.created_at)) {
    throw new CacheEntryValidationError('Cache expiry must be after creation');
  }
  if (entry.data_class === 'sensitive') {
    if (
      !entry.sensitive_persistence_approved ||
      entry.input_protection !== 'hmac-sha256' ||
      entry.payload?.protection === 'clear'
    ) {
      throw new CacheEntrySecurityError(
        'Sensitive persistent cache requires approval, HMAC, and sealed payload',
      );
    }
  } else if (
    entry.sensitive_persistence_approved ||
    entry.payload?.protection === 'sealed'
  ) {
    throw new CacheEntrySecurityError(
      'Sensitive approval is invalid for a clear cache entry',
    );
  }

  const expectedNamespace =
    entry.state === 'verified'
      ? 'verified-artifact'
      : entry.state === 'negative'
        ? 'negative'
        : entry.state === 'quarantined'
          ? entry.namespace
          : 'provider-request';
  if (entry.namespace !== expectedNamespace) {
    throw new CacheEntryValidationError(
      'Cache namespace is inconsistent with state',
    );
  }

  if (entry.state === 'pending') {
    if (
      entry.payload !== null ||
      entry.verification_evidence !== null ||
      entry.outcome_reason !== null
    ) {
      throw new CacheEntryValidationError('Pending cache entry is inconsistent');
    }
    return;
  }
  if (entry.state === 'unverified') {
    if (
      entry.payload === null ||
      entry.verification_evidence !== null ||
      entry.outcome_reason !== null
    ) {
      throw new CacheEntryValidationError(
        'Unverified cache entry is inconsistent',
      );
    }
    return;
  }
  if (entry.state === 'verified') {
    if (
      entry.payload === null ||
      entry.verification_evidence === null ||
      entry.outcome_reason !== null ||
      entry.provenance.producer_kind !== 'verification-authority'
    ) {
      throw new CacheEntryValidationError(
        'Verified cache entry is inconsistent',
      );
    }
    return;
  }
  if (
    entry.payload !== null ||
    entry.verification_evidence !== null ||
    entry.outcome_reason === null
  ) {
    throw new CacheEntryValidationError(
      `${entry.state} cache entry is inconsistent`,
    );
  }
}

function assertSafeEntryValue(value: unknown): void {
  if (
    typeof value === 'object' &&
    value !== null &&
    'data_class' in value &&
    value.data_class === 'secret'
  ) {
    throw new CacheEntrySecurityError('Secret data is never cacheable');
  }
  try {
    assertNoSecretLikeValues(value, 'cache entry');
  } catch (error) {
    if (error instanceof ConfigValidationError) {
      throw new CacheEntrySecurityError('Cache entry contains prohibited data', {
        cause: error,
      });
    }
    throw error;
  }
  visitValues(value, (key) => {
    if (isForbiddenFieldName(key)) {
      throw new CacheEntrySecurityError(
        'Cache entry contains a prohibited raw-content field',
      );
    }
  });
}

function assertSafePayloadValue(value: unknown): void {
  try {
    assertNoSecretLikeValues(value, 'cache payload');
  } catch (error) {
    if (error instanceof ConfigValidationError) {
      throw new CacheEntrySecurityError(
        'Cache payload contains prohibited data',
        { cause: error },
      );
    }
    throw error;
  }

  visitValues(
    value,
    (key) => {
      if (isForbiddenFieldName(key)) {
        throw new CacheEntrySecurityError(
          'Cache payload contains a prohibited raw-content or PII field',
        );
      }
    },
    (text) => {
      if (/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/iu.test(text)) {
        throw new CacheEntrySecurityError(
          'Cache payload contains a prohibited PII-like value',
        );
      }
    },
  );
  assertCanonicalJsonValue(value);
}

function assertSealableSensitiveValue(value: unknown): void {
  try {
    assertNoSecretLikeValues(value, 'sensitive cache payload');
  } catch (error) {
    if (error instanceof ConfigValidationError) {
      throw new CacheEntrySecurityError(
        'Sensitive cache payload contains prohibited secret-like data',
        { cause: error },
      );
    }
    throw error;
  }
  visitValues(value, (key) => {
    if (/^(?:raw_?)?(?:prompt|logs?|source|env(?:ironment)?)$/iu.test(key)) {
      throw new CacheEntrySecurityError(
        'Sensitive cache payload contains prohibited raw content',
      );
    }
  });
  assertCanonicalJsonValue(value);
}

function assertPayloadCeiling(maxBytes: number): void {
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) {
    throw new CacheEntryValidationError(
      'Payload byte ceiling must be a positive safe integer',
    );
  }
}

function digestHmac(
  hmac: HmacSha256Provider,
  value: Uint8Array,
): string {
  let digest: string;
  try {
    digest = hmac.digest(value);
  } catch (error) {
    throw new CacheEntrySecurityError('Injected cache HMAC failed', {
      cause: error,
    });
  }
  if (!/^[a-f0-9]{64}$/u.test(digest)) {
    throw new CacheEntrySecurityError('Injected cache HMAC is invalid');
  }
  return digest;
}

function isForbiddenFieldName(key: string): boolean {
  return /^(?:raw_?)?(?:prompt|logs?|source|pii|email|phone|contact|env(?:ironment)?)$/iu.test(
    key,
  );
}

function visitValues(
  value: unknown,
  onKey: (key: string) => void,
  onString: (value: string) => void = () => undefined,
): void {
  const pending: unknown[] = [value];
  const visited = new WeakSet<object>();
  while (pending.length > 0) {
    const current = pending.pop();
    if (typeof current === 'string') {
      onString(current);
    } else if (Array.isArray(current)) {
      pending.push(...current);
    } else if (typeof current === 'object' && current !== null) {
      if (visited.has(current)) {
        throw new CacheEntryValidationError('Cache value contains a cycle');
      }
      visited.add(current);
      for (const [key, child] of Object.entries(current)) {
        onKey(key);
        pending.push(child);
      }
    }
  }
}

function assertCanonicalJsonValue(value: unknown): void {
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'boolean'
  ) {
    return;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new CacheEntryValidationError(
        'Cache payload contains a non-finite number',
      );
    }
    return;
  }
  if (Array.isArray(value)) {
    for (const child of value) {
      assertCanonicalJsonValue(child);
    }
    return;
  }
  if (typeof value === 'object') {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new CacheEntryValidationError(
        'Cache payload must contain plain JSON objects',
      );
    }
    for (const child of Object.values(value)) {
      assertCanonicalJsonValue(child);
    }
    return;
  }
  throw new CacheEntryValidationError(
    'Cache payload contains an unsupported JSON value',
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
