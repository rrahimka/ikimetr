import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  AccountingLedger,
  canonicalize,
  type LedgerEvent,
  LedgerStorageError,
  LedgerValidationError,
  parseLedgerEvent,
} from '../src/index.js';

const temporaryDirectories: string[] = [];
const hash = 'a'.repeat(64);
const timestamp = '2026-08-09T08:30:00.000Z';

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { force: true, recursive: true }),
    ),
  );
});

async function createRepository(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'ikimetr-ledger-test-'));
  temporaryDirectories.push(directory);
  return directory;
}

function eventFixtures(): readonly LedgerEvent[] {
  return [
    parseLedgerEvent({
      event_version: 1,
      event_id: 'event-attempt-started',
      event_type: 'AttemptStarted',
      occurred_at: timestamp,
      task_id: 'task-1',
      attempt_id: 'attempt-1',
      parent_attempt_id: null,
      route: 'local',
      provider: 'local-ai',
      model: 'local-test',
      purpose: 'implementation',
      data_class: 'internal',
      cache_hit: false,
      request_fingerprint: hash,
      input_hash: hash,
      prompt_version: 'prompt-v1',
      config_hash: hash,
      pricing_version: 'pricing-v1',
      estimated_cost: { currency: 'USD', amountMicros: 10 },
      status: 'started',
    }),
    parseLedgerEvent({
      event_version: 1,
      event_id: 'event-attempt-completed',
      event_type: 'AttemptCompleted',
      occurred_at: timestamp,
      task_id: 'task-1',
      attempt_id: 'attempt-1',
      status: 'completed',
      input_tokens: 100,
      output_tokens: 20,
      actual_cost: { currency: 'USD', amountMicros: 8 },
      latency_ms: 50,
      result_hash: hash,
      patch_hash: hash,
      error_fingerprint: null,
      verification_result: 'verified',
      escalation_reason: null,
    }),
    parseLedgerEvent({
      event_version: 1,
      event_id: 'event-reservation',
      event_type: 'BudgetReservation',
      occurred_at: timestamp,
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
      reserved_cost: { currency: 'USD', amountMicros: 10 },
      reserved_local_wall_time_ms: 0,
      pricing_version: 'pricing-v1',
      input_rate_micros_per_million_tokens: 50_000,
      output_rate_micros_per_million_tokens: 25_000,
      cache_read_rate_micros_per_million_tokens: null,
      cache_write_rate_micros_per_million_tokens: null,
      config_hash: hash,
    }),
    parseLedgerEvent({
      event_version: 1,
      event_id: 'event-settlement',
      event_type: 'BudgetSettlement',
      occurred_at: timestamp,
      settlement_id: 'settlement-1',
      reservation_id: 'reservation-1',
      task_id: 'task-1',
      attempt_id: 'attempt-1',
      provider: 'deepseek',
      disposition: 'settled',
      actual_input_tokens: 90,
      actual_output_tokens: 150,
      cache_read_tokens: 0,
      cache_write_tokens: 0,
      actual_cost: { currency: 'USD', amountMicros: 8 },
      actual_local_wall_time_ms: 0,
      overrun: false,
      reason_code: 'completed',
    }),
    parseLedgerEvent({
      event_version: 1,
      event_id: 'event-cache',
      event_type: 'CacheEvent',
      occurred_at: timestamp,
      cache_key: hash,
      action: 'verified',
      result_hash: hash,
      reason_code: 'verification-pass',
    }),
    parseLedgerEvent({
      event_version: 1,
      event_id: 'event-provider-health',
      event_type: 'ProviderHealthEvent',
      occurred_at: timestamp,
      provider: 'deepseek',
      model: 'deepseek-test',
      status: 'healthy',
      latency_ms: 25,
      reason_code: 'probe-pass',
    }),
    parseLedgerEvent({
      event_version: 1,
      event_id: 'event-approval',
      event_type: 'ApprovalEvent',
      occurred_at: timestamp,
      approval_id: 'approval-1',
      task_id: 'task-1',
      decision: 'approved',
      scope: 'strong-route',
      approver_hash: hash,
      reason_code: 'user-approved',
    }),
    parseLedgerEvent({
      event_version: 1,
      event_id: 'event-verification',
      event_type: 'VerificationEvent',
      occurred_at: timestamp,
      attempt_id: 'attempt-1',
      command_id: 'unit',
      result: 'pass',
      evidence_hash: hash,
      duration_ms: 500,
    }),
  ];
}

