import { describe, expect, it } from 'vitest';

import {
  budgetScopeKey,
  type BudgetReservationEvent,
  type BudgetSettlementEvent,
  BudgetStateError,
  parseLedgerEvent,
  replayBudgetState,
} from '../src/index.js';

const hash = 'b'.repeat(64);

function reservation(
  overrides: Partial<BudgetReservationEvent> = {},
): BudgetReservationEvent {
  return parseLedgerEvent({
    event_version: 1,
    event_id: 'event-reservation-1',
    event_type: 'BudgetReservation',
    occurred_at: '2026-08-31T23:59:59.000Z',
    reservation_id: 'reservation-1',
    task_id: 'task-1',
    attempt_id: 'attempt-1',
    provider: 'deepseek',
    model: 'deepseek-test',
    route: 'cheap-cloud',
    data_class: 'internal',
    automatic: true,
    cloud: true,
    retry: false,
    estimated_input_tokens: 100,
    reserved_output_tokens: 200,
    reserved_cost: { currency: 'USD', amountMicros: 500 },
    reserved_local_wall_time_ms: 0,
    pricing_version: 'pricing-v1',
    input_rate_micros_per_million_tokens: 1_000_000,
    output_rate_micros_per_million_tokens: 2_000_000,
    cache_read_rate_micros_per_million_tokens: 1_000_000,
    cache_write_rate_micros_per_million_tokens: 1_000_000,
    config_hash: hash,
    ...overrides,
  }) as BudgetReservationEvent;
}

function settlement(
  overrides: Partial<BudgetSettlementEvent> = {},
): BudgetSettlementEvent {
  return parseLedgerEvent({
    event_version: 1,
    event_id: 'event-settlement-1',
    event_type: 'BudgetSettlement',
    occurred_at: '2026-08-31T23:59:59.500Z',
    settlement_id: 'settlement-1',
    reservation_id: 'reservation-1',
    task_id: 'task-1',
    attempt_id: 'attempt-1',
    provider: 'deepseek',
    disposition: 'settled',
    actual_input_tokens: 80,
    actual_output_tokens: 120,
    cache_read_tokens: 10,
    cache_write_tokens: 5,
    actual_cost: { currency: 'USD', amountMicros: 300 },
    actual_local_wall_time_ms: 0,
    overrun: false,
    reason_code: 'completed',
    ...overrides,
  }) as BudgetSettlementEvent;
}

describe('deterministic budget replay', () => {
  it('restores unfinished reservations as active and recovery-blocking', () => {
    const event = reservation({
      provider: 'local-ai',
      model: 'local-test',
      route: 'local',
      cloud: false,
      retry: true,
      reserved_local_wall_time_ms: 2_000,
    });

    const state = replayBudgetState([event]);
    const task = state.totals.perTask.get('task-1');

    expect(state.activeReservations.get('reservation-1')?.reservation).toBe(
      event,
    );
    expect(state.recoveryBlockingReservationIds.has('reservation-1')).toBe(
      true,
    );
    expect(state.automaticCallsBlocked).toBe(true);
    expect(task).toMatchObject({
      inputTokens: 100,
      outputTokens: 200,
      calls: 1,
      retries: 1,
      localWallTimeMs: 2_000,
      cost: { currency: 'USD', amountMicros: 500 },
    });
  });

  it('replaces reserved usage with actual settlement usage', () => {
    const state = replayBudgetState([reservation(), settlement()]);
    const task = state.totals.perTask.get('task-1');

    expect(state.activeReservations.size).toBe(0);
    expect(state.settledReservationIds.has('reservation-1')).toBe(true);
    expect(state.automaticCallsBlocked).toBe(false);
    expect(task).toEqual({
      inputTokens: 80,
      outputTokens: 120,
      cacheReadTokens: 10,
      cacheWriteTokens: 5,
      calls: 1,
      retries: 0,
      localWallTimeMs: 0,
      cost: { currency: 'USD', amountMicros: 300 },
    });
  });

  it('counts an explicitly released reservation as zero usage', () => {
    const released = settlement({
      disposition: 'released',
      actual_input_tokens: 0,
      actual_output_tokens: 0,
      cache_read_tokens: 0,
      cache_write_tokens: 0,
      actual_cost: { currency: 'USD', amountMicros: 0 },
      actual_local_wall_time_ms: 0,
      reason_code: 'safe-release',
    });

    const state = replayBudgetState([reservation(), released]);

    expect(state.activeReservations.size).toBe(0);
    expect(state.settledReservationIds.has('reservation-1')).toBe(true);
    expect(state.totals.perTask.has('task-1')).toBe(false);
  });

  it('restores provider/cloud UTC day and month, calls, retries, and wall time', () => {
    const first = reservation({ retry: true });
    const firstSettlement = settlement();
    const second = reservation({
      event_id: 'event-reservation-2',
      reservation_id: 'reservation-2',
      attempt_id: 'attempt-2',
      occurred_at: '2026-09-01T00:00:00.000Z',
    });
    const secondSettlement = settlement({
      event_id: 'event-settlement-2',
      settlement_id: 'settlement-2',
      reservation_id: 'reservation-2',
      attempt_id: 'attempt-2',
      occurred_at: '2026-09-01T00:00:01.000Z',
    });

    const state = replayBudgetState([
      first,
      firstSettlement,
      second,
      secondSettlement,
    ]);

    expect(
      state.totals.providerDay.get(
        budgetScopeKey('deepseek', '2026-08-31'),
      )?.calls,
    ).toBe(1);
    expect(
      state.totals.providerDay.get(
        budgetScopeKey('deepseek', '2026-09-01'),
      )?.calls,
    ).toBe(1);
    expect(state.totals.cloudMonth.get('2026-08')?.calls).toBe(1);
    expect(state.totals.cloudMonth.get('2026-09')?.calls).toBe(1);
    expect(state.totals.cloudCallsTask.get('task-1')).toBe(2);
    expect(state.totals.retryTask.get('task-1')).toBe(1);
    expect(
      state.totals.retryProviderTask.get(
        budgetScopeKey('task-1', 'deepseek'),
      ),
    ).toBe(1);
  });

  it('restores the persistent discrepancy circuit from an overrun', () => {
    const state = replayBudgetState([
      reservation(),
      settlement({ overrun: true, actual_output_tokens: 201 }),
    ]);

    expect(state.automaticCallsBlocked).toBe(true);
    expect(state.recoveryBlockingReservationIds.size).toBe(0);
  });

  it.each([
    {
      label: 'duplicate reservation',
      events: [
        reservation(),
        reservation({ event_id: 'event-reservation-2' }),
      ],
    },
    { label: 'settlement before reserve', events: [settlement()] },
    {
      label: 'double settlement',
      events: [
        reservation(),
        settlement(),
        settlement({
          event_id: 'event-settlement-2',
          settlement_id: 'settlement-2',
        }),
      ],
    },
    {
      label: 'task mismatch',
      events: [reservation(), settlement({ task_id: 'task-2' })],
    },
    {
      label: 'provider mismatch',
      events: [reservation(), settlement({ provider: 'qwen' })],
    },
    {
      label: 'currency mismatch',
      events: [
        reservation(),
        settlement({ actual_cost: { currency: 'EUR', amountMicros: 300 } }),
      ],
    },
  ])('fails closed on $label', ({ events }) => {
    expect(() => replayBudgetState(events)).toThrow(BudgetStateError);
  });
});
