import { afterEach, describe, expect, it } from 'vitest';

import {
  calculateMicrosForTokens,
  createMoney,
  addMoney,
  PricingResolutionError,
  PricingResolver,
} from '../src/index.js';
import {
  type ConfigFixture,
  createConfigFixture,
  nestedObject,
} from './config-fixture.js';

const fixtures: ConfigFixture[] = [];

afterEach(async () => {
  await Promise.all(fixtures.splice(0).map((fixture) => fixture.dispose()));
});

async function loadSnapshotWithPricing(
  status: 'known' | 'stale' | 'unknown' = 'known',
) {
  const fixture = await createConfigFixture();
  fixtures.push(fixture);
  const pricing = await fixture.read('pricing.json');
  const snapshots = pricing['snapshots'];
  if (!Array.isArray(snapshots)) {
    throw new Error('pricing snapshots fixture must be an array');
  }

  const deepseek = snapshots.find(
    (snapshot) =>
      nestedObject({ snapshot }, 'snapshot')['provider'] === 'deepseek',
  );
  const value = nestedObject({ deepseek }, 'deepseek');
  value['status'] = status;

  if (status !== 'unknown') {
    value['model'] = 'deepseek-test';
    value['currency'] = 'USD';
    value['inputRatePerMillionTokens'] = 2_000_000;
    value['outputRatePerMillionTokens'] = 4_000_000;
    value['cacheReadRatePerMillionTokens'] = 500_000;
    value['cacheWriteRatePerMillionTokens'] = 1_000_000;
    value['effectiveAt'] = '2026-08-01T00:00:00.000Z';
    value['retrievedAt'] = '2026-08-01T00:00:00.000Z';
    value['source'] = 'test-fixture';
  }

  await fixture.write('pricing.json', pricing);
  return fixture.load();
}

describe('integer-micros money arithmetic', () => {
  it('rounds fractional micros up without floating-point arithmetic', () => {
    expect(calculateMicrosForTokens(1, 1)).toBe(1);
    expect(calculateMicrosForTokens(1_000_001, 1_000_000)).toBe(
      1_000_001,
    );
  });

  it('rejects unsafe integers and overflow', () => {
    expect(() => createMoney('USD', Number.MAX_SAFE_INTEGER + 1)).toThrow();
    expect(() =>
      calculateMicrosForTokens(
        Number.MAX_SAFE_INTEGER,
        Number.MAX_SAFE_INTEGER,
      ),
    ).toThrow(/safe integer/u);
  });

  it('rejects arithmetic across currencies', () => {
    expect(() =>
      addMoney(createMoney('USD', 1), createMoney('EUR', 1)),
    ).toThrow(/currencies/u);
  });
});

describe('PricingResolver', () => {
  it('resolves an exact known snapshot and calculates all token classes', async () => {
    const resolver = new PricingResolver(await loadSnapshotWithPricing());
    const pricing = resolver.resolve({
      provider: 'deepseek',
      model: 'deepseek-test',
      automatic: true,
      cloud: true,
    });

    expect(
      resolver.calculateCost(pricing, {
        inputTokens: 1_000_000,
        outputTokens: 500_000,
        cacheReadTokens: 2_000_000,
        cacheWriteTokens: 1_000_000,
      }),
    ).toEqual({ currency: 'USD', amountMicros: 6_000_000 });
  });

  it.each(['stale', 'unknown'] as const)(
    'blocks automatic cloud usage when pricing is %s',
    async (status) => {
      const resolver = new PricingResolver(
        await loadSnapshotWithPricing(status),
      );

      expect(() =>
        resolver.resolve({
          provider: 'deepseek',
          model: 'deepseek-test',
          automatic: true,
          cloud: true,
        }),
      ).toThrow(PricingResolutionError);
    },
  );

  it('rejects a model that does not exactly match the snapshot', async () => {
    const resolver = new PricingResolver(await loadSnapshotWithPricing());

    expect(() =>
      resolver.resolve({
        provider: 'deepseek',
        model: 'different-model',
        automatic: false,
        cloud: true,
      }),
    ).toThrow(/model/u);
  });

  it('rejects fractional pricing rates in configuration', async () => {
    const fixture = await createConfigFixture();
    fixtures.push(fixture);
    const pricing = await fixture.read('pricing.json');
    const snapshots = pricing['snapshots'];
    if (!Array.isArray(snapshots)) {
      throw new Error('pricing snapshots fixture must be an array');
    }
    const local = nestedObject(
      {
        local: snapshots.find(
          (snapshot) =>
            nestedObject({ snapshot }, 'snapshot')['provider'] === 'local-ai',
        ),
      },
      'local',
    );
    Object.assign(local, {
      status: 'known',
      model: 'local-test',
      currency: 'USD',
      inputRatePerMillionTokens: 0.5,
      outputRatePerMillionTokens: 1,
      cacheReadRatePerMillionTokens: null,
      cacheWriteRatePerMillionTokens: null,
      effectiveAt: '2026-08-01T00:00:00.000Z',
      retrievedAt: '2026-08-01T00:00:00.000Z',
      source: 'test-fixture',
    });
    await fixture.write('pricing.json', pricing);

    await expect(fixture.load()).rejects.toThrow();
  });
});
