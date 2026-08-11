import {
  assertAllowedCacheTransition,
  type CacheEntry,
  type CacheEntryInput,
  type CacheState,
  deriveCacheKeyForEntry,
  finalizeCacheEntry,
  openSealedCachePayload,
  parseCacheEntry,
  type SensitiveCacheCodec,
} from './cache-entry.js';
import type { HmacSha256Provider } from './cache.js';
import { CacheStorage } from './cache-storage.js';
import { canonicalize } from './canonical.js';
import { AccountingLedger } from './ledger.js';
import type { LedgerEvent } from './ledger-events.js';
import type { ConfigSnapshot } from './snapshot.js';
import {
  SingleFlight,
  type SingleFlightResult,
} from './single-flight.js';
import {
  type VerificationEvidence,
  validateVerificationEvidence,
} from './verification-evidence.js';
import { randomUUID } from 'node:crypto';

export interface VerificationAuthority {
  readonly authorityId: string;
  readonly authorityVersion: string;
  authorize(evidence: VerificationEvidence): boolean | Promise<boolean>;
}

export interface CacheCompatibilityContext {
  readonly cache_key: string;
  readonly task_id: string;
  readonly task_type: string;
  readonly route: CacheEntry['route'];
  readonly provider: CacheEntry['provider'];
  readonly model_revision: string;
  readonly prompt_version: string;
  readonly policy_version: string;
  readonly config_hash: string;
  readonly verification_profile_hash: string;
  readonly task_spec_hash: string;
  readonly input_hashes: readonly string[];
  readonly diff_hash: string | null;
  readonly error_fingerprint: string | null;
  readonly data_class: CacheEntry['data_class'];
  readonly input_protection: CacheEntry['input_protection'];
  readonly data_policy_hash: string;
  readonly tool_versions: Readonly<Record<string, string>>;
  readonly dependency_versions: Readonly<Record<string, string>>;
}

export type VerifiedCacheLookup = Readonly<{
  status: 'hit' | 'miss' | 'invalidated' | 'quarantined';
  entry: CacheEntry | null;
  value: unknown | null;
}>;

export interface NegativeCachePolicy {
  readonly ttlMs: number | null;
  readonly allowedTransientReasonCodes: readonly string[];
}

export type NegativeCacheLookup = Readonly<{
  status: 'negative-hit' | 'miss' | 'invalidated' | 'quarantined';
  entry: CacheEntry | null;
  reason_code: string | null;
}>;

export type CacheInspection = Readonly<{
  status: 'empty' | 'ready' | 'quarantined';
  head: CacheEntry | null;
  reusable_verified: boolean;
}>;

export class CacheRuntimeError extends Error {
  public constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'CacheRuntimeError';
  }
}

export class VerifiedCacheRuntime {
  private readonly singleFlight = new SingleFlight<unknown>();

  private constructor(
    private readonly storage: CacheStorage,
    private readonly ledger: AccountingLedger,
    private readonly cacheEvents: Map<string, CacheEvent>,
    private readonly approvalDecisions: ReadonlyMap<string, 'approved' | 'denied' | 'revoked'>,
    private readonly configSnapshot?: ConfigSnapshot,
    private readonly verificationAuthority?: VerificationAuthority,
    private readonly sensitiveCodec?: SensitiveCacheCodec,
    private readonly hmac?: HmacSha256Provider,
    private readonly maxSensitivePayloadBytes?: number | null,
    private readonly negativePolicy?: NegativeCachePolicy,
  ) {}

