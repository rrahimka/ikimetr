import { describe, expect, it } from 'vitest';

import {
  deriveRoutingState,
  getApprovalState,
  getProviderHealth,
  hasRepeatedFailure,
  hasRouteInsufficiency,
  parseLedgerEvent,
  replayBudgetState,
  type LedgerEvent,
} from '../src/index.js';

const hash = (character: string): string => character.repeat(64);
const occurredAt = '2026-08-09T12:00:00.000Z';

function event(
  value: Record<string, unknown>,
): LedgerEvent {
  return parseLedgerEvent({
    event_version: 1,
    occurred_at: occurredAt,
    ...value,
  });
}

function attemptStarted(
  attemptId: string,
  route: 'local' | 'cheap-cloud' | 'strong',
): LedgerEvent {
  const provider = {
    local: 'local-ai',
    'cheap-cloud': 'deepseek',
    strong: 'codex',
  }[route];
  return event({
    event_id: `started-${attemptId}`,
    event_type: 'AttemptStarted',
    task_id: 'task-1',
    attempt_id: attemptId,
    parent_attempt_id: null,
    route,
    provider,
    model: `${provider}-model`,
    purpose: 'implementation',
    data_class: 'internal',
    cache_hit: false,
    request_fingerprint: hash('1'),
    input_hash: hash('2'),
    prompt_version: 'prompt-1',
    config_hash: hash('3'),
    pricing_version: 'pricing-1',
    estimated_cost: { currency: 'USD', amountMicros: 10 },
    status: 'started',
  });
}

function attemptFailed(
  attemptId: string,
  options: {
    readonly patch?: string;
    readonly error?: string;
    readonly escalation?: 'local-insufficient' | 'cheap-insufficient';
  } = {},
): LedgerEvent {
  return event({
    event_id: `completed-${attemptId}`,
    event_type: 'AttemptCompleted',
    task_id: 'task-1',
    attempt_id: attemptId,
    status: 'failed',
    input_tokens: 10,
    output_tokens: 10,
    actual_cost: { currency: 'USD', amountMicros: 10 },
    latency_ms: 10,
    result_hash: null,
    patch_hash: options.patch ?? hash('4'),
    error_fingerprint: options.error ?? hash('5'),
    verification_result: 'unit-fail',
    escalation_reason: options.escalation ?? 'local-insufficient',
  });
}

describe('RoutingDecisionEvent', () => {
  it('strictly validates a minimal hash-only audit record', () => {
    const routingEvent = event({
      event_id: 'routing-1',
      event_type: 'RoutingDecisionEvent',
      task_id: 'task-1',
      request_hash: hash('1'),
      decision_hash: hash('2'),
      config_hash: hash('3'),
      decision: 'LOCAL',
      route: 'local',
      provider_candidate: 'local-ai',
      reason_code: 'ROUTE_SELECTED',
      cache_status: 'MISS',
      budget_status: 'ALLOWED',
      pricing_status: 'KNOWN',
      data_policy_status: 'ALLOWED',
      approval_status: 'NOT_REQUIRED',
      escalation_allowed: true,
      transition_trace_hash: hash('4'),
    });

    expect(routingEvent.event_type).toBe('RoutingDecisionEvent');
    expect(replayBudgetState([routingEvent]).totals.perTask.size).toBe(0);
    expect(() =>
      parseLedgerEvent({ ...routingEvent, raw_prompt: 'forbidden' }),
    ).toThrow();
  });
});

describe('routing ledger state', () => {
  it('uses latest validated health and treats missing health as unknown', () => {
    const events = [
      event({
        event_id: 'health-1',
        event_type: 'ProviderHealthEvent',
        provider: 'deepseek',
        model: 'deepseek-model',
        status: 'timeout',
        latency_ms: 1_000,
        reason_code: 'timeout',
      }),
      event({
        event_id: 'health-2',
        event_type: 'ProviderHealthEvent',
        provider: 'deepseek',
        model: 'deepseek-model',
        status: 'healthy',
        latency_ms: 100,
        reason_code: 'health-check',
      }),
      event({
        event_id: 'health-3',
        event_type: 'ProviderHealthEvent',
        provider: 'local-ai',
        model: 'local-model',
        status: 'malformed',
        latency_ms: 50,
        reason_code: 'malformed',
      }),
    ];
    const state = deriveRoutingState(events, 'task-1');

    expect(getProviderHealth(state, 'deepseek', 'deepseek-model')).toBe(
      'healthy',
    );
    expect(getProviderHealth(state, 'local-ai', 'local-model')).toBe(
      'degraded',
    );
    expect(getProviderHealth(state, 'qwen', 'qwen-model')).toBe('unknown');
  });

  it('uses only the latest validated approval decision for each scope', () => {
    const state = deriveRoutingState(
      [
        event({
          event_id: 'approval-1',
          event_type: 'ApprovalEvent',
          approval_id: 'approval-1',
          task_id: 'task-1',
          decision: 'approved',
          scope: 'cheap-cloud',
          approver_hash: hash('6'),
          reason_code: 'approved',
        }),
        event({
          event_id: 'approval-2',
          event_type: 'ApprovalEvent',
          approval_id: 'approval-2',
          task_id: 'task-1',
          decision: 'revoked',
          scope: 'cheap-cloud',
          approver_hash: hash('6'),
          reason_code: 'revoked',
        }),
      ],
      'task-1',
    );

    expect(getApprovalState(state, 'cheap-cloud')).toBe('revoked');
    expect(getApprovalState(state, 'strong')).toBe('missing');
  });

  it('derives insufficiency and stops repeated failures without new evidence', () => {
    const firstStarted = attemptStarted('attempt-1', 'local');
    const firstFailed = attemptFailed('attempt-1');
    const oneFailure = deriveRoutingState(
      [firstStarted, firstFailed],
      'task-1',
    );
    expect(hasRouteInsufficiency(oneFailure, 'local')).toBe(true);
    expect(
      hasRepeatedFailure(oneFailure, {
        error_fingerprint: hash('5'),
        current_diff_hash: hash('4'),
      }),
    ).toBe(false);

    const repeated = deriveRoutingState(
      [
        firstStarted,
        firstFailed,
        attemptStarted('attempt-2', 'local'),
        attemptFailed('attempt-2'),
      ],
      'task-1',
    );
    expect(
      hasRepeatedFailure(repeated, {
        error_fingerprint: hash('5'),
        current_diff_hash: hash('4'),
      }),
    ).toBe(true);

    const withNewEvidence = deriveRoutingState(
      [
        firstStarted,
        firstFailed,
        attemptStarted('attempt-2', 'local'),
        event({
          event_id: 'verification-2',
          event_type: 'VerificationEvent',
          attempt_id: 'attempt-2',
          command_id: 'unit',
          result: 'fail',
          evidence_hash: hash('7'),
          duration_ms: 10,
        }),
        attemptFailed('attempt-2'),
      ],
      'task-1',
    );
    expect(
      hasRepeatedFailure(withNewEvidence, {
        error_fingerprint: hash('5'),
        current_diff_hash: hash('4'),
      }),
    ).toBe(false);
  });
});
