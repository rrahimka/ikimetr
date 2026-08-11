import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { finalizeCacheEntry } from '../src/cache-entry.js';
import {
  type CacheCompatibilityContext,
  CacheRuntimeError,
  type VerificationAuthority,
  VerifiedCacheRuntime,
} from '../src/cache-runtime.js';
import { CacheStorage } from '../src/cache-storage.js';
import { AccountingLedger } from '../src/ledger.js';
import { loadConfigSnapshot, type ConfigSnapshot } from '../src/snapshot.js';
import type { VerificationEvidenceInput } from '../src/verification-evidence.js';
import {
  makePendingInput,
  makeUnverifiedInput,
  shaB,
} from './cache-fixture.js';

async function temporaryRepository(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'ikimetr-cache-runtime-'));
}

const trustedAuthority: VerificationAuthority = {
  authorityId: 'trusted-test-pipeline',
  authorityVersion: 'authority-1',
  authorize: () => true,
};

async function configSnapshot(): Promise<ConfigSnapshot> {
  return loadConfigSnapshot(
    join(
      dirname(fileURLToPath(import.meta.url)),
      '..',
      '..',
      '..',
      'config',
      'ai-cost',
    ),
  );
}

function evidence(profileHash: string): VerificationEvidenceInput {
  return {
    schema_version: 1,
    required_stages: ['lint', 'typecheck'],
    completed_stages: ['lint', 'typecheck'],
    stages: [
      {
        stage_id: 'lint',
        command_id: 'lint',
        exit_code: 0,
        evidence_hash: '1'.repeat(64),
        tool_version: 'eslint-9',
        duration_ms: 10,
      },
      {
        stage_id: 'typecheck',
        command_id: 'typecheck',
        exit_code: 0,
        evidence_hash: '2'.repeat(64),
        tool_version: 'tsc-5',
        duration_ms: 20,
      },
    ],
    authority_id: trustedAuthority.authorityId,
    authority_version: trustedAuthority.authorityVersion,
    verification_profile_hash: profileHash,
    verified_at: '2026-08-09T10:30:00.000Z',
  };
}

describe('deterministic cache lineage', () => {
  it('persists a unique pending to unverified lineage head', async () => {
    const runtime = await VerifiedCacheRuntime.open({
      repositoryRoot: await temporaryRepository(),
    });
    const pending = await runtime.begin(makePendingInput());
    const unverified = await runtime.storeUnverified(
      pending,
      makeUnverifiedInput(pending),
    );

    const inspection = await runtime.inspect(
      'provider-request',
      pending.cache_key,
    );
    expect(inspection.status).toBe('ready');
    expect(inspection.head?.entry_hash).toBe(unverified.entry_hash);
    expect(inspection.head?.state).toBe('unverified');
    expect(inspection.reusable_verified).toBe(false);
  });

  it('quarantines competing children instead of selecting a winner', async () => {
    const repositoryRoot = await temporaryRepository();
    const storage = await CacheStorage.open(repositoryRoot);
    const pending = finalizeCacheEntry(makePendingInput());
    const left = finalizeCacheEntry(makeUnverifiedInput(pending));
    const right = finalizeCacheEntry(
      makeUnverifiedInput(pending, {
        entry_id: 'unverified-2',
        provenance: {
          ...left.provenance,
          write_event_id: 'cache-write-unverified-2',
        },
      }),
    );
    await storage.append(pending);
    await storage.append(left);
    await storage.append(right);

    const runtime = await VerifiedCacheRuntime.open({ repositoryRoot });
    const inspection = await runtime.inspect(
      'provider-request',
      pending.cache_key,
    );
    expect(inspection.status).toBe('quarantined');
    expect(inspection.head).toBeNull();
    expect(inspection.reusable_verified).toBe(false);
  });

  it('quarantines a child whose provenance does not match its parent', async () => {
    const repositoryRoot = await temporaryRepository();
    const storage = await CacheStorage.open(repositoryRoot);
    const pending = finalizeCacheEntry(makePendingInput());
    const invalidChild = finalizeCacheEntry(
      makeUnverifiedInput(pending, {
        provenance: {
          lineage_id: pending.provenance.lineage_id,
          producer_kind: 'provider',
          producer_id: 'local-ai',
          source_cache_key: pending.cache_key,
          source_entry_hash: shaB,
          write_event_id: 'cache-write-invalid-provenance',
        },
      }),
    );
    await storage.append(pending);
    await storage.append(invalidChild);

    const runtime = await VerifiedCacheRuntime.open({ repositoryRoot });
    expect(
      await runtime.inspect('provider-request', pending.cache_key),
    ).toMatchObject({ status: 'quarantined', head: null });
  });

  it('rejects storing a child from a stale or foreign parent', async () => {
    const runtime = await VerifiedCacheRuntime.open({
      repositoryRoot: await temporaryRepository(),
    });
    const pending = await runtime.begin(makePendingInput());
    const unverified = await runtime.storeUnverified(
      pending,
      makeUnverifiedInput(pending),
    );

    await expect(
      runtime.storeUnverified(pending, makeUnverifiedInput(pending)),
    ).rejects.toBeInstanceOf(CacheRuntimeError);
    await expect(
      runtime.storeUnverified(
        unverified,
        makeUnverifiedInput(unverified),
      ),
    ).rejects.toBeInstanceOf(CacheRuntimeError);
  });
});