  public static async open(options: {
    readonly repositoryRoot: string;
    readonly ledger?: AccountingLedger;
    readonly configSnapshot?: ConfigSnapshot;
    readonly verificationAuthority?: VerificationAuthority;
    readonly sensitiveCodec?: SensitiveCacheCodec;
    readonly hmac?: HmacSha256Provider;
    readonly maxSensitivePayloadBytes?: number | null;
    readonly negativePolicy?: NegativeCachePolicy;
  }): Promise<VerifiedCacheRuntime> {
    if (
      options.maxSensitivePayloadBytes !== undefined &&
      options.maxSensitivePayloadBytes !== null &&
      (!Number.isSafeInteger(options.maxSensitivePayloadBytes) ||
        options.maxSensitivePayloadBytes <= 0)
    ) {
      throw new CacheRuntimeError(
        'Sensitive payload byte ceiling must be a positive safe integer',
      );
    }
    const ledger = options.ledger ?? (await AccountingLedger.open(options.repositoryRoot));
    const events = await ledger.replay();
    const cacheEvents = new Map<string, CacheEvent>();
    const approvalDecisions = new Map<
      string,
      'approved' | 'denied' | 'revoked'
    >();
    for (const event of events) {
      if (event.event_type === 'CacheEvent') {
        cacheEvents.set(event.event_id, event);
      } else if (event.event_type === 'ApprovalEvent') {
        approvalDecisions.set(
          `${event.task_id}:${event.scope}`,
          event.decision,
        );
      }
    }
    return new VerifiedCacheRuntime(
      await CacheStorage.open(options.repositoryRoot),
      ledger,
      cacheEvents,
      approvalDecisions,
      options.configSnapshot,
      options.verificationAuthority,
      options.sensitiveCodec,
      options.hmac,
      options.maxSensitivePayloadBytes,
      options.negativePolicy,
    );
  }

  public async begin(input: CacheEntryInput): Promise<CacheEntry> {
    const entry = finalizeCacheEntry(input);
    this.assertPersistentDataPolicy(entry);
    if (entry.state !== 'pending') {
      throw new CacheRuntimeError('Cache lineage must begin in pending state');
    }
    const current = await this.inspect(entry.namespace, entry.cache_key);
    if (current.status !== 'empty') {
      throw new CacheRuntimeError('Cache lineage already exists');
    }
    assertAllowedCacheTransition(null, entry.state);
    await this.persistEntry(entry);
    return entry;
  }

  public async storeUnverified(
    source: CacheEntry,
    input: CacheEntryInput,
  ): Promise<CacheEntry> {
    const parent = parseCacheEntry(source);
    const entry = finalizeCacheEntry(input);
    this.assertPersistentDataPolicy(entry);
    if (entry.state !== 'unverified') {
      throw new CacheRuntimeError(
        'Provider result must enter cache as unverified',
      );
    }
    const current = await this.inspect(parent.namespace, parent.cache_key);
    if (
      current.status !== 'ready' ||
      current.head?.entry_hash !== parent.entry_hash
    ) {
      throw new CacheRuntimeError('Cache parent is not the unique lineage head');
    }
    assertChildOf(parent, entry);
    await this.assertNoTerminalSibling(entry, 'negative');
    try {
      assertAllowedCacheTransition(parent.state, entry.state);
    } catch (error) {
      throw new CacheRuntimeError('Cache state transition is not allowed', {
        cause: error,
      });
    }
    await this.persistEntry(entry);
    return entry;
  }

  public async inspect(
    namespace: CacheEntry['namespace'],
    cacheKey: string,
  ): Promise<CacheInspection> {
    const revisions = await this.storage.readRevisions(namespace, cacheKey);
    if (revisions.length === 0) {
      return Object.freeze({
        status: 'empty' as const,
        head: null,
        reusable_verified: false,
      });
    }

    const head = resolveUniqueHead(revisions, namespace);
    if (head === null) {
      return Object.freeze({
        status: 'quarantined' as const,
        head: null,
        reusable_verified: false,
      });
    }
    return Object.freeze({
      status: head.state === 'quarantined' ? 'quarantined' : 'ready',
      head,
      reusable_verified: head.state === 'verified',
    });
  }

