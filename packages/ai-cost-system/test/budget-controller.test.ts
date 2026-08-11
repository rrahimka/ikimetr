import { mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  AccountingLedger,
  BudgetController,
  BudgetControllerError,
  type BudgetQuoteRequest,
  type BudgetReservationRequest,
  type ConfigSnapshot,
  PricingResolver,
} from '../src/index.js';
import {
  type ConfigFixture,
  createConfigFixture,
  type JsonObject,
  nestedObject,
} from './config-fixture.js';

const fixtures: ConfigFixture[] = [];
const temporaryDirectories: string[] = [];
const now = () => new Date('2026-08-09T12:00:00.000Z');

afterEach(async () => {
  await Promise.all(fixtures.splice(0).map((fixture) => fixture.dispose()));
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { force: true, recursive: true }),
    ),
  );
});

interface Harness {
  readonly controller: BudgetController;
  readonly ledger: AccountingLedger;
  readonly repository: string;
  readonly config: ConfigSnapshot;
  readonly pricingResolver: PricingResolver;
}

async function createHarness(
  mutate?: (configuration: {
    providers: JsonObject;
    pricing: JsonObject;
    budgets: JsonObject;
  }) => void,
): Promise<Harness> {
  const fixture = await createConfigFixture();
  fixtures.push(fixture);
  const providers = await fixture.read('providers.json');
  const pricing = await fixture.read('pricing.json');
  const budgets = await fixture.read('budgets.json');
  configureProvider(providers, 'deepseek', 'deepseek-test');
  configureProvider(providers, 'local-ai', 'local-test');
  configurePricing(pricing, 'deepseek', 'deepseek-test');
  configurePricing(pricing, 'local-ai', 'local-test');
  configureBudgets(budgets);
  mutate?.({ providers, pricing, budgets });
  await fixture.write('providers.json', providers);
  await fixture.write('pricing.json', pricing);
  await fixture.write('budgets.json', budgets);
  const snapshot = await fixture.load();

  const repository = await mkdtemp(join(tmpdir(), 'ikimetr-budget-test-'));
  temporaryDirectories.push(repository);
  const ledger = await AccountingLedger.open(repository);
  const pricingResolver = new PricingResolver(snapshot);
  const controller = await BudgetController.initialize({
    ledger,
    config: snapshot,
    pricingResolver,
    now,
  });
  return {
    controller,
    ledger,
    repository,
    config: snapshot,
    pricingResolver,
  };
}

function configureProvider(
  configuration: JsonObject,
  providerId: 'deepseek' | 'local-ai',
  model: string,
): void {
  const provider = nestedObject(
    nestedObject(configuration, 'providers'),
    providerId,
  );
  Object.assign(provider, {
    enabled: true,
    model,
    maxInputTokens: 1_000,
    maxOutputTokens: 200,
    maxCallsPerTask: 10,
    maxCostPerTask: { currency: 'USD', amountMicros: 10_000 },
    timeoutMs: 1_000,
  });
  nestedObject(provider, 'retryPolicy')['maxRetries'] = 2;
}

function configurePricing(
  configuration: JsonObject,
  providerId: 'deepseek' | 'local-ai',
  model: string,
): void {
  const snapshots = configuration['snapshots'];
  if (!Array.isArray(snapshots)) {
    throw new Error('pricing snapshots fixture must be an array');
  }
  const snapshot = snapshots.find(
    (candidate) =>
      nestedObject({ candidate }, 'candidate')['provider'] === providerId,
  );
  Object.assign(nestedObject({ snapshot }, 'snapshot'), {
    model,
    currency: 'USD',
    inputRatePerMillionTokens: 1_000_000,
    outputRatePerMillionTokens: 1_000_000,
    cacheReadRatePerMillionTokens: 1_000_000,
    cacheWriteRatePerMillionTokens: 1_000_000,
    effectiveAt: '2026-08-01T00:00:00.000Z',
    retrievedAt: '2026-08-01T00:00:00.000Z',
    source: 'test-fixture',
    status: 'known',
  });
}

function configureBudgets(configuration: JsonObject): void {
  configuration['defaultBudgetClass'] = 'STRONG_ALLOWED';
  const limits = nestedObject(configuration, 'limits');
  for (const scope of [
    'perTask',
    'providerTask',
    'providerDay',
    'cloudDay',
    'providerMonth',
    'cloudMonth',
  ]) {
    Object.assign(nestedObject(limits, scope), {
      maxInputTokens: 10_000,
      maxOutputTokens: 10_000,
      maxCalls: 10,
      maxCost: { currency: 'USD', amountMicros: 100_000 },
    });
  }
  nestedObject(limits, 'cloudCallsTask')['maxCalls'] = 10;
  Object.assign(nestedObject(limits, 'retryLimits'), {
    maxRetriesPerTask: 2,
    maxRetriesPerProviderTask: 2,
  });
  nestedObject(limits, 'localWallTime')['maxMillisecondsPerTask'] = 10_000;
}

