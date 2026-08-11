import {
  buildClearCachePayload,
  deriveCacheKeyForEntry,
  finalizeCacheEntry,
  type CacheEntry,
  type CacheEntryInput,
} from '../src/cache-entry.js';

export const shaA = 'a'.repeat(64);
export const shaB = 'b'.repeat(64);
export const shaC = 'c'.repeat(64);
export const shaD = 'd'.repeat(64);

export function makePendingInput(
  overrides: Partial<CacheEntryInput> = {},
): CacheEntryInput {
  const candidate: CacheEntryInput = {
    schema_version: 1,
    entry_id: 'pending-1',
    task_id: 'task-1',
    parent_entry_hash: null,
    cache_key: shaB,
    namespace: 'provider-request',
    state: 'pending',
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
      producer_kind: 'runtime',
      producer_id: 'coordinator',
      source_cache_key: null,
      source_entry_hash: null,
      write_event_id: 'cache-write-pending-1',
    },
    data_class: 'internal',
    input_protection: 'sha256',
    sensitive_persistence_approved: false,
    data_policy_hash: shaD,
    tool_versions: { node: '24.18.0' },
    dependency_versions: { zod: '4.4.3' },
    payload: null,
    verification_evidence: null,
    outcome_reason: null,
    ...overrides,
  };
  return overrides.cache_key === undefined
    ? { ...candidate, cache_key: deriveCacheKeyForEntry(candidate) }
    : candidate;
}

export function makeUnverifiedInput(
  parent: CacheEntry,
  overrides: Partial<CacheEntryInput> = {},
): CacheEntryInput {
  const candidate: CacheEntryInput = {
    ...makePendingInput(),
    task_id: parent.task_id,
    cache_key: parent.cache_key,
    task_type: parent.task_type,
    route: parent.route,
    provider: parent.provider,
    model_revision: parent.model_revision,
    prompt_version: parent.prompt_version,
    policy_version: parent.policy_version,
    config_hash: parent.config_hash,
    verification_profile_hash: parent.verification_profile_hash,
    task_spec_hash: parent.task_spec_hash,
    input_hashes: parent.input_hashes,
    diff_hash: parent.diff_hash,
    error_fingerprint: parent.error_fingerprint,
    patch_hash: parent.patch_hash,
    data_class: parent.data_class,
    input_protection: parent.input_protection,
    sensitive_persistence_approved:
      parent.sensitive_persistence_approved,
    data_policy_hash: parent.data_policy_hash,
    tool_versions: parent.tool_versions,
    dependency_versions: parent.dependency_versions,
    entry_id: 'unverified-1',
    parent_entry_hash: parent.entry_hash,
    state: 'unverified',
    provenance: {
      ...parent.provenance,
      producer_kind: 'provider',
      producer_id: 'local-ai',
      source_cache_key: parent.cache_key,
      source_entry_hash: parent.entry_hash,
      write_event_id: 'cache-write-unverified-1',
    },
    payload: buildClearCachePayload({
      resultKind: 'structured-result',
      value: { answer: 'ok' },
      maxBytes: 512,
    }),
    ...overrides,
  };
  return overrides.cache_key === undefined
    ? { ...candidate, cache_key: deriveCacheKeyForEntry(candidate) }
    : candidate;
}

export function makeUnverifiedEntry(
  overrides: Partial<CacheEntryInput> = {},
): CacheEntry {
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
      value: { answer: 'ok' },
      maxBytes: 512,
    }),
    verification_evidence: null,
    outcome_reason: null,
    ...overrides,
  };
  return finalizeCacheEntry(
    overrides.cache_key === undefined
      ? { ...candidate, cache_key: deriveCacheKeyForEntry(candidate) }
      : candidate,
  );
}