  public async publishVerified(
    source: CacheEntry,
    input: CacheEntryInput,
  ): Promise<CacheEntry> {
    const authority = this.verificationAuthority;
    const snapshot = this.configSnapshot;
    if (authority === undefined || snapshot === undefined) {
      throw new CacheRuntimeError(
        'Verified publication requires configured trusted verification',
      );
    }
    const parent = parseCacheEntry(source);
    const current = await this.inspect(parent.namespace, parent.cache_key);
    if (
      current.status !== 'ready' ||
      current.head?.entry_hash !== parent.entry_hash ||
      parent.state !== 'unverified'
    ) {
      throw new CacheRuntimeError(
        'Verified publication source is not the unique unverified head',
      );
    }
    const entry = finalizeCacheEntry(input);
    this.assertPersistentDataPolicy(entry);
    if (entry.state !== 'verified' || entry.namespace !== 'verified-artifact') {
      throw new CacheRuntimeError('Verified publication target is invalid');
    }
    assertPublishedFrom(parent, entry);
    assertAllowedCacheTransition(parent.state, entry.state);
    assertCompatibleEntries(parent, entry);
    await this.assertNoTerminalSibling(entry, 'negative');

    const evidence = entry.verification_evidence;
    if (evidence === null) {
      throw new CacheRuntimeError('Verified publication has no evidence');
    }
    const validatedEvidence = validateVerificationEvidence(evidence, {
      allowedCommandIds: enabledCommandIds(snapshot),
      expectedProfileHash: snapshot.sourceFileHashes['verification.json'],
      authorityId: authority.authorityId,
      authorityVersion: authority.authorityVersion,
    });
    if (!(await authority.authorize(validatedEvidence))) {
      throw new CacheRuntimeError(
        'Verification authority rejected the evidence',
      );
    }
    if (
      entry.config_hash !== snapshot.configHash ||
      entry.verification_profile_hash !==
        snapshot.sourceFileHashes['verification.json']
    ) {
      throw new CacheRuntimeError(
        'Verified publication is incompatible with config snapshot',
      );
    }
    const target = await this.inspect(entry.namespace, entry.cache_key);
    if (target.status !== 'empty') {
      throw new CacheRuntimeError('Verified cache lineage already exists');
    }
    await this.persistEntry(entry);
    return entry;
  }

  public async storeNegative(
    source: CacheEntry,
    input: CacheEntryInput,
  ): Promise<CacheEntry> {
    const parent = parseCacheEntry(source);
    const current = await this.inspect(parent.namespace, parent.cache_key);
    if (
      current.status !== 'ready' ||
      current.head?.entry_hash !== parent.entry_hash ||
      !['pending', 'unverified'].includes(parent.state)
    ) {
      throw new CacheRuntimeError(
        'Negative cache source is not the unique active lineage head',
      );
    }
    const entry = finalizeCacheEntry(input);
    if (
      entry.state !== 'negative' ||
      entry.namespace !== 'negative' ||
      entry.outcome_reason === null
    ) {
      throw new CacheRuntimeError('Negative cache target is invalid');
    }
    assertDerivedFrom(parent, entry);
    try {
      assertAllowedCacheTransition(parent.state, entry.state);
    } catch (error) {
      throw new CacheRuntimeError('Negative cache transition is not allowed', {
        cause: error,
      });
    }
    assertCompatibleMetadata(parent, entry);
    this.assertPersistentDataPolicy(entry);
    await this.assertNoTerminalSibling(entry, 'verified-artifact');

    const negativePolicy = this.negativePolicy;
    const ttlMs = negativePolicy?.ttlMs;
    if (
      negativePolicy === undefined ||
      ttlMs === null ||
      ttlMs === undefined ||
      !Number.isSafeInteger(ttlMs) ||
      ttlMs <= 0 ||
      Date.parse(entry.expires_at) - Date.parse(entry.created_at) > ttlMs
    ) {
      throw new CacheRuntimeError(
        'Negative cache TTL is disabled or exceeds its explicit ceiling',
      );
    }
    const reason = entry.outcome_reason;
    if (/^provider-(?:outage|unavailable)$/u.test(reason.code)) {
      throw new CacheRuntimeError(
        'Provider outage is not a cacheable task outcome',
      );
    }
    if (
      reason.transient &&
      !negativePolicy.allowedTransientReasonCodes.includes(reason.code)
    ) {
      throw new CacheRuntimeError(
        'Transient negative reason is not explicitly allowlisted',
      );
    }
    const target = await this.inspect(entry.namespace, entry.cache_key);
    if (target.status !== 'empty') {
      throw new CacheRuntimeError('Negative cache lineage already exists');
    }
    await this.persistEntry(entry);
    return entry;
  }