describe('ledger event schemas', () => {
  it('accepts the eight approved event variants', () => {
    expect(eventFixtures()).toHaveLength(8);
  });

  it('rejects unknown fields and raw content', () => {
    const valid = eventFixtures()[0];

    expect(() =>
      parseLedgerEvent({ ...valid, raw_prompt: 'do not persist this' }),
    ).toThrow(LedgerValidationError);
    expect(() =>
      parseLedgerEvent({ ...valid, event_type: 'UnknownEvent' }),
    ).toThrow(LedgerValidationError);
    expect(() =>
      parseLedgerEvent({ ...valid, model: 'sk-test-secret-value-1234567890' }),
    ).toThrow(LedgerValidationError);
  });
});

describe('AccountingLedger', () => {
  it('appends canonical JSONL and replays in original order', async () => {
    const repository = await createRepository();
    const ledger = await AccountingLedger.open(repository);
    const events = eventFixtures().slice(0, 2);

    await ledger.append(events[0]!);
    await ledger.append(events[1]!);

    const source = await readFile(
      join(repository, '.ai-cost', 'ledger.jsonl'),
      'utf8',
    );
    expect(source).toBe(`${canonicalize(events[0])}\n${canonicalize(events[1])}\n`);
    expect(await ledger.replay()).toEqual(events);
  });

  it('serializes concurrent appends without interleaving records', async () => {
    const repository = await createRepository();
    const ledger = await AccountingLedger.open(repository);
    const base = eventFixtures()[7]!;
    const events = Array.from({ length: 24 }, (_, index) =>
      parseLedgerEvent({
        ...base,
        event_id: `event-concurrent-${index}`,
        attempt_id: `attempt-${index}`,
      }),
    );

    await Promise.all(events.map((event) => ledger.append(event)));

    expect(await ledger.replay()).toEqual(events);
  });

  it('fails closed for malformed, partial, empty, or duplicate records', async () => {
    const repository = await createRepository();
    const stateDirectory = join(repository, '.ai-cost');
    await mkdir(stateDirectory);
    const ledgerPath = join(stateDirectory, 'ledger.jsonl');
    const event = eventFixtures()[0];

    for (const invalidSource of [
      '{invalid}\n',
      canonicalize(event),
      `${canonicalize(event)}\n\n`,
      `${canonicalize(event)}\n${canonicalize(event)}\n`,
      `${canonicalize(event).replace(
        '"event_id":',
        '"event_id":"duplicate","event_id":',
      )}\n`,
    ]) {
      await writeFile(ledgerPath, invalidSource, 'utf8');
      const ledger = await AccountingLedger.open(repository);
      await expect(ledger.replay()).rejects.toThrow(LedgerValidationError);
    }
  });

  it('rejects a symlinked state directory', async () => {
    const repository = await createRepository();
    const external = await createRepository();
    await symlink(external, join(repository, '.ai-cost'), 'dir');

    await expect(AccountingLedger.open(repository)).rejects.toThrow(
      LedgerStorageError,
    );
  });

  it('rejects a symlinked ledger, including replacement after open', async () => {
    const repository = await createRepository();
    const external = join(await createRepository(), 'external.jsonl');
    await writeFile(external, '', 'utf8');
    const stateDirectory = join(repository, '.ai-cost');
    await mkdir(stateDirectory);
    await symlink(external, join(stateDirectory, 'ledger.jsonl'), 'file');

    await expect(AccountingLedger.open(repository)).rejects.toThrow(
      LedgerStorageError,
    );

    await rm(join(stateDirectory, 'ledger.jsonl'));
    const ledger = await AccountingLedger.open(repository);
    await symlink(external, join(stateDirectory, 'ledger.jsonl'), 'file');
    await expect(ledger.append(eventFixtures()[0]!)).rejects.toThrow(
      LedgerStorageError,
    );
  });

  it('rejects invalid events before mutating the ledger', async () => {
    const repository = await createRepository();
    const ledger = await AccountingLedger.open(repository);
    const invalid = {
      ...eventFixtures()[0],
      raw_log: 'must not persist',
    } as unknown as LedgerEvent;

    await expect(ledger.append(invalid)).rejects.toThrow(
      LedgerValidationError,
    );
    expect(await ledger.replay()).toEqual([]);
  });
});
