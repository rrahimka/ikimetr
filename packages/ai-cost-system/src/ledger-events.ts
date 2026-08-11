import { z } from 'zod';

import { ConfigValidationError } from './errors.js';
import { assertNoSecretLikeValues } from './json.js';
import { routingReasonCodes } from './routing-contracts.js';

const identifier = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:+/-]*$/u);
const reasonCode = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z][a-z0-9-]*$/u);
const sha256Hex = z.string().regex(/^[a-f0-9]{64}$/u);
const utcTimestamp = z
  .iso.datetime()
  .refine((value) => value.endsWith('Z'), 'timestamp must use UTC');
const safeNonNegativeInteger = z.number().int().nonnegative().safe();
const provider = z.enum([
  'local-ai',
  'deepseek',
  'qwen',
  'codex',
  'claude',
]);
const route = z.enum(['deterministic', 'local', 'cheap-cloud', 'strong']);
const money = z
  .object({
    currency: z.string().regex(/^[A-Z]{3}$/u),
    amountMicros: safeNonNegativeInteger,
  })
  .strict();
const baseEvent = z.object({
  event_version: z.literal(1),
  event_id: identifier,
  occurred_at: utcTimestamp,
});

const attemptStarted = baseEvent
  .extend({
    event_type: z.literal('AttemptStarted'),
    task_id: identifier,
    attempt_id: identifier,
    parent_attempt_id: identifier.nullable(),
    route,
    provider: provider.nullable(),
    model: identifier.nullable(),
    purpose: reasonCode,
    data_class: z.enum(['public', 'internal', 'sensitive']),
    cache_hit: z.boolean(),
    request_fingerprint: sha256Hex,
    input_hash: sha256Hex,
    prompt_version: identifier,
    config_hash: sha256Hex,
    pricing_version: identifier,
    estimated_cost: money.nullable(),
    status: z.literal('started'),
  })
  .strict();

const attemptCompleted = baseEvent
  .extend({
    event_type: z.literal('AttemptCompleted'),
    task_id: identifier,
    attempt_id: identifier,
    status: z.enum(['completed', 'failed', 'blocked', 'cancelled']),
    input_tokens: safeNonNegativeInteger,
    output_tokens: safeNonNegativeInteger,
    actual_cost: money.nullable(),
    latency_ms: safeNonNegativeInteger,
    result_hash: sha256Hex.nullable(),
    patch_hash: sha256Hex.nullable(),
    error_fingerprint: sha256Hex.nullable(),
    verification_result: reasonCode.nullable(),
    escalation_reason: reasonCode.nullable(),
  })
  .strict();

const budgetReservation = baseEvent
  .extend({
    event_type: z.literal('BudgetReservation'),
    reservation_id: identifier,
    task_id: identifier,
    attempt_id: identifier,
    provider,
    model: identifier,
    route,
    data_class: z.enum(['public', 'internal', 'sensitive']),
    automatic: z.boolean(),
    cloud: z.boolean(),
    retry: z.boolean(),
    estimated_input_tokens: safeNonNegativeInteger,
    reserved_output_tokens: safeNonNegativeInteger,
    reserved_cost: money,
    reserved_local_wall_time_ms: safeNonNegativeInteger,
    pricing_version: identifier,
    input_rate_micros_per_million_tokens: safeNonNegativeInteger,
    output_rate_micros_per_million_tokens: safeNonNegativeInteger,
    cache_read_rate_micros_per_million_tokens:
      safeNonNegativeInteger.nullable(),
    cache_write_rate_micros_per_million_tokens:
      safeNonNegativeInteger.nullable(),
    config_hash: sha256Hex,
  })
  .strict();

const budgetSettlement = baseEvent
  .extend({
    event_type: z.literal('BudgetSettlement'),
    settlement_id: identifier,
    reservation_id: identifier,
    task_id: identifier,
    attempt_id: identifier,
    provider,
    disposition: z.enum(['settled', 'released']),
    actual_input_tokens: safeNonNegativeInteger,
    actual_output_tokens: safeNonNegativeInteger,
    cache_read_tokens: safeNonNegativeInteger,
    cache_write_tokens: safeNonNegativeInteger,
    actual_cost: money,
    actual_local_wall_time_ms: safeNonNegativeInteger,
    overrun: z.boolean(),
    reason_code: reasonCode,
  })
  .strict();