function request(
  suffix: string,
  overrides: Partial<BudgetReservationRequest> = {},
): BudgetReservationRequest {
  return {
    eventId: `event-reserve-${suffix}`,
    reservationId: `reservation-${suffix}`,
    taskId: 'task-1',
    attemptId: `attempt-${suffix}`,
    provider: 'deepseek',
    model: 'deepseek-test',
    route: 'cheap-cloud',
    dataClass: 'internal',
    automatic: true,
    retry: false,
    estimatedInputTokens: 100,
    ...overrides,
  };
}

function quoteRequest(
  overrides: Partial<BudgetQuoteRequest> = {},
): BudgetQuoteRequest {
  return {
    taskId: 'task-1',
    provider: 'deepseek',
    model: 'deepseek-test',
    route: 'cheap-cloud',
    dataClass: 'internal',
    automatic: true,
    retry: false,
    estimatedInputTokens: 100,
    ...overrides,
  };
}

function setScopedLimit(
  budgets: JsonObject,
  scope: string,
  field: string,
  value: unknown,
): void {
  nestedObject(nestedObject(budgets, 'limits'), scope)[field] = value;
}

describe('BudgetController reservations', () => {
  it('quotes the reservation limits without ledger or state mutation', async () => {
    const { controller, ledger } = await createHarness();
    const stateBefore = controller.getState();
    const eventsBefore = await ledger.replay();

    const quote = await controller.quote(quoteRequest());

    expect(quote).toEqual({
      status: 'ALLOWED',
      provider: 'deepseek',
      model: 'deepseek-test',
      route: 'cheap-cloud',
      estimatedInputTokens: 100,
      reservedOutputTokens: 200,
      estimatedCost: { currency: 'USD', amountMicros: 300 },
      reservedLocalWallTimeMs: 0,
      pricingVersion: 'bootstrap-unknown-1',
    });
    expect(await ledger.replay()).toEqual(eventsBefore);
    expect(controller.getState()).toEqual(stateBefore);
    expect(controller.getState().activeReservations.size).toBe(0);
  });

  it('returns a fixed denial without writing a reservation', async () => {
    const { controller, ledger } = await createHarness(({ budgets }) => {
      setScopedLimit(budgets, 'perTask', 'maxInputTokens', null);
    });

    await expect(controller.quote(quoteRequest())).resolves.toEqual({
      status: 'DENIED',
      reasonCode: 'NOT_CONFIGURED',
    });
    expect(await ledger.replay()).toEqual([]);
    expect(controller.getState().activeReservations.size).toBe(0);
  });

  it('denies automatic quotes for crash-recovered active reservations', async () => {
    const harness = await createHarness();
    await harness.controller.reserve(request('crash-quote'));
    const restarted = await BudgetController.initialize({
      ledger: harness.ledger,
      config: harness.config,
      pricingResolver: harness.pricingResolver,
      now,
    });
    const before = await harness.ledger.replay();

    await expect(restarted.quote(quoteRequest())).resolves.toEqual({
      status: 'DENIED',
      reasonCode: 'RECOVERY_REQUIRED',
    });
    expect(await harness.ledger.replay()).toEqual(before);
  });

  it('denies null budgets and disabled providers fail-closed', async () => {
    const nullBudget = await createHarness(({ budgets }) => {
      setScopedLimit(budgets, 'perTask', 'maxInputTokens', null);
    });
    await expect(nullBudget.controller.reserve(request('null'))).rejects.toMatchObject({
      code: 'NOT_CONFIGURED',
    });

    const disabled = await createHarness(({ providers }) => {
      nestedObject(
        nestedObject(providers, 'providers'),
        'deepseek',
      )['enabled'] = false;
    });
    await expect(disabled.controller.reserve(request('disabled'))).rejects.toMatchObject({
      code: 'PROVIDER_DISABLED',
    });
  });

  it('reserves configured maximum output and worst-case integer cost', async () => {
    const { controller } = await createHarness();

    const result = await controller.reserve(request('success'));

    expect(result.event.reserved_output_tokens).toBe(200);
    expect(result.event.reserved_cost).toEqual({
      currency: 'USD',
      amountMicros: 300,
    });
    expect(controller.getState().totals.perTask.get('task-1')?.calls).toBe(1);
  });

  it.each([
    ['perTask', 'task total'],
    ['providerTask', 'provider/task total'],
    ['providerDay', 'provider/day total'],
    ['cloudDay', 'cloud/day total'],
    ['providerMonth', 'provider/month total'],
    ['cloudMonth', 'cloud/month total'],
  ])('enforces the %s input ceiling across split calls', async (scope) => {
    const { controller } = await createHarness(({ budgets }) => {
      setScopedLimit(budgets, scope, 'maxInputTokens', 150);
    });
    await controller.reserve(request(`${scope}-1`, { estimatedInputTokens: 100 }));

    await expect(
      controller.reserve(
        request(`${scope}-2`, {
          taskId: scope.includes('Day') || scope.includes('Month') ? 'task-2' : 'task-1',
          estimatedInputTokens: 100,
        }),
      ),
    ).rejects.toMatchObject({ code: 'LIMIT_EXCEEDED' });
  });

  it('enforces provider/task minimum, cloud calls, and retry ceilings', async () => {
    const minimum = await createHarness(({ providers, budgets }) => {
      nestedObject(
        nestedObject(providers, 'providers'),
        'deepseek',
      )['maxCallsPerTask'] = 1;
      setScopedLimit(budgets, 'providerTask', 'maxCalls', 5);
    });
    await minimum.controller.reserve(request('minimum-1'));
    await expect(
      minimum.controller.reserve(request('minimum-2')),
    ).rejects.toMatchObject({ code: 'LIMIT_EXCEEDED' });

    const cloudCalls = await createHarness(({ budgets }) => {
      setScopedLimit(budgets, 'cloudCallsTask', 'maxCalls', 1);
    });
    await cloudCalls.controller.reserve(request('cloud-call-1'));
    await expect(
      cloudCalls.controller.reserve(request('cloud-call-2')),
    ).rejects.toMatchObject({ code: 'LIMIT_EXCEEDED' });

    const retries = await createHarness(({ budgets }) => {
      const retryLimits = nestedObject(
        nestedObject(budgets, 'limits'),
        'retryLimits',
      );
      retryLimits['maxRetriesPerTask'] = 1;
      retryLimits['maxRetriesPerProviderTask'] = 1;
    });
    await retries.controller.reserve(request('retry-1', { retry: true }));
    await expect(
      retries.controller.reserve(request('retry-2', { retry: true })),
    ).rejects.toMatchObject({ code: 'LIMIT_EXCEEDED' });
  });

  it('enforces local wall-time and budget currency', async () => {
    const local = await createHarness(({ budgets }) => {
      nestedObject(
        nestedObject(budgets, 'limits'),
        'localWallTime',
      )['maxMillisecondsPerTask'] = 1_500;
    });
    await local.controller.reserve(
      request('local-1', {
        provider: 'local-ai',
        model: 'local-test',
        route: 'local',
      }),
    );
    await expect(
      local.controller.reserve(
        request('local-2', {
          provider: 'local-ai',
          model: 'local-test',
          route: 'local',
        }),
      ),
    ).rejects.toMatchObject({ code: 'LIMIT_EXCEEDED' });

    const currency = await createHarness(({ budgets }) => {
      setScopedLimit(budgets, 'perTask', 'maxCost', {
        currency: 'EUR',
        amountMicros: 100_000,
      });
    });
    await expect(currency.controller.reserve(request('currency'))).rejects.toMatchObject({
      code: 'INVALID_REQUEST',
    });
  });

  it('serializes concurrent reservations against a shared limit', async () => {
    const { controller } = await createHarness(({ budgets }) => {
      setScopedLimit(budgets, 'providerDay', 'maxInputTokens', 150);
    });

    const outcomes = await Promise.allSettled([
      controller.reserve(request('concurrent-1', { taskId: 'task-a' })),
      controller.reserve(request('concurrent-2', { taskId: 'task-b' })),
    ]);

    expect(outcomes.filter(({ status }) => status === 'fulfilled')).toHaveLength(1);
    expect(outcomes.filter(({ status }) => status === 'rejected')).toHaveLength(1);
  });
});

