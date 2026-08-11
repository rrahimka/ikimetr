import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import {
  AccountingLedger,
  BudgetController,
  type ConfigSnapshot,
  OllamaAdapter,
  OllamaAdapterError,
  PricingResolver,
} from '../src/index.js';
import {
  type ConfigFixture,
  createConfigFixture,
  type JsonObject,
  nestedObject,
} from './config-fixture.js';

const MODEL = 'qwen2.5-coder:7b';
const DIGEST =
  'dae161e27b0e90dd1856c8bb3209201fd6736d8eb66298e75ed87571486f4364';
const OLLAMA_URL = 'http://127.0.0.1:11434';

const fixtures: ConfigFixture[] = [];
const temporaryDirectories: string[] = [];
const now = () => new Date('2026-08-09T12:00:00.000Z');
const originalEnv = { ...process.env };

beforeEach(() => {
  vi.restoreAllMocks();
  process.env.IKIMETR_LOCAL_AI_URL = OLLAMA_URL;
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
  readonly adapter: OllamaAdapter;
  readonly ledger: AccountingLedger;
  readonly config: ConfigSnapshot;
  readonly repository: string;
}

async function createHarness(
  mutate?: (configuration: {
    providers: JsonObject;
    pricing: JsonObject;
    budgets: JsonObject;
  }) => void,
): Promise<AdapterHarness> {
  const fixture = await createConfigFixture();
  fixtures.push(fixture);
  const providers = await fixture.read('providers.json');
  const pricing = await fixture.read('pricing.json');
  const budgets = await fixture.read('budgets.json');

  configureProvider(providers, 'local-ai', MODEL);
  configurePricing(pricing, 'local-ai', MODEL);
  configureBudgets(budgets);
  mutate?.({ providers, pricing, budgets });

  await fixture.write('providers.json', providers);
  await fixture.write('pricing.json', pricing);
  await fixture.write('budgets.json', budgets);
  const snapshot = await fixture.load();

  const repository = await mkdtemp(join(tmpdir(), 'ikimetr-ollama-test-'));
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

  return { adapter, ledger, config: snapshot, repository };
}

function configureProvider(
  configuration: JsonObject,
  providerId: 'local-ai',
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
    maxCallsPerTask: 1,
    maxCostPerTask: { currency: 'USD', amountMicros: 0 },
    timeoutMs: 5_000,
  });
  nestedObject(provider, 'retryPolicy')['maxRetries'] = 0;
}

function configurePricing(
  configuration: JsonObject,
  providerId: 'local-ai',
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
    inputRatePerMillionTokens: 0,
    outputRatePerMillionTokens: 0,
    cacheReadRatePerMillionTokens: 0,
    cacheWriteRatePerMillionTokens: 0,
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
    maxRetriesPerTask: 0,
    maxRetriesPerProviderTask: 0,
  });
  nestedObject(limits, 'localWallTime')['maxMillisecondsPerTask'] = 60_000;
}

function mockFetch(
  responseFactory: (
    url: string,
    init?: RequestInit,
  ) => Response | Promise<Response>,
): void {
  vi.spyOn(globalThis, 'fetch').mockImplementation(
    (input: Parameters<typeof globalThis.fetch>[0], init?: Parameters<typeof globalThis.fetch>[1]) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      const result = responseFactory(url, init);
      return Promise.resolve(result) as ReturnType<typeof fetch>;
    },
  );
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function tagsResponse(
  models: Array<{ name: string; digest: string }>,
): Response {
  return jsonResponse({ models });
}

function generateResponse(overrides: Record<string, unknown> = {}): Response {
  return jsonResponse({
    model: MODEL,
    created_at: '2026-08-09T12:00:00Z',
    response: '{"result":"ok"}',
    done: true,
    total_duration: 1_000_000_000,
    load_duration: 100_000_000,
    prompt_eval_count: 10,
    prompt_eval_duration: 500_000_000,
    eval_count: 5,
    eval_duration: 400_000_000,
    ...overrides,
  });
}

// ─── Endpoint Security ───────────────────────────────────────────────