  public async lookupVerified(
    context: CacheCompatibilityContext,
    now: Date,
  ): Promise<VerifiedCacheLookup> {
    await this.appendCacheAction({
      action: 'lookup',
      cacheKey: context.cache_key,
      namespace: 'verified-artifact',
      entry: null,
      reasonCode: null,
    });
    if (!Number.isFinite(now.getTime())) {
      await this.appendCacheAction({
        action: 'invalidate',
        cacheKey: context.cache_key,
        namespace: 'verified-artifact',
        entry: null,
        reasonCode: 'invalid-time',
      });
      return Object.freeze({ status: 'invalidated', entry: null, value: null });
    }
    let inspection: CacheInspection;
    try {
      inspection = await this.inspect('verified-artifact', context.cache_key);
    } catch {
      await this.appendCacheAction({
        action: 'quarantine',
        cacheKey: context.cache_key,
        namespace: 'verified-artifact',
        entry: null,
        reasonCode: 'invalid-storage',
      });
      return Object.freeze({ status: 'quarantined', entry: null, value: null });
    }
    if (inspection.status === 'empty') {
      await this.appendCacheAction({
        action: 'miss',
        cacheKey: context.cache_key,
        namespace: 'verified-artifact',
        entry: null,
        reasonCode: 'not-found',
      });
      return Object.freeze({ status: 'miss', entry: null, value: null });
    }
    if (inspection.status === 'quarantined' || inspection.head === null) {
      await this.appendCacheAction({
        action: 'quarantine',
        cacheKey: context.cache_key,
        namespace: 'verified-artifact',
        entry: inspection.head,
        reasonCode: 'invalid-lineage',
      });
      return Object.freeze({ status: 'quarantined', entry: null, value: null });
    }
    const entry = inspection.head;
    try {
      await this.assertNoTerminalSibling(entry, 'negative');
    } catch {
      await this.appendCacheAction({
        action: 'quarantine',
        cacheKey: context.cache_key,
        namespace: 'verified-artifact',
        entry,
        reasonCode: 'terminal-conflict',
      });
      return Object.freeze({ status: 'quarantined', entry: null, value: null });
    }
    const authority = this.verificationAuthority;
    const snapshot = this.configSnapshot;
    if (
      entry.state !== 'verified' ||
      authority === undefined ||
      snapshot === undefined ||
      entry.verification_evidence === null
    ) {
      await this.appendCacheAction({
        action: 'invalidate',
        cacheKey: context.cache_key,
        namespace: 'verified-artifact',
        entry,
        reasonCode: 'verification-unavailable',
      });
      return Object.freeze({ status: 'invalidated', entry: null, value: null });
    }
    if (!this.hasMatchingWriteEvent(entry)) {
      await this.appendCacheAction({
        action: 'quarantine',
        cacheKey: context.cache_key,
        namespace: 'verified-artifact',
        entry,
        reasonCode: 'unaudited-entry',
      });
      return Object.freeze({ status: 'quarantined', entry: null, value: null });
    }
    if (
      Date.parse(entry.expires_at) <= now.getTime() ||
      !isCompatibleWithContext(entry, context) ||
      entry.config_hash !== snapshot.configHash ||
      entry.verification_profile_hash !==
        snapshot.sourceFileHashes['verification.json']
    ) {
      await this.appendCacheAction({
        action: 'invalidate',
        cacheKey: context.cache_key,
        namespace: 'verified-artifact',
        entry,
        reasonCode: 'incompatible',
      });
      return Object.freeze({ status: 'invalidated', entry: null, value: null });
    }
    let evidence: VerificationEvidence;
    try {
      evidence = validateVerificationEvidence(entry.verification_evidence, {
        allowedCommandIds: enabledCommandIds(snapshot),
        expectedProfileHash: entry.verification_profile_hash,
        authorityId: authority.authorityId,
        authorityVersion: authority.authorityVersion,
      });
    } catch {
      await this.appendCacheAction({
        action: 'quarantine',
        cacheKey: context.cache_key,
        namespace: 'verified-artifact',
        entry,
        reasonCode: 'invalid-evidence',
      });
      return Object.freeze({ status: 'quarantined', entry: null, value: null });
    }
    if (!(await authority.authorize(evidence))) {
      await this.appendCacheAction({
        action: 'quarantine',
        cacheKey: context.cache_key,
        namespace: 'verified-artifact',
        entry,
        reasonCode: 'authority-rejected',
      });
      return Object.freeze({ status: 'quarantined', entry: null, value: null });
    }
    let value: unknown;
    if (entry.payload?.protection === 'sealed') {
      try {
        this.assertPersistentDataPolicy(entry);
        value = await openSealedCachePayload(entry.payload, {
          codec: this.sensitiveCodec!,
          hmac: this.hmac!,
          maxBytes: this.maxSensitivePayloadBytes!,
        });
      } catch {
        await this.appendCacheAction({
          action: 'quarantine',
          cacheKey: context.cache_key,
          namespace: 'verified-artifact',
          entry,
          reasonCode: 'sensitive-open-failed',
        });
        return Object.freeze({
          status: 'quarantined',
          entry: null,
          value: null,
        });
      }
    } else {
      value = entry.payload?.value ?? null;
    }
    await this.appendCacheAction({
      action: 'hit',
      cacheKey: context.cache_key,
      namespace: 'verified-artifact',
      entry,
      reasonCode: null,
    });
    await this.appendCacheAction({
      action: 'verified-reuse',
      cacheKey: context.cache_key,
      namespace: 'verified-artifact',
      entry,
      reasonCode: null,
    });
    return Object.freeze({ status: 'hit', entry, value });
  }