describe('BudgetController lifecycle and restart recovery', () => {
  it('settles actual usage and explicitly releases non-billable work', async () => {
    const { controller } = await createHarness();
    await controller.reserve(request('settle'));
    await controller.settle({
      eventId: 'event-settle-settle',
      settlementId: 'settlement-settle',
      reservationId: 'reservation-settle',
      actualInputTokens: 10,
      actualOutputTokens: 20,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      actualLocalWallTimeMs: 0,
      reasonCode: 'completed',
    });
    expect(controller.getState().totals.perTask.get('task-1')?.cost.amountMicros).toBe(30);

    await controller.reserve(request('release', { taskId: 'task-2' }));
    await controller.release({
      eventId: 'event-release-release',
      settlementId: 'settlement-release',
      reservationId: 'reservation-release',
      reasonCode: 'safe-release',
    });
    expect(controller.getState().totals.perTask.has('task-2')).toBe(false);
  });

  it('persists unfinished reservations across restart until safe recovery', async () => {
    const { controller, ledger, config, pricingResolver } =
      await createHarness();
    await controller.reserve(request('crash'));
    const restarted = await BudgetController.initialize({
      ledger,
      config,
      pricingResolver,
      now,
    });

    expect(restarted.getState().recoveryBlockingReservationIds.has('reservation-crash')).toBe(true);
    (
      restarted.getState().recoveryBlockingReservationIds as Set<string>
    ).clear();
    await expect(restarted.reserve(request('blocked'))).rejects.toMatchObject({
      code: 'RECOVERY_REQUIRED',
    });
    await restarted.release({
      eventId: 'event-release-crash',
      settlementId: 'settlement-crash',
      reservationId: 'reservation-crash',
      reasonCode: 'safe-recovery',
    });
    await expect(restarted.reserve(request('after-recovery'))).resolves.toBeDefined();
  });

  it('rejects a pricing resolver from a different config snapshot', async () => {
    const { ledger, config } = await createHarness();
    const otherFixture = await createConfigFixture();
    fixtures.push(otherFixture);
    const otherSnapshot = await otherFixture.load();

    await expect(
      BudgetController.initialize({
        ledger,
        config,
        pricingResolver: new PricingResolver(otherSnapshot),
        now,
      }),
    ).rejects.toMatchObject({ code: 'REPLAY_FAILED' });
  });

  it('persists an overrun discrepancy circuit across restart', async () => {
    const { controller, ledger, config, pricingResolver } =
      await createHarness();
    await controller.reserve(request('overrun'));
    const result = await controller.settle({
      eventId: 'event-settle-overrun',
      settlementId: 'settlement-overrun',
      reservationId: 'reservation-overrun',
      actualInputTokens: 100,
      actualOutputTokens: 201,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      actualLocalWallTimeMs: 0,
      reasonCode: 'completed',
    });
    expect(result.status).toBe('DISCREPANCY');

    const restarted = await BudgetController.initialize({
      ledger,
      config,
      pricingResolver,
      now,
    });
    await expect(restarted.reserve(request('after-overrun'))).rejects.toMatchObject({
      code: 'DISCREPANCY_BLOCK',
    });
  });

  it('rejects replay, double settlement, and unknown reservation transitions', async () => {
    const { controller } = await createHarness();
    await controller.reserve(request('duplicate'));
    await expect(controller.reserve(request('duplicate'))).rejects.toBeInstanceOf(
      BudgetControllerError,
    );
    await controller.release({
      eventId: 'event-release-duplicate',
      settlementId: 'settlement-duplicate',
      reservationId: 'reservation-duplicate',
      reasonCode: 'safe-release',
    });
    await expect(
      controller.release({
        eventId: 'event-release-duplicate-2',
        settlementId: 'settlement-duplicate-2',
        reservationId: 'reservation-duplicate',
        reasonCode: 'safe-release',
      }),
    ).rejects.toMatchObject({ code: 'ALREADY_SETTLED' });
    await expect(
      controller.release({
        eventId: 'event-release-unknown',
        settlementId: 'settlement-unknown',
        reservationId: 'reservation-unknown',
        reasonCode: 'safe-release',
      }),
    ).rejects.toMatchObject({ code: 'UNKNOWN_RESERVATION' });
  });

  it('blocks after an append failure without mutating derived state', async () => {
    const { controller, repository } = await createHarness();
    const ledgerPath = join(repository, '.ai-cost', 'ledger.jsonl');
    const external = join(repository, 'external.jsonl');
    await writeFile(external, '', 'utf8');
    await symlink(external, ledgerPath, 'file');

    await expect(controller.reserve(request('storage-failure'))).rejects.toMatchObject({
      code: 'STORAGE_FAILURE',
    });
    expect(controller.getState().activeReservations.size).toBe(0);
    await expect(controller.reserve(request('blocked-after-failure'))).rejects.toMatchObject({
      code: 'STORAGE_FAILURE',
    });
  });
});
