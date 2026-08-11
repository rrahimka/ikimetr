/**
 * Real Ollama acceptance test.
 *
 * Prerequisites:
 * - Ollama 0.32.6 running at http://127.0.0.1:11434
 * - Model qwen2.5-coder:7b installed
 * - Digest dae161e27b0e90dd1856c8bb3209201fd6736d8eb66298e75ed87571486f4364
 *
 * This test performs exactly ONE bounded real Ollama invocation:
 * - Generic fixture only (no İkiMetr business data)
 * - Small prompt/output
 * - Temperature 0
 * - Hard timeout
 * - No retry
 *
 * Run manually:
 *   npx vitest run --reporter=verbose test/ollama-acceptance.test.ts
 *
 * Or via pnpm:
 *   pnpm --filter @ikimetr/ai-cost-system test:unit -- --reporter=verbose test/ollama-acceptance.test.ts
 */

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';

import {
  AccountingLedger,
  BudgetController,
  OllamaAdapter,
  PricingResolver,
} from '../src/index.js';
import {
  type ConfigFixture,
  createConfigFixture,
  nestedObject,
} from './config-fixture.js';

const MODEL = 'qwen2.5-coder:7b';
const DIGEST =
  'dae161e27b0e90dd1856c8bb3209201fd6736d8eb66298e75ed87571486f4364';

const fixtures: ConfigFixture[] = [];
const temporaryDirectories: string[] = [];
const now = () => new Date();

afterEach(async () => {
  await Promise.all(fixtures.splice(0).map((f) => f.dispose()));
  await Promise.all(
    temporaryDirectories.splice(0).map((d) =>
      rm(d, { force: true, recursive: true }),
    ),
  );
});

async function createHarness() {
  const fixture = await createConfigFixture();
  fixtures.push(fixture);
  const providers = await fixture.read('providers.json');
  const pricing = await fixture.read('pricing.json');
  const budgets = await fixture.read('budgets.json');

  const provider = nestedObject(
    nestedObject(providers, 'providers'),
    'local-ai',
  );
  Object.assign(provider, {
    enabled: true,
    model: MODEL,
    maxInputTokens: 500,
    maxOutputTokens: 200,
    maxCallsPerTask: 1,
    maxCostPerTask: { currency: 'USD', amountMicros: 0 },
    timeoutMs: 30_000,
  });
  nestedObject(provider, 'retryPolicy')['maxRetries'] = 0;

  const snapshots = pricing['snapshots'];
  if (!Array.isArray(snapshots)) {
    throw new Error('pricing snapshots fixture must be an array');
  }
  const pricingSnapshot = snapshots.find(
    (candidate) =>
      nestedObject({ candidate }, 'candidate')['provider'] === 'local-ai',
  );
  Object.assign(nestedObject({ pricingSnapshot }, 'pricingSnapshot'), {
    model: MODEL,
    currency: 'USD',
    inputRatePerMillionTokens: 0,
    outputRatePerMillionTokens: 0,
    cacheReadRatePerMillionTokens: 0,
    cacheWriteRatePerMillionTokens: 0,
    effectiveAt: '2026-08-01T00:00:00.000Z',
    retrievedAt: '2026-08-01T00:00:00.000Z',
    source: 'acceptance-test',
    status: 'known',
  });

  budgets['defaultBudgetClass'] = 'STRONG_ALLOWED';
  const limits = nestedObject(budgets, 'limits');
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
    maxRetriesPerTask: 0,
    maxRetriesPerProviderTask: 0,
  });
  nestedObject(limits, 'localWallTime')['maxMillisecondsPerTask'] = 60_000;

  await fixture.write('providers.json', providers);
  await fixture.write('pricing.json', pricing);
  await fixture.write('budgets.json', budgets);
  const snapshot = await fixture.load();

  const repository = await mkdtemp(
    join(tmpdir(), 'ikimetr-ollama-acceptance-'),
  );
  temporaryDirectories.push(repository);
  const ledger = await AccountingLedger.open(repository);
  const pricingResolver = new PricingResolver(snapshot);
  const controller = await BudgetController.initialize({
    ledger,
    config: snapshot,
    pricingResolver,
    now,
  });

  const adapter = OllamaAdapter.create({
    config: {
      provider: 'local-ai',
      model: MODEL,
      digest: DIGEST,
      maxInputTokens:
        snapshot.configuration.providers.providers['local-ai'].maxInputTokens!,
      maxOutputTokens:
        snapshot.configuration.providers.providers['local-ai'].maxOutputTokens!,
      maxCallsPerTask:
        snapshot.configuration.providers.providers['local-ai'].maxCallsPerTask!,
      timeoutMs:
        snapshot.configuration.providers.providers['local-ai'].timeoutMs!,
    },
    budgetController: controller,
    ledger,
    configSnapshot: snapshot,
    now,
  });

  return { adapter, ledger, config: snapshot };
}

const echoSchema = z
  .object({
    echo: z.string(),
  })
  .strict();

describe('Ollama real acceptance test', () => {
  it(
    'health probe confirms model and digest',
    async () => {
      const { adapter } = await createHarness();
      const result = await adapter.health();
      expect(result.status).toBe('healthy');
      expect(result.model).toBe(MODEL);
      expect(result.digest).toBe(DIGEST);
    },
    60_000,
  );

  it(
    'invoke with simple prompt returns valid response',
    async () => {
      const { adapter, ledger } = await createHarness();
      const result = await adapter.invoke({
        prompt:
          'Return exactly this JSON and nothing else: {"echo":"hello"}',
        temperature: 0,
        maxTokens: 50,
      });

      expect(result.text).toContain('hello');
      expect(result.inputTokens).toBeGreaterThan(0);
      expect(result.outputTokens).toBeGreaterThan(0);
      expect(result.latencyMs).toBeGreaterThan(0);

      const events = await ledger.replay();
      const reservations = events.filter(
        (e) => e.event_type === 'BudgetReservation',
      );
      expect(reservations.length).toBe(1);

      const settlements = events.filter(
        (e) =>
          e.event_type === 'BudgetSettlement' &&
          e.disposition === 'settled',
      );
      expect(settlements.length).toBe(1);

      const completed = events.filter(
        (e) =>
          e.event_type === 'AttemptCompleted' && e.status === 'completed',
      );
      expect(completed.length).toBe(1);

      if (completed[0]?.event_type === 'AttemptCompleted') {
        expect(completed[0].actual_cost).toEqual({
          currency: 'USD',
          amountMicros: 0,
        });
      }
    },
    60_000,
  );

  it(
    'structured invoke validates output schema',
    async () => {
      const { adapter } = await createHarness();
      const result = await adapter.invokeStructured({
        prompt:
          'Return exactly this JSON and nothing else: {"echo":"structured-test"}',
        schema: echoSchema,
        temperature: 0,
        maxTokens: 50,
      });

      expect(result.parsed).toEqual({ echo: 'structured-test' });
      expect(result.inputTokens).toBeGreaterThan(0);
      expect(result.outputTokens).toBeGreaterThan(0);
    },
    60_000,
  );
});