const cacheEvent = baseEvent
  .extend({
    event_type: z.literal('CacheEvent'),
    cache_key: sha256Hex,
    action: z.enum([
      'lookup',
      'write',
      'invalidate',
      'quarantine',
      'negative-hit',
      'verified-reuse',
      'pending',
      'unverified',
      'verified',
      'negative',
      'quarantined',
      'hit',
      'miss',
    ]),
    namespace: z
      .enum(['provider-request', 'verified-artifact', 'negative'])
      .nullable()
      .default(null),
    entry_hash: sha256Hex.nullable().default(null),
    state: z
      .enum([
        'pending',
        'unverified',
        'verified',
        'negative',
        'quarantined',
      ])
      .nullable()
      .default(null),
    result_hash: sha256Hex.nullable(),
    reason_code: reasonCode.nullable(),
  })
  .strict();

const providerHealthEvent = baseEvent
  .extend({
    event_type: z.literal('ProviderHealthEvent'),
    provider,
    model: identifier,
    status: z.enum(['healthy', 'unavailable', 'timeout', 'malformed']),
    latency_ms: safeNonNegativeInteger.nullable(),
    reason_code: reasonCode,
  })
  .strict();

const approvalEvent = baseEvent
  .extend({
    event_type: z.literal('ApprovalEvent'),
    approval_id: identifier,
    task_id: identifier,
    decision: z.enum(['approved', 'denied', 'revoked']),
    scope: reasonCode,
    approver_hash: sha256Hex,
    reason_code: reasonCode,
  })
  .strict();

const verificationEvent = baseEvent
  .extend({
    event_type: z.literal('VerificationEvent'),
    attempt_id: identifier,
    command_id: z.enum([
      'lint',
      'typecheck',
      'unit',
      'integration',
      'build',
      'playwright',
    ]),
    result: z.enum(['pass', 'fail', 'skipped']),
    evidence_hash: sha256Hex,
    duration_ms: safeNonNegativeInteger,
  })
  .strict();

const routingDecisionEvent = baseEvent
  .extend({
    event_type: z.literal('RoutingDecisionEvent'),
    task_id: identifier,
    request_hash: sha256Hex,
    decision_hash: sha256Hex,
    config_hash: sha256Hex,
    decision: z.enum([
      'CACHE',
      'DETERMINISTIC',
      'LOCAL',
      'CHEAP_CLOUD',
      'STRONG',
      'APPROVAL_REQUIRED',
      'STOP',
    ]),
    route: z
      .enum(['cache', 'deterministic', 'local', 'cheap-cloud', 'strong'])
      .nullable(),
    provider_candidate: provider.nullable(),
    reason_code: z.enum(routingReasonCodes),
    cache_status: z.enum([
      'HIT',
      'MISS',
      'INVALIDATED',
      'QUARANTINED',
      'SKIPPED',
      'ERROR',
    ]),
    budget_status: z.enum([
      'NOT_APPLICABLE',
      'ALLOWED',
      'DENIED',
      'NOT_CONFIGURED',
      'ERROR',
    ]),
    pricing_status: z.enum([
      'NOT_APPLICABLE',
      'KNOWN',
      'STALE',
      'UNKNOWN',
      'ERROR',
    ]),
    data_policy_status: z.enum(['ALLOWED', 'DENIED']),
    approval_status: z.enum([
      'NOT_REQUIRED',
      'APPROVED',
      'REQUIRED',
      'DENIED',
    ]),
    escalation_allowed: z.boolean(),
    transition_trace_hash: sha256Hex,
  })
  .strict();

export const ledgerEventSchema = z.discriminatedUnion('event_type', [
  attemptStarted,
  attemptCompleted,
  budgetReservation,
  budgetSettlement,
  cacheEvent,
  providerHealthEvent,
  approvalEvent,
  verificationEvent,
  routingDecisionEvent,
]);

export type LedgerEvent = z.infer<typeof ledgerEventSchema>;
export type BudgetReservationEvent = z.infer<typeof budgetReservation>;
export type BudgetSettlementEvent = z.infer<typeof budgetSettlement>;
export type RoutingDecisionEvent = z.infer<typeof routingDecisionEvent>;

export class LedgerValidationError extends Error {
  public constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'LedgerValidationError';
  }
}

export function parseLedgerEvent(value: unknown): LedgerEvent {
  try {
    assertNoSecretLikeValues(value, 'ledger event');
  } catch (error) {
    if (error instanceof ConfigValidationError) {
      throw new LedgerValidationError(
        'Ledger event contains prohibited secret-like data',
        { cause: error },
      );
    }
    throw error;
  }
  const result = ledgerEventSchema.safeParse(value);
  if (!result.success) {
    throw new LedgerValidationError('Ledger event failed strict validation');
  }
  return deepFreeze(result.data);
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