describe('OllamaAdapter endpoint security', () => {
  it('accepts localhost endpoint', async () => {
    mockFetch(() => tagsResponse([{ name: MODEL, digest: DIGEST }]));
    const { adapter } = await createHarness();
    const result = await adapter.health();
    expect(result.status).toBe('healthy');
  });

  it('rejects non-local endpoint via env var', async () => {
    process.env.IKIMETR_LOCAL_AI_URL = 'http://192.168.1.1:11434';
    await expect(createHarness()).rejects.toThrow(OllamaAdapterError);
  });

  it('rejects endpoint with wrong port', async () => {
    process.env.IKIMETR_LOCAL_AI_URL = 'http://127.0.0.1:8080';
    await expect(createHarness()).rejects.toThrow(OllamaAdapterError);
  });

  it('rejects https endpoint', async () => {
    process.env.IKIMETR_LOCAL_AI_URL = 'https://127.0.0.1:11434';
    await expect(createHarness()).rejects.toThrow(OllamaAdapterError);
  });

  it('rejects endpoint with path', async () => {
    process.env.IKIMETR_LOCAL_AI_URL = 'http://127.0.0.1:11434/v2';
    await expect(createHarness()).rejects.toThrow(OllamaAdapterError);
  });

  it('rejects endpoint with hostname other than 127.0.0.1', async () => {
    process.env.IKIMETR_LOCAL_AI_URL = 'http://localhost:11434';
    await expect(createHarness()).rejects.toThrow(OllamaAdapterError);
  });
});

// ─── Health Probe ────────────────────────────────────────────────────

describe('OllamaAdapter health probe', () => {
  it('returns healthy when model and digest match', async () => {
    mockFetch(() => tagsResponse([{ name: MODEL, digest: DIGEST }]));
    const { adapter } = await createHarness();
    const result = await adapter.health();
    expect(result.status).toBe('healthy');
    expect(result.model).toBe(MODEL);
    expect(result.digest).toBe(DIGEST);
  });

  it('returns unavailable when model not found', async () => {
    mockFetch(() => tagsResponse([{ name: 'other-model', digest: 'abc123' }]));
    const { adapter } = await createHarness();
    const result = await adapter.health();
    expect(result.status).toBe('unavailable');
  });

  it('returns unavailable when digest does not match', async () => {
    mockFetch(() =>
      tagsResponse([{ name: MODEL, digest: 'different-digest' }]),
    );
    const { adapter } = await createHarness();
    const result = await adapter.health();
    expect(result.status).toBe('unavailable');
  });

  it('returns malformed when response is not valid schema', async () => {
    mockFetch(() => jsonResponse({ not_models: true }));
    const { adapter } = await createHarness();
    const result = await adapter.health();
    expect(result.status).toBe('malformed');
  });

  it('returns malformed when response is not JSON', async () => {
    mockFetch(() => new Response('not json', { status: 200 }));
    const { adapter } = await createHarness();
    const result = await adapter.health();
    expect(result.status).toBe('malformed');
  });

  it('returns unavailable on non-200 status', async () => {
    mockFetch(() => new Response('error', { status: 500 }));
    const { adapter } = await createHarness();
    const result = await adapter.health();
    expect(result.status).toBe('unavailable');
  });

  it('returns timeout on abort', async () => {
    mockFetch(() => {
      const controller = new AbortController();
      controller.abort();
      throw new DOMException('The operation was aborted.', 'AbortError');
    });
    const { adapter } = await createHarness();
    const result = await adapter.health();
    expect(result.status).toBe('unavailable');
  });

  it('logs health events to ledger', async () => {
    mockFetch(() => tagsResponse([{ name: MODEL, digest: DIGEST }]));
    const { adapter, ledger } = await createHarness();
    await adapter.health();

    const events = await ledger.replay();
    const healthEvents = events.filter(
      (e) => e.event_type === 'ProviderHealthEvent',
    );
    expect(healthEvents.length).toBeGreaterThanOrEqual(1);
    const lastHealth = healthEvents.at(-1)!;
    expect(lastHealth.event_type).toBe('ProviderHealthEvent');
    expect(lastHealth.status).toBe('healthy');
  });
});