  public async lookupNegative(
    context: CacheCompatibilityContext,
    now: Date,
  ): Promise<NegativeCacheLookup> {
    await this.appendCacheAction({
      action: 'lookup',
      cacheKey: context.cache_key,
      namespace: 'negative',
      entry: null,
      reasonCode: null,
    });
    if (!Number.isFinite(now.getTime())) {
      await this.appendCacheAction({
        action: 'invalidate',
        cacheKey: context.cache_key,
        namespace: 'negative',
        entry: null,
        reasonCode: 'invalid-time',
      });
      return Object.freeze({
        status: 'invalidated',
        entry: null,
        reason_code: null,
      });
    }
    let inspection: CacheInspection;
    try {
      inspection = await this.inspect('negative', context.cache_key);
    } catch {
      await this.appendCacheAction({
        action: 'quarantine',
        cacheKey: context.cache_key,
        namespace: 'negative',
        entry: null,
        reasonCode: 'invalid-storage',
      });
      return Object.freeze({
        status: 'quarantined',
        entry: null,
        reason_code: null,
      });
    }
    if (inspection.status === 'empty') {
      await this.appendCacheAction({
        action: 'miss',
        cacheKey: context.cache_key,
        namespace: 'negative',
        entry: null,
        reasonCode: 'not-found',
      });
      return Object.freeze({ status: 'miss', entry: null, reason_code: null });
    }
    if (inspection.status === 'quarantined' || inspection.head === null) {
      await this.appendCacheAction({
        action: 'quarantine',
        cacheKey: context.cache_key,
        namespace: 'negative',
        entry: inspection.head,
        reasonCode: 'invalid-lineage',
      });
      return Object.freeze({
        status: 'quarantined',
        entry: null,
        reason_code: null,
      });
    }
    const entry = inspection.head;
    try {
      await this.assertNoTerminalSibling(entry, 'verified-artifact');
    } catch {
      await this.appendCacheAction({
        action: 'quarantine',
        cacheKey: context.cache_key,
        namespace: 'negative',
        entry,
        reasonCode: 'terminal-conflict',
      });
      return Object.freeze({
        status: 'quarantined',
        entry: null,
        reason_code: null,
      });
    }
    if (
      entry.state !== 'negative' ||
      entry.outcome_reason === null ||
      !this.hasMatchingWriteEvent(entry)
    ) {
      await this.appendCacheAction({
        action: 'quarantine',
        cacheKey: context.cache_key,
        namespace: 'negative',
        entry,
        reasonCode: 'invalid-negative-entry',
      });
      return Object.freeze({
        status: 'quarantined',
        entry: null,
        reason_code: null,
      });
    }
    if (
      Date.parse(entry.expires_at) <= now.getTime() ||
      !isCompatibleWithContext(entry, context)
    ) {
      await this.appendCacheAction({
        action: 'invalidate',
        cacheKey: context.cache_key,
        namespace: 'negative',
        entry,
        reasonCode: 'expired-or-incompatible',
      });
      return Object.freeze({
        status: 'invalidated',
        entry: null,
        reason_code: null,
      });
    }
    await this.appendCacheAction({
      action: 'negative-hit',
      cacheKey: context.cache_key,
      namespace: 'negative',
      entry,
      reasonCode: entry.outcome_reason.code,
    });
    return Object.freeze({
      status: 'negative-hit',
      entry,
      reason_code: entry.outcome_reason.code,
    });
  }

