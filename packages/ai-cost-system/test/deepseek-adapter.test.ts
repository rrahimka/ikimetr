import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  AccountingLedger,
  BudgetController,
  DeepSeekAdapter,
  type DeepSeekAdapterError,
  PricingResolver,
} from '../src/index.js';
import {
  type ConfigFixture,
  createConfigFixture,
  type JsonObject,
  nestedObject,
} from './config-fixture.js';

const MODEL = 'deepseek-v3-test';
const TEST_KEY = 'sk-test-deepseek-key-12345';
const DEEPSEEK_URL = 'https://api.deepseek.com';

const fixtures: ConfigFixture[] = [];
const temporaryDirectories: string[] = [];
const now = () => new Date('2026-08-09T12:00:00.000Z');
const originalEnv = { ...process.env };

beforeEach(() => {
  vi.restoreAllMocks();
  process.env.DEEPSEEK_API_KEY = TEST_KEY;
});

afterEach(async () => {
  process.env = { ...originalEnv };
  await Promise.all(fixtures.splice(0).map((f) => f.dispose()));
  await Promise.all(
    temporaryDirectories.splice(0).map((d) =>
      rm(d, { force: true, recursive: true }),
    ),
  );
});

interface AdapterHarness {
  readonly adapter: DeepSeekAdapter;
  readonly ledger: AccountingLedger;
}

async function createHarness(baseUrl?: string): Promise<AdapterHarness> {
  const fixture = await createConfigFixture();
  fixtures.push(fixture);
  const providers = await fixture.read('providers.json');
  const pricing = await fixture.read('pricing.json');
  const budgets = await fixture.read('budgets.json');

  configureProvider(providers, 'deepseek', MODEL);
  configurePricing(pricing, 'deepseek', MODEL);
  configureBudgets(budgets);

  await fixture.write('providers.json', providers);
  await fixture.write('pricing.json', pricing);
  await fixture.write('budgets.json', budgets);
  const snapshot = await fixture.load();

  const repository = await mkdtemp(join(tmpdir(), 'ikimetr-deepseek-test-'));
  temporaryDirectories.push(repository);
  const ledger = await AccountingLedger.open(repository);
  const controller = await BudgetController.initialize({
    ledger,
    config: snapshot,
    pricingResolver: new PricingResolver(snapshot),
    now,
  });

  const adapter = DeepSeekAdapter.create({
    config: {
      provider: 'deepseek',
      model: MODEL,
      maxInputTokens: 4096,
      maxOutputTokens: 2048,
      maxCallsPerTask: 10,
      timeoutMs: 5000,
      ...(baseUrl ? { baseUrl } : {}),
    },
    budgetController: controller,
    ledger,
    configSnapshot: snapshot,
    now,
  });

  return { adapter, ledger };
}

function configureProvider(
  configuration: JsonObject,
  providerId: 'deepseek',
  model: string,
): void {
  const provider = nestedObject(
    nestedObject(configuration, 'providers'),
    providerId,
  );
  Object.assign(provider, {
    enabled: true,
    model,
    maxInputTokens: 4096,
    maxOutputTokens: 2048,
    maxCallsPerTask: 10,
    maxCostPerTask: { currency: 'USD', amountMicros: 10_000_000 },
    timeoutMs: 5_000,
  });
  nestedObject(provider, 'retryPolicy')['maxRetries'] = 0;
}

function configurePricing(
  configuration: JsonObject,
  providerId: 'deepseek',
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
    inputRatePerMillionTokens: 140_000,
    outputRatePerMillionTokens: 280_000,
    cacheReadRatePerMillionTokens: 14_000,
    cacheWriteRatePerMillionTokens: 140_000,
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
      maxInputTokens: 20_000,
      maxOutputTokens: 20_000,
      maxCalls: 20,
      maxCost: {
        currency: 'USD',
        amountMicros: 20_000_000,
      },
    });
  }

  nestedObject(limits, 'cloudCallsTask')['maxCalls'] = 10;

  Object.assign(nestedObject(limits, 'retryLimits'), {
    maxRetriesPerTask: 0,
    maxRetriesPerProviderTask: 0,
  });

  nestedObject(limits, 'localWallTime')['maxMillisecondsPerTask'] = 20_000;
}