// ─── Model Pinning ───────────────────────────────────────────────────

describe('OllamaAdapter model pinning', () => {
  it('accepts exact model match', async () => {
    mockFetch(() => generateResponse({ model: MODEL }));
    const { adapter } = await createHarness();
    const result = await adapter.invoke({ prompt: 'test' });
    expect(result.text).toBe('{"result":"ok"}');
  });

  it('rejects model mismatch in response', async () => {
    mockFetch(() => generateResponse({ model: 'wrong-model' }));
    const { adapter } = await createHarness();
    await expect(adapter.invoke({ prompt: 'test' })).rejects.toThrow(
      OllamaAdapterError,
    );
    await expect(adapter.invoke({ prompt: 'test' })).rejects.toSatisfy(
      (e: unknown) => e instanceof OllamaAdapterError && e.code === 'MODEL_MISMATCH',
    );
  });

  it('rejects digest mismatch in health', async () => {
    mockFetch(() =>
      tagsResponse([{ name: MODEL, digest: 'wrong-digest' }]),
    );
    const { adapter } = await createHarness();
    const result = await adapter.health();
    expect(result.status).toBe('unavailable');
  });
});

// ─── Invocation ──────────────────────────────────────────────────────

describe('OllamaAdapter invocation', () => {
  it('successfully invokes and returns text', async () => {
    mockFetch(() => generateResponse());
    const { adapter } = await createHarness();
    const result = await adapter.invoke({ prompt: 'test prompt' });
    expect(result.text).toBe('{"result":"ok"}');
    expect(result.inputTokens).toBeGreaterThan(0);
    expect(result.outputTokens).toBeGreaterThan(0);
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it('rejects on timeout', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(() => {
      return new Promise((_resolve, reject) => {
        const error = new DOMException(
          'The operation was aborted.',
          'AbortError',
        );
        reject(error);
      });
    });
    const { adapter } = await createHarness();
    await expect(adapter.invoke({ prompt: 'test' })).rejects.toThrow(
      OllamaAdapterError,
    );
  });

  it('rejects on malformed JSON response', async () => {
    mockFetch(() => new Response('not json', { status: 200 }));
    const { adapter } = await createHarness();
    await expect(adapter.invoke({ prompt: 'test' })).rejects.toThrow(
      OllamaAdapterError,
    );
  });

  it('rejects on non-200 response', async () => {
    mockFetch(() => new Response('error', { status: 500 }));
    const { adapter } = await createHarness();
    await expect(adapter.invoke({ prompt: 'test' })).rejects.toThrow(
      OllamaAdapterError,
    );
  });

  it('rejects on redirect status', async () => {
    mockFetch(() => new Response('redirected', { status: 301 }));
    const { adapter } = await createHarness();
    await expect(adapter.invoke({ prompt: 'test' })).rejects.toSatisfy(
      (e: unknown) => e instanceof OllamaAdapterError && e.code === 'REDIRECT_REJECTED',
    );
  });

  it('rejects when response not done', async () => {
    mockFetch(() => generateResponse({ done: false }));
    const { adapter } = await createHarness();
    await expect(adapter.invoke({ prompt: 'test' })).rejects.toThrow(
      OllamaAdapterError,
    );
  });

  it('rejects when response missing required fields', async () => {
    mockFetch(() => jsonResponse({ model: MODEL, created_at: 'x', done: true }));
    const { adapter } = await createHarness();
    await expect(adapter.invoke({ prompt: 'test' })).rejects.toThrow(
      OllamaAdapterError,
    );
  });
});

// ─── Structured Output ───────────────────────────────────────────────

describe('OllamaAdapter structured output', () => {
  it('validates structured output successfully', async () => {
    mockFetch(() =>
      generateResponse({ response: '{"key":"value","count":42}' }),
    );
    const { adapter } = await createHarness();
    const schema = z.object({ key: z.string(), count: z.number() }).strict();
    const result = await adapter.invokeStructured({
      prompt: 'test',
      schema,
    });
    expect(result.text).toBe('{"key":"value","count":42}');
  });

  it('rejects malformed JSON in structured output', async () => {
    mockFetch(() =>
      generateResponse({ response: 'not valid json at all' }),
    );
    const { adapter } = await createHarness();
    const schema = z.object({}).passthrough();
    await expect(
      adapter.invokeStructured({ prompt: 'test', schema }),
    ).rejects.toThrow(OllamaAdapterError);
  });

  it('rejects tool-call-like output', async () => {
    mockFetch(() =>
      generateResponse({
        response: 'function execute() { require("child_process") }',
      }),
    );
    const { adapter } = await createHarness();
    const schema = z.object({}).passthrough();
    await expect(
      adapter.invokeStructured({ prompt: 'test', schema }),
    ).rejects.toSatisfy(
      (e: unknown) => e instanceof OllamaAdapterError && e.code === 'TOOL_CALL_DETECTED',
    );
  });

  it('rejects spawn-like output', async () => {
    mockFetch(() =>
      generateResponse({ response: 'spawn("cmd.exe")' }),
    );
    const { adapter } = await createHarness();
    const schema = z.object({}).passthrough();
    await expect(
      adapter.invokeStructured({ prompt: 'test', schema }),
    ).rejects.toSatisfy(
      (e: unknown) => e instanceof OllamaAdapterError && e.code === 'TOOL_CALL_DETECTED',
    );
  });
  it('sends format json for structured invoke', async () => {
    let capturedBody: string | undefined;
    mockFetch((_url, init) => {
      capturedBody = init?.body as string | undefined;
      return generateResponse({ response: '{"key":"value"}' });
    });
    const { adapter } = await createHarness();
    await adapter.invokeStructured({
      prompt: 'test',
      schema: z.object({ key: z.string() }).passthrough(),
    });
    expect(capturedBody).toContain('"format":"json"');
  });

  it('does not send format for normal invoke', async () => {
    let capturedBody: string | undefined;
    mockFetch((_url, init) => {
      capturedBody = init?.body as string | undefined;
      return generateResponse();
    });
    const { adapter } = await createHarness();
    await adapter.invoke({ prompt: 'test' });
    expect(capturedBody).not.toContain('"format"');
  });
});

// ─── Budget & Accounting ─────────────────────────────────────────────

describe('OllamaAdapter budget and accounting', () => {
  it('reports zero monetary cost', async () => {
    mockFetch(() => generateResponse());
    const { adapter, ledger } = await createHarness();
    await adapter.invoke({ prompt: 'test' });

    const events = await ledger.replay();
    const attempts = events.filter((e) => e.event_type === 'AttemptCompleted');
    expect(attempts.length).toBeGreaterThanOrEqual(1);
    const completed = attempts.at(-1)!;
    if (completed.event_type === 'AttemptCompleted') {
      expect(completed.actual_cost).toEqual({
        currency: 'USD',
        amountMicros: 0,
      });
    }
  });

  it('reserves budget before invocation', async () => {
    mockFetch(() => generateResponse());
    const { adapter, ledger } = await createHarness();
    await adapter.invoke({ prompt: 'test' });

    const events = await ledger.replay();
    const reservations = events.filter(
      (e) => e.event_type === 'BudgetReservation',
    );
    expect(reservations.length).toBeGreaterThanOrEqual(1);
  });

  it('settles budget after successful invocation', async () => {
    mockFetch(() => generateResponse());
    const { adapter, ledger } = await createHarness();
    await adapter.invoke({ prompt: 'test' });

    const events = await ledger.replay();
    const settlements = events.filter(
      (e) =>
        e.event_type === 'BudgetSettlement' &&
        e.disposition === 'settled',
    );
    expect(settlements.length).toBeGreaterThanOrEqual(1);
  });

  it('releases budget on failure', async () => {
    mockFetch(() => new Response('error', { status: 500 }));
    const { adapter, ledger } = await createHarness();

    await expect(adapter.invoke({ prompt: 'test' })).rejects.toThrow(
      OllamaAdapterError,
    );

    const events = await ledger.replay();
    const releases = events.filter(
      (e) =>
        e.event_type === 'BudgetSettlement' &&
        e.disposition === 'released',
    );
    expect(releases.length).toBeGreaterThanOrEqual(1);

    const settled = events.filter(
      (e) =>
        e.event_type === 'BudgetSettlement' &&
        e.disposition === 'settled',
    );
    expect(settled.length).toBe(0);
  });

  it('enforces maxCallsPerTask limit', async () => {
    mockFetch(() => generateResponse());
    const { adapter } = await createHarness();

    await adapter.invoke({ prompt: 'test 1' });

    await expect(adapter.invoke({ prompt: 'test 2' })).rejects.toThrow();
  });

  it('does not automatically retry on failure', async () => {
    let callCount = 0;
    mockFetch(() => {
      callCount++;
      return new Response('error', { status: 500 });
    });
    const { adapter } = await createHarness();

    await expect(adapter.invoke({ prompt: 'test' })).rejects.toThrow(
      OllamaAdapterError,
    );
    expect(callCount).toBe(1);
  });

  it('appends AttemptStarted event', async () => {
    mockFetch(() => generateResponse());
    const { adapter, ledger } = await createHarness();
    await adapter.invoke({ prompt: 'test' });

    const events = await ledger.replay();
    const starts = events.filter((e) => e.event_type === 'AttemptStarted');
    expect(starts.length).toBeGreaterThanOrEqual(1);
  });

  it('appends AttemptCompleted event on success', async () => {
    mockFetch(() => generateResponse());
    const { adapter, ledger } = await createHarness();
    await adapter.invoke({ prompt: 'test' });

    const events = await ledger.replay();
    const completed = events.filter(
      (e) =>
        e.event_type === 'AttemptCompleted' && e.status === 'completed',
    );
    expect(completed.length).toBeGreaterThanOrEqual(1);
  });

  it('appends AttemptCompleted event on failure', async () => {
    mockFetch(() => new Response('error', { status: 500 }));
    const { adapter, ledger } = await createHarness();

    await expect(adapter.invoke({ prompt: 'test' })).rejects.toThrow(
      OllamaAdapterError,
    );

    const events = await ledger.replay();
    const failed = events.filter(
      (e) =>
        e.event_type === 'AttemptCompleted' && e.status === 'failed',
    );
    expect(failed.length).toBeGreaterThanOrEqual(1);
  });
});

// ─── Response Size Limits ────────────────────────────────────────────

describe('OllamaAdapter response size limits', () => {
  it('rejects response exceeding byte limit', async () => {
    const hugeString = 'x'.repeat(200_000);
    mockFetch(() => jsonResponse({ huge: hugeString }));
    const { adapter } = await createHarness();
    await expect(adapter.invoke({ prompt: 'test' })).rejects.toSatisfy(
      (e: unknown) => e instanceof OllamaAdapterError && e.code === 'RESPONSE_TOO_LARGE',
    );
  });
});

// ─── Config Integrity ────────────────────────────────────────────────

describe('OllamaAdapter config integrity', () => {
  it('provider config has model set', async () => {
    const { config } = await createHarness();
    const provider = config.configuration.providers.providers['local-ai'];
    expect(provider.model).toBe(MODEL);
  });

  it('provider config has zero-cost pricing', async () => {
    const { config } = await createHarness();
    const pricing = config.configuration.pricing.snapshots.find(
      (s) => s.provider === 'local-ai',
    );
    expect(pricing?.inputRatePerMillionTokens).toBe(0);
    expect(pricing?.outputRatePerMillionTokens).toBe(0);
  });
});

// ─── AbortSignal ─────────────────────────────────────────────────────

describe('OllamaAdapter AbortSignal respect', () => {
  it('respects AbortSignal on timeout', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(() => {
      return new Promise((_resolve, reject) => {
        const error = new DOMException('aborted', 'AbortError');
        reject(error);
      });
    });
    const { adapter } = await createHarness();
    await expect(adapter.invoke({ prompt: 'test' })).rejects.toSatisfy(
      (e: unknown) => e instanceof OllamaAdapterError && e.code === 'TIMEOUT',
    );
  });
});