  public coordinate<T>(
    cacheKey: string,
    operation: () => Promise<T>,
  ): Promise<SingleFlightResult<T>> {
    return this.singleFlight
      .run(cacheKey, operation)
      .then((result) => result as SingleFlightResult<T>);
  }

  private async persistEntry(entry: CacheEntry): Promise<void> {
    await this.storage.append(entry);
    const event: CacheEvent = {
      event_version: 1,
      event_id: entry.provenance.write_event_id,
      event_type: 'CacheEvent',
      occurred_at: new Date().toISOString(),
      cache_key: entry.cache_key,
      namespace: entry.namespace,
      action: 'write',
      entry_hash: entry.entry_hash,
      state: entry.state,
      result_hash: entry.result_hash,
      reason_code: entry.outcome_reason?.code ?? null,
    };
    const existing = this.cacheEvents.get(event.event_id);
    if (existing !== undefined) {
      if (canonicalize(existing) !== canonicalize(event)) {
        throw new CacheRuntimeError(
          'Cache write event conflicts with existing ledger state',
        );
      }
      return;
    }
    try {
      await this.ledger.append(event);
    } catch (error) {
      throw new CacheRuntimeError('Cache write audit append failed', {
        cause: error,
      });
    }
    this.cacheEvents.set(event.event_id, event);
  }

  private hasMatchingWriteEvent(entry: CacheEntry): boolean {
    const event = this.cacheEvents.get(entry.provenance.write_event_id);
    return (
      event?.action === 'write' &&
      event.cache_key === entry.cache_key &&
      event.namespace === entry.namespace &&
      event.entry_hash === entry.entry_hash &&
      event.state === entry.state &&
      event.result_hash === entry.result_hash
    );
  }

  private async assertNoTerminalSibling(
    entry: CacheEntry,
    namespace: 'verified-artifact' | 'negative',
  ): Promise<void> {
    const cacheKey = deriveCacheKeyForEntry({ ...entry, namespace });
    const sibling = await this.inspect(namespace, cacheKey);
    if (sibling.status !== 'empty') {
      throw new CacheRuntimeError(
        'Conflicting terminal cache outcome already exists',
      );
    }
  }