describe('DeepSeekAdapter Foundation', () => {
  it('1. missing key fails preflight before fetch', async () => {
    delete process.env.DEEPSEEK_API_KEY;
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const { adapter } = await createHarness();

    try {
      await adapter.invoke({ prompt: 'hello' });
      expect.fail('should throw');
    } catch (err) {
      expect((err as DeepSeekAdapterError).code).toBe('MISSING_API_KEY');
    }
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it.each([
    ['http://example.invalid', 'non-HTTPS endpoint'],
    ['https://user:pass@api.deepseek.com', 'userinfo URL'],
  ])('2 & 3. invalid URL (%s) rejected before fetch', async (url) => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const { adapter } = await createHarness(url);

    try {
      await adapter.invoke({ prompt: 'hello' });
      expect.fail('should throw');
    } catch (err) {
      expect((err as DeepSeekAdapterError).code).toBe('INVALID_ENDPOINT');
    }
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('4 & 5 & 6. correct HTTPS endpoint, Authorization header, single fetch', async () => {
    const { adapter } = await createHarness();
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [{ message: { content: 'DeepSeek response' } }],
          usage: { prompt_tokens: 10, completion_tokens: 20 },
        }),
        { status: 200 },
      ),
    );

    const res = await adapter.invoke({ prompt: 'write function' });
    expect(res.text).toBe('DeepSeek response');
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [callUrl, callInit] = fetchSpy.mock.calls[0] ?? [];
    expect(callUrl).toBe(`${DEEPSEEK_URL}/chat/completions`);
    expect(callInit?.headers).toEqual({
      'content-type': 'application/json',
      authorization: `Bearer ${TEST_KEY}`,
    });
  });

  it('7 & 8. success parses content + usage and settles budget', async () => {
    const { adapter, ledger } = await createHarness();
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [{ message: { content: 'OK' } }],
          usage: { prompt_tokens: 12, completion_tokens: 24 },
        }),
        { status: 200 },
      ),
    );

    const result = await adapter.invoke({ prompt: 'Hello' });
    expect(result.text).toBe('OK');
    expect(result.inputTokens).toBe(12);
    expect(result.outputTokens).toBe(24);

    const events = await ledger.replay();
    expect(events).toHaveLength(4);
    expect(events[1]?.event_type).toBe('AttemptStarted');
    expect(events[3]?.event_type).toBe('AttemptCompleted');
    const lastEvent = events[3];
    if (lastEvent?.event_type === 'AttemptCompleted') {
      expect(lastEvent.status).toBe('completed');
    } else {
      expect.fail('expected AttemptCompleted');
    }
  });

  it('9. network error -> NETWORK_ERROR + budget release', async () => {
    const { adapter, ledger } = await createHarness();
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('DNS failure'));

    try {
      await adapter.invoke({ prompt: 'test' });
      expect.fail('should throw');
    } catch (err) {
      expect((err as DeepSeekAdapterError).code).toBe('NETWORK_ERROR');
    }
    const events = await ledger.replay();
    const lastEvent = events.at(-1);
    if (lastEvent?.event_type === 'AttemptCompleted') {
      expect(lastEvent.status).toBe('failed');
    } else {
      expect.fail('expected AttemptCompleted');
    }
  });

  it('10. timeout -> TIMEOUT + budget release', async () => {
    const { adapter, ledger } = await createHarness();
    const abortErr = new Error('AbortError');
    abortErr.name = 'AbortError';
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(abortErr);

    try {
      await adapter.invoke({ prompt: 'test' });
      expect.fail('should throw');
    } catch (err) {
      expect((err as DeepSeekAdapterError).code).toBe('TIMEOUT');
    }
    const events = await ledger.replay();
    const lastEvent = events.at(-1);
    if (lastEvent?.event_type === 'AttemptCompleted') {
      expect(lastEvent.status).toBe('failed');
    } else {
      expect.fail('expected AttemptCompleted');
    }
  });

  it.each([
    [400, 'BAD_REQUEST'],
    [401, 'UNAUTHORIZED'],
    [402, 'PAYMENT_REQUIRED'],
    [422, 'UNPROCESSABLE_ENTITY'],
    [429, 'RATE_LIMITED'],
    [500, 'INTERNAL_SERVER_ERROR'],
    [503, 'SERVICE_UNAVAILABLE'],
    [301, 'REDIRECT_REJECTED'],
  ])('11 & 12. HTTP status %i mapped to %s', async (status, expectedCode) => {
    const { adapter } = await createHarness();
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('Error payload', { status }),
    );

    try {
      await adapter.invoke({ prompt: 'test' });
      expect.fail('should throw');
    } catch (err) {
      expect((err as DeepSeekAdapterError).code).toBe(expectedCode);
    }
  });

  it.each([
    ['invalid raw json', 'raw non-json body'],
    [JSON.stringify({ choices: [] }), 'missing choices element'],
    [JSON.stringify({ choices: [{ message: { content: 'hi' } }] }), 'missing usage object'],
  ])('13 & 14 & 15. malformed response (%s) -> MALFORMED_RESPONSE + release', async (body) => {
    const { adapter, ledger } = await createHarness();
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(body, { status: 200 }),
    );

    try {
      await adapter.invoke({ prompt: 'test' });
      expect.fail('should throw');
    } catch (err) {
      expect((err as DeepSeekAdapterError).code).toBe('MALFORMED_RESPONSE');
    }
    const events = await ledger.replay();
    const lastEvent = events.at(-1);
    if (lastEvent?.event_type === 'AttemptCompleted') {
      expect(lastEvent.status).toBe('failed');
    } else {
      expect.fail('expected AttemptCompleted');
    }
  });

  it('16. API key and raw prompt absent from errors and ledger events', async () => {
    const { adapter, ledger } = await createHarness();
    const promptText = 'SECRET_USER_PROMPT_CONTENT_123';
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(
      new Error(`Failed with secret key ${TEST_KEY}`),
    );

    try {
      await adapter.invoke({ prompt: promptText });
    } catch (err) {
      const errStr = String(err);
      expect(errStr).not.toContain(TEST_KEY);
      expect(errStr).not.toContain(promptText);
    }

    const eventsJson = JSON.stringify(await ledger.replay());
    expect(eventsJson).not.toContain(TEST_KEY);
    expect(eventsJson).not.toContain(promptText);
  });
});