describe('cache runtime single-flight', () => {
  it('suppresses duplicate work and clears after success or failure', async () => {
    const runtime = await VerifiedCacheRuntime.open({
      repositoryRoot: await temporaryRepository(),
    });
    let invocations = 0;
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const operation = async (): Promise<string> => {
      invocations += 1;
      await gate;
      return 'result';
    };

    const leader = runtime.coordinate(shaB, operation);
    const reused = runtime.coordinate(shaB, operation);
    release?.();
    expect(await leader).toEqual({ disposition: 'leader', value: 'result' });
    expect(await reused).toEqual({ disposition: 'reused', value: 'result' });
    expect(invocations).toBe(1);

    await expect(
      runtime.coordinate(shaB, async () => {
        throw new Error('expected failure');
      }),
    ).rejects.toThrow('expected failure');
    expect(
      await runtime.coordinate(shaB, async () => 'retry-result'),
    ).toEqual({ disposition: 'leader', value: 'retry-result' });
  });
});

describe('verified publication and compatibility', () => {
  async function prepare(withAuthority = true) {
    const snapshot = await configSnapshot();
    const profileHash = snapshot.sourceFileHashes['verification.json'];
    const repositoryRoot = await temporaryRepository();
    const ledger = await AccountingLedger.open(repositoryRoot);
    const runtime = await VerifiedCacheRuntime.open({
      repositoryRoot,
      ledger,
      configSnapshot: snapshot,
      ...(withAuthority ? { verificationAuthority: trustedAuthority } : {}),
    });
    const pending = await runtime.begin(
      makePendingInput({
        config_hash: snapshot.configHash,
        verification_profile_hash: profileHash,
      }),
    );
    const unverified = await runtime.storeUnverified(
      pending,
      makeUnverifiedInput(pending),
    );
    const verifiedInput = makeUnverifiedInput(unverified, {
      entry_id: 'verified-1',
      namespace: 'verified-artifact',
      state: 'verified',
      provenance: {
        ...unverified.provenance,
        producer_kind: 'verification-authority',
        producer_id: trustedAuthority.authorityId,
        source_cache_key: unverified.cache_key,
        source_entry_hash: unverified.entry_hash,
        write_event_id: 'cache-write-verified-1',
      },
      payload: unverified.payload,
      verification_evidence: evidence(profileHash),
    });
    return {
      runtime,
      snapshot,
      profileHash,
      unverified,
      verifiedInput,
      ledger,
      repositoryRoot,
    };
  }

  it('prevents verified publication without an injected trusted authority', async () => {
    const { runtime, unverified, verifiedInput } = await prepare(false);
    await expect(
      runtime.publishVerified(unverified, verifiedInput),
    ).rejects.toBeInstanceOf(CacheRuntimeError);
  });

  it('reuses only a verified, unexpired, fully compatible artifact', async () => {
    const { runtime, unverified, verifiedInput, ledger } = await prepare();
    const verified = await runtime.publishVerified(unverified, verifiedInput);
    const context: CacheCompatibilityContext = {
      cache_key: verified.cache_key,
      task_id: verified.task_id,
      task_type: verified.task_type,
      route: verified.route,
      provider: verified.provider,
      model_revision: verified.model_revision,
      prompt_version: verified.prompt_version,
      policy_version: verified.policy_version,
      config_hash: verified.config_hash,
      verification_profile_hash: verified.verification_profile_hash,
      task_spec_hash: verified.task_spec_hash,
      input_hashes: verified.input_hashes,
      diff_hash: verified.diff_hash,
      error_fingerprint: verified.error_fingerprint,
      data_class: verified.data_class,
      input_protection: verified.input_protection,
      data_policy_hash: verified.data_policy_hash,
      tool_versions: verified.tool_versions,
      dependency_versions: verified.dependency_versions,
    };

    const hit = await runtime.lookupVerified(
      context,
      new Date('2026-08-09T10:45:00.000Z'),
    );
    expect(hit.status).toBe('hit');
    expect(hit.entry?.entry_hash).toBe(verified.entry_hash);

    const expired = await runtime.lookupVerified(
      context,
      new Date('2026-08-09T11:00:00.000Z'),
    );
    expect(expired.status).toBe('invalidated');
    expect(expired.entry).toBeNull();

    const actions = (await ledger.replay())
      .filter((event) => event.event_type === 'CacheEvent')
      .map((event) => event.action);
    expect(actions).toEqual(
      expect.arrayContaining([
        'lookup',
        'hit',
        'verified-reuse',
        'invalidate',
      ]),
    );
  });

  it.each([
    ['policy_version', 'policy-2'],
    ['config_hash', 'f'.repeat(64)],
    ['prompt_version', 'prompt-2'],
    ['provider', 'qwen'],
    ['model_revision', 'model-2'],
    ['route', 'cheap-cloud'],
    ['task_id', 'task-2'],
    ['task_type', 'different-task-type'],
    ['task_spec_hash', 'f'.repeat(64)],
    ['diff_hash', 'f'.repeat(64)],
    ['error_fingerprint', 'f'.repeat(64)],
    ['verification_profile_hash', 'f'.repeat(64)],
    ['data_class', 'public'],
    ['input_protection', 'hmac-sha256'],
    ['data_policy_hash', 'f'.repeat(64)],
  ] as const)('invalidates after %s changes', async (field, changedValue) => {
    const { runtime, unverified, verifiedInput } = await prepare();
    const verified = await runtime.publishVerified(unverified, verifiedInput);
    const context: CacheCompatibilityContext = {
      cache_key: verified.cache_key,
      task_id: verified.task_id,
      task_type: verified.task_type,
      route: verified.route,
      provider: verified.provider,
      model_revision: verified.model_revision,
      prompt_version: verified.prompt_version,
      policy_version: verified.policy_version,
      config_hash: verified.config_hash,
      verification_profile_hash: verified.verification_profile_hash,
      task_spec_hash: verified.task_spec_hash,
      input_hashes: verified.input_hashes,
      diff_hash: verified.diff_hash,
      error_fingerprint: verified.error_fingerprint,
      data_class: verified.data_class,
      input_protection: verified.input_protection,
      data_policy_hash: verified.data_policy_hash,
      tool_versions: verified.tool_versions,
      dependency_versions: verified.dependency_versions,
      [field]: changedValue,
    };
    const result = await runtime.lookupVerified(
      context,
      new Date('2026-08-09T10:45:00.000Z'),
    );
    expect(result.status).toBe('invalidated');
    expect(result.entry).toBeNull();
  });

  it('invalidates after input, tool, or dependency versions change', async () => {
    const { runtime, unverified, verifiedInput } = await prepare();
    const verified = await runtime.publishVerified(unverified, verifiedInput);
    const base: CacheCompatibilityContext = {
      cache_key: verified.cache_key,
      task_id: verified.task_id,
      task_type: verified.task_type,
      route: verified.route,
      provider: verified.provider,
      model_revision: verified.model_revision,
      prompt_version: verified.prompt_version,
      policy_version: verified.policy_version,
      config_hash: verified.config_hash,
      verification_profile_hash: verified.verification_profile_hash,
      task_spec_hash: verified.task_spec_hash,
      input_hashes: verified.input_hashes,
      diff_hash: verified.diff_hash,
      error_fingerprint: verified.error_fingerprint,
      data_class: verified.data_class,
      input_protection: verified.input_protection,
      data_policy_hash: verified.data_policy_hash,
      tool_versions: verified.tool_versions,
      dependency_versions: verified.dependency_versions,
    };
    for (const changed of [
      { ...base, input_hashes: ['f'.repeat(64)] },
      { ...base, tool_versions: { node: '25.0.0' } },
      { ...base, dependency_versions: { zod: '5.0.0' } },
    ]) {
      const result = await runtime.lookupVerified(
        changed,
        new Date('2026-08-09T10:45:00.000Z'),
      );
      expect(result.status).toBe('invalidated');
    }
  });

  it('quarantines a structurally valid revision without its write event', async () => {
    const { snapshot, profileHash, unverified, verifiedInput } = await prepare();
    const unaudited = finalizeCacheEntry(verifiedInput);
    const repositoryRoot = await temporaryRepository();
    const storage = await CacheStorage.open(repositoryRoot);
    await storage.append(unaudited);
    const ledger = await AccountingLedger.open(repositoryRoot);
    const runtime = await VerifiedCacheRuntime.open({
      repositoryRoot,
      ledger,
      configSnapshot: snapshot,
      verificationAuthority: trustedAuthority,
    });
    const context: CacheCompatibilityContext = {
      cache_key: unaudited.cache_key,
      task_id: unaudited.task_id,
      task_type: unaudited.task_type,
      route: unaudited.route,
      provider: unaudited.provider,
      model_revision: unaudited.model_revision,
      prompt_version: unaudited.prompt_version,
      policy_version: unaudited.policy_version,
      config_hash: unaudited.config_hash,
      verification_profile_hash: profileHash,
      task_spec_hash: unaudited.task_spec_hash,
      input_hashes: unaudited.input_hashes,
      diff_hash: unaudited.diff_hash,
      error_fingerprint: unaudited.error_fingerprint,
      data_class: unaudited.data_class,
      input_protection: unaudited.input_protection,
      data_policy_hash: unaudited.data_policy_hash,
      tool_versions: unaudited.tool_versions,
      dependency_versions: unaudited.dependency_versions,
    };

    const result = await runtime.lookupVerified(
      context,
      new Date('2026-08-09T10:45:00.000Z'),
    );
    expect(result.status).toBe('quarantined');
    expect(result.entry).toBeNull();
    expect(
      (await ledger.replay()).some(
        (event) =>
          event.event_type === 'CacheEvent' &&
          event.action === 'quarantine',
      ),
    ).toBe(true);
    expect(unverified.state).toBe('unverified');
  });

  it('quarantines a verified revision with a checksum mismatch', async () => {
    const {
      runtime,
      unverified,
      verifiedInput,
      repositoryRoot,
    } = await prepare();
    const verified = await runtime.publishVerified(unverified, verifiedInput);
    const revisionPath = join(
      repositoryRoot,
      '.ai-cost',
      'cache',
      'verified-artifact',
      verified.cache_key.slice(0, 2),
      verified.cache_key,
      `${verified.entry_hash}.json`,
    );
    await writeFile(
      revisionPath,
      JSON.stringify({ ...verified, result_hash: 'f'.repeat(64) }),
      'utf8',
    );

    const result = await runtime.lookupVerified(
      {
        cache_key: verified.cache_key,
        task_id: verified.task_id,
        task_type: verified.task_type,
        route: verified.route,
        provider: verified.provider,
        model_revision: verified.model_revision,
        prompt_version: verified.prompt_version,
        policy_version: verified.policy_version,
        config_hash: verified.config_hash,
        verification_profile_hash: verified.verification_profile_hash,
        task_spec_hash: verified.task_spec_hash,
        input_hashes: verified.input_hashes,
        diff_hash: verified.diff_hash,
        error_fingerprint: verified.error_fingerprint,
        data_class: verified.data_class,
        input_protection: verified.input_protection,
        data_policy_hash: verified.data_policy_hash,
        tool_versions: verified.tool_versions,
        dependency_versions: verified.dependency_versions,
      },
      new Date('2026-08-09T10:45:00.000Z'),
    );
    expect(result).toMatchObject({
      status: 'quarantined',
      entry: null,
      value: null,
    });
  });
});