  private async appendCacheAction(options: {
    readonly action: Extract<
      CacheEvent['action'],
      | 'lookup'
      | 'hit'
      | 'miss'
      | 'invalidate'
      | 'quarantine'
      | 'negative-hit'
      | 'verified-reuse'
    >;
    readonly cacheKey: string;
    readonly namespace: CacheEntry['namespace'];
    readonly entry: CacheEntry | null;
    readonly reasonCode: string | null;
  }): Promise<void> {
    const event: CacheEvent = {
      event_version: 1,
      event_id: `cache-${randomUUID()}`,
      event_type: 'CacheEvent',
      occurred_at: new Date().toISOString(),
      cache_key: options.cacheKey,
      namespace: options.namespace,
      action: options.action,
      entry_hash: options.entry?.entry_hash ?? null,
      state: options.entry?.state ?? null,
      result_hash: options.entry?.result_hash ?? null,
      reason_code: options.reasonCode,
    };
    try {
      await this.ledger.append(event);
    } catch (error) {
      throw new CacheRuntimeError('Cache audit append failed', { cause: error });
    }
    this.cacheEvents.set(event.event_id, event);
  }

  private assertPersistentDataPolicy(entry: CacheEntry): void {
    if (entry.data_class !== 'sensitive') {
      return;
    }
    if (
      entry.input_protection !== 'hmac-sha256' ||
      !entry.sensitive_persistence_approved ||
      this.sensitiveCodec === undefined ||
      this.hmac === undefined ||
      this.maxSensitivePayloadBytes === undefined ||
      this.maxSensitivePayloadBytes === null ||
      !Number.isSafeInteger(this.maxSensitivePayloadBytes) ||
      this.maxSensitivePayloadBytes <= 0 ||
      this.approvalDecisions.get(`${entry.task_id}:sensitive-cache`) !==
        'approved'
    ) {
      throw new CacheRuntimeError(
        'Sensitive persistent cache is not explicitly approved and configured',
      );
    }
  }
}

type CacheEvent = Extract<LedgerEvent, { readonly event_type: 'CacheEvent' }>;

function resolveUniqueHead(
  revisions: readonly CacheEntry[],
  namespace: CacheEntry['namespace'],
): CacheEntry | null {
  const byHash = new Map(revisions.map((entry) => [entry.entry_hash, entry]));
  if (byHash.size !== revisions.length) {
    return null;
  }
  const roots = revisions.filter(
    (entry) =>
      entry.parent_entry_hash === null || !byHash.has(entry.parent_entry_hash),
  );
  if (roots.length !== 1) {
    return null;
  }

  const children = new Map<string, CacheEntry[]>();
  for (const entry of revisions) {
    if (entry.parent_entry_hash === null) {
      continue;
    }
    const parent = byHash.get(entry.parent_entry_hash);
    if (parent === undefined) {
      continue;
    }
    if (!isValidChild(parent, entry)) {
      return null;
    }
    const existing = children.get(parent.entry_hash) ?? [];
    existing.push(entry);
    children.set(parent.entry_hash, existing);
  }

  let current: CacheEntry = roots[0]!;
  const expectedRootState =
    namespace === 'provider-request'
      ? 'pending'
      : namespace === 'verified-artifact'
        ? 'verified'
        : 'negative';
  if (current === undefined || current.state !== expectedRootState) {
    return null;
  }
  let visited = 1;
  while (true) {
    const next: CacheEntry[] = children.get(current.entry_hash) ?? [];
    if (next.length === 0) {
      return visited === revisions.length ? current : null;
    }
    if (next.length !== 1) {
      return null;
    }
    const child: CacheEntry = next[0]!;
    current = child;
    visited += 1;
  }
}

