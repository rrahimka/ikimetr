import type { LedgerEvent } from './ledger-events.js';
import type { ApprovalScope, RoutingRoute } from './routing-contracts.js';
import type { ProviderId } from './schemas.js';

export type ProviderHealthState =
  | 'healthy'
  | 'degraded'
  | 'unavailable'
  | 'unknown';
export type EffectiveApprovalState =
  | 'approved'
  | 'denied'
  | 'revoked'
  | 'missing';

export interface RoutingAttemptEvidence {
  readonly attempt_id: string;
  readonly route: RoutingRoute;
  readonly request_fingerprint: string;
  readonly status: 'completed' | 'failed' | 'blocked' | 'cancelled';
  readonly patch_hash: string | null;
  readonly error_fingerprint: string | null;
  readonly escalation_reason: string | null;
  readonly verification_evidence_hashes: readonly string[];
}

export interface RoutingState {
  readonly task_id: string;
  readonly provider_health: Readonly<Record<string, ProviderHealthState>>;
  readonly approvals: Readonly<
    Record<string, Exclude<EffectiveApprovalState, 'missing'>>
  >;
  readonly attempts: readonly RoutingAttemptEvidence[];
}

export function deriveRoutingState(
  events: readonly LedgerEvent[],
  taskId: string,
): RoutingState {
  const providerHealth: Record<string, ProviderHealthState> = {};
  const approvals: Record<
    string,
    Exclude<EffectiveApprovalState, 'missing'>
  > = {};
  const starts = new Map<
    string,
    Extract<LedgerEvent, { event_type: 'AttemptStarted' }>
  >();
  const verificationHashes = new Map<string, string[]>();

  for (const event of events) {
    if (event.event_type === 'ProviderHealthEvent') {
      providerHealth[healthKey(event.provider, event.model)] =
        normalizeHealth(event.status);
      continue;
    }
    if (event.event_type === 'ApprovalEvent' && event.task_id === taskId) {
      approvals[event.scope] = event.decision;
      continue;
    }
    if (event.event_type === 'AttemptStarted' && event.task_id === taskId) {
      starts.set(event.attempt_id, event);
      continue;
    }
    if (event.event_type === 'VerificationEvent') {
      const hashes = verificationHashes.get(event.attempt_id) ?? [];
      hashes.push(event.evidence_hash);
      verificationHashes.set(event.attempt_id, hashes);
    }
  }

  const attempts: RoutingAttemptEvidence[] = [];
  for (const event of events) {
    if (event.event_type !== 'AttemptCompleted' || event.task_id !== taskId) {
      continue;
    }
    const started = starts.get(event.attempt_id);
    if (started === undefined) {
      continue;
    }
    attempts.push(
      deepFreeze({
        attempt_id: event.attempt_id,
        route: started.route,
        request_fingerprint: started.request_fingerprint,
        status: event.status,
        patch_hash: event.patch_hash,
        error_fingerprint: event.error_fingerprint,
        escalation_reason: event.escalation_reason,
        verification_evidence_hashes: [
          ...(verificationHashes.get(event.attempt_id) ?? []),
        ].sort(),
      }),
    );
  }

  return deepFreeze({
    task_id: taskId,
    provider_health: sortRecord(providerHealth),
    approvals: sortRecord(approvals),
    attempts,
  });
}

export function getProviderHealth(
  state: RoutingState,
  provider: ProviderId,
  model: string,
): ProviderHealthState {
  return state.provider_health[healthKey(provider, model)] ?? 'unknown';
}

export function getApprovalState(
  state: RoutingState,
  scope: ApprovalScope,
): EffectiveApprovalState {
  return state.approvals[scope] ?? 'missing';
}

export function hasRouteInsufficiency(
  state: RoutingState,
  route: 'local' | 'cheap-cloud',
  requestHash?: string,
): boolean {
  const requiredReason =
    route === 'local' ? 'local-insufficient' : 'cheap-insufficient';
  return state.attempts.some(
    (attempt) =>
      attempt.route === route &&
      (requestHash === undefined ||
        attempt.request_fingerprint === requestHash) &&
      (attempt.status === 'failed' || attempt.status === 'blocked') &&
      attempt.escalation_reason === requiredReason,
  );
}

export function hasRepeatedFailure(
  state: RoutingState,
  input: {
    readonly error_fingerprint: string | null;
    readonly current_diff_hash: string | null;
    readonly request_hash?: string;
  },
): boolean {
  if (
    input.error_fingerprint === null ||
    input.current_diff_hash === null
  ) {
    return false;
  }
  const matching = state.attempts.filter(
    (attempt) =>
      (attempt.status === 'failed' || attempt.status === 'blocked') &&
      attempt.error_fingerprint === input.error_fingerprint &&
      attempt.patch_hash === input.current_diff_hash &&
      (input.request_hash === undefined ||
        attempt.request_fingerprint === input.request_hash),
  );
  if (matching.length < 2) {
    return false;
  }
  const previous = matching.at(-2)!;
  const latest = matching.at(-1)!;
  return (
    previous.route === latest.route &&
    previous.verification_evidence_hashes.join('|') ===
    latest.verification_evidence_hashes.join('|')
  );
}

function normalizeHealth(
  status: Extract<
    LedgerEvent,
    { event_type: 'ProviderHealthEvent' }
  >['status'],
): ProviderHealthState {
  if (status === 'healthy') {
    return 'healthy';
  }
  if (status === 'unavailable') {
    return 'unavailable';
  }
  return 'degraded';
}

function healthKey(provider: ProviderId, model: string): string {
  return `${provider}|${model}`;
}

function sortRecord<Value>(
  value: Readonly<Record<string, Value>>,
): Readonly<Record<string, Value>> {
  return Object.fromEntries(
    Object.entries(value).sort(([left], [right]) =>
      left < right ? -1 : left > right ? 1 : 0,
    ),
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