function isValidChild(parent: CacheEntry, child: CacheEntry): boolean {
  try {
    assertChildOf(parent, child);
    assertAllowedCacheTransition(parent.state, child.state);
    return true;
  } catch {
    return false;
  }
}

function assertChildOf(parent: CacheEntry, child: CacheEntry): void {
  if (
    child.parent_entry_hash !== parent.entry_hash ||
    child.cache_key !== parent.cache_key ||
    child.namespace !== parent.namespace ||
    child.provenance.lineage_id !== parent.provenance.lineage_id ||
    child.provenance.source_cache_key !== parent.cache_key ||
    child.provenance.source_entry_hash !== parent.entry_hash
  ) {
    throw new CacheRuntimeError('Cache child provenance does not match parent');
  }
}

export function isTerminalCacheState(state: CacheState): boolean {
  return ['verified', 'negative', 'quarantined'].includes(state);
}

function assertPublishedFrom(parent: CacheEntry, child: CacheEntry): void {
  if (
    child.parent_entry_hash !== parent.entry_hash ||
    child.provenance.lineage_id !== parent.provenance.lineage_id ||
    child.provenance.source_cache_key !== parent.cache_key ||
    child.provenance.source_entry_hash !== parent.entry_hash ||
    child.provenance.producer_kind !== 'verification-authority'
  ) {
    throw new CacheRuntimeError(
      'Verified publication provenance does not match its source',
    );
  }
}

function assertDerivedFrom(parent: CacheEntry, child: CacheEntry): void {
  if (
    child.parent_entry_hash !== parent.entry_hash ||
    child.provenance.lineage_id !== parent.provenance.lineage_id ||
    child.provenance.source_cache_key !== parent.cache_key ||
    child.provenance.source_entry_hash !== parent.entry_hash
  ) {
    throw new CacheRuntimeError(
      'Derived cache outcome provenance does not match its source',
    );
  }
}

function assertCompatibleEntries(parent: CacheEntry, child: CacheEntry): void {
  assertCompatibleMetadata(parent, child);
  if (
    parent.result_hash !== child.result_hash ||
    canonicalize(parent.payload) !== canonicalize(child.payload)
  ) {
    throw new CacheRuntimeError('Verified publication changed its result');
  }
}

function assertCompatibleMetadata(parent: CacheEntry, child: CacheEntry): void {
  const fields: Array<keyof CacheCompatibilityContext> = [
    'task_type',
    'task_id',
    'route',
    'provider',
    'model_revision',
    'prompt_version',
    'policy_version',
    'config_hash',
    'verification_profile_hash',
    'task_spec_hash',
    'input_hashes',
    'diff_hash',
    'error_fingerprint',
    'data_class',
    'input_protection',
    'data_policy_hash',
    'tool_versions',
    'dependency_versions',
  ];
  for (const field of fields) {
    if (canonicalize(parent[field]) !== canonicalize(child[field])) {
      throw new CacheRuntimeError(
        'Verified publication changed compatibility metadata',
      );
    }
  }
}

function isCompatibleWithContext(
  entry: CacheEntry,
  context: CacheCompatibilityContext,
): boolean {
  const fields: Array<keyof CacheCompatibilityContext> = [
    'cache_key',
    'task_id',
    'task_type',
    'route',
    'provider',
    'model_revision',
    'prompt_version',
    'policy_version',
    'config_hash',
    'verification_profile_hash',
    'task_spec_hash',
    'input_hashes',
    'diff_hash',
    'error_fingerprint',
    'data_class',
    'input_protection',
    'data_policy_hash',
    'tool_versions',
    'dependency_versions',
  ];
  return fields.every(
    (field) => canonicalize(entry[field]) === canonicalize(context[field]),
  );
}

function enabledCommandIds(snapshot: ConfigSnapshot): readonly string[] {
  return Object.entries(snapshot.configuration.verification.commands)
    .filter(([, command]) => command.enabled)
    .map(([commandId]) => commandId);
}
