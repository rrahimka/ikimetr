import { randomUUID } from 'node:crypto';
import { z } from 'zod';

import type {
  BudgetController,
  BudgetReservationRequest,
  BudgetSettlementRequest,
  ReserveResult,
  SettlementResult,
} from '../budget.js';
import { canonicalize, sha256 } from '../canonical.js';
import type { AccountingLedger } from '../ledger.js';
import { parseLedgerEvent } from '../ledger-events.js';
import { createMoney } from '../money.js';
import type { ConfigSnapshot } from '../snapshot.js';
import type { ProviderId } from '../schemas.js';

const ALLOWED_HOST = '127.0.0.1';
const ALLOWED_PORT = 11434;
const OLLAMA_BASE = `http://${ALLOWED_HOST}:${ALLOWED_PORT}`;

const MAX_REQUEST_BYTES = 64 * 1024;
const MAX_RESPONSE_BYTES = 128 * 1024;

const REDIRECT_STATUS_CODES = new Set([301, 302, 303, 307, 308]);

export interface OllamaAdapterConfig {
  readonly provider: ProviderId;
  readonly model: string;
  readonly digest: string;
  readonly maxInputTokens: number;
  readonly maxOutputTokens: number;
  readonly maxCallsPerTask: number;
  readonly timeoutMs: number;
}

const ollamaTagsResponseSchema = z
  .object({
    models: z.array(
      z
        .object({
          name: z.string(),
          digest: z.string(),
        })
        .passthrough(),
    ),
  })
  .passthrough();

const ollamaGenerateResponseSchema = z
  .object({
    model: z.string(),
    created_at: z.string(),
    response: z.string(),
    done: z.boolean(),
    total_duration: z.number().int().nonnegative().optional(),
    load_duration: z.number().int().nonnegative().optional(),
    prompt_eval_count: z.number().int().nonnegative().optional(),
    prompt_eval_duration: z.number().int().nonnegative().optional(),
    eval_count: z.number().int().nonnegative().optional(),
    eval_duration: z.number().int().nonnegative().optional(),
  })
  .passthrough();

export class OllamaAdapterError extends Error {
  public constructor(
    public readonly code: string,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'OllamaAdapterError';
  }
}

export interface HealthResult {
  readonly status: 'healthy' | 'unavailable' | 'timeout' | 'malformed';
  readonly model: string;
  readonly digest: string | null;
  readonly latencyMs: number;
}

export interface InvokeParams {
  readonly prompt: string;
  readonly system?: string;
  readonly temperature?: number;
  readonly maxTokens?: number;
  readonly format?: string;
}

export interface InvokeResult {
  readonly text: string;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly latencyMs: number;
}

export interface StructuredInvokeParams<T extends z.ZodType> {
  readonly prompt: string;
  readonly system?: string;
  readonly schema: T;
  readonly temperature?: number;
  readonly maxTokens?: number;
}

export interface StructuredInvokeResult<T> {
  readonly parsed: T;
  readonly text: string;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly latencyMs: number;
}

function validateEndpoint(url: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new OllamaAdapterError(
      'INVALID_ENDPOINT',
      'Ollama endpoint URL is invalid',
    );
  }

  if (parsed.protocol !== 'http:') {
    throw new OllamaAdapterError(
      'INVALID_ENDPOINT',
      'Ollama endpoint must use http://',
    );
  }

  if (parsed.hostname !== ALLOWED_HOST) {
    throw new OllamaAdapterError(
      'INVALID_ENDPOINT',
      `Ollama endpoint must be ${ALLOWED_HOST}, got ${parsed.hostname}`,
    );
  }

  const port = parsed.port === '' ? 80 : Number(parsed.port);
  if (port !== ALLOWED_PORT) {
    throw new OllamaAdapterError(
      'INVALID_ENDPOINT',
      `Ollama endpoint must use port ${ALLOWED_PORT}, got ${port}`,
    );
  }

  if (parsed.pathname !== '/' && parsed.pathname !== '') {
    throw new OllamaAdapterError(
      'INVALID_ENDPOINT',
      'Ollama endpoint must not include a path',
    );
  }

  if (parsed.search !== '') {
    throw new OllamaAdapterError(
      'INVALID_ENDPOINT',
      'Ollama endpoint must not include query parameters',
    );
  }

  return parsed;
}

export class OllamaAdapter {
  private readonly baseUrl: string;
  private readonly taskId: string;

  private constructor(
    private readonly config: OllamaAdapterConfig,
    private readonly budgetController: BudgetController,
    private readonly ledger: AccountingLedger,
    private readonly configSnapshot: ConfigSnapshot,
    private readonly now: () => Date,
  ) {
    this.taskId = `local-task-${randomUUID()}`;
    const rawUrl =
      process.env[
        configSnapshot.configuration.providers.providers[config.provider]
          .endpoint.baseUrlEnv ?? ''
      ] ?? OLLAMA_BASE;
    const parsed = validateEndpoint(rawUrl);
    this.baseUrl = parsed.origin;
  }

  public static create(options: {
    readonly config: OllamaAdapterConfig;
    readonly budgetController: BudgetController;
    readonly ledger: AccountingLedger;
    readonly configSnapshot: ConfigSnapshot;
    readonly now?: () => Date;
  }): OllamaAdapter {
    return new OllamaAdapter(
      options.config,
      options.budgetController,
      options.ledger,
      options.configSnapshot,
      options.now ?? (() => new Date()),
    );
  }

  public async health(): Promise<HealthResult> {
    const start = Date.now();
    const healthEventId = `health-${randomUUID()}`;

    try {
      const controller = new AbortController();
      const timeout = setTimeout(
        () => controller.abort(new Error('Health probe timed out')),
        this.config.timeoutMs,
      );

      let response: Response;
      try {
        response = await fetch(`${this.baseUrl}/api/tags`, {
          method: 'GET',
          signal: controller.signal,
          redirect: 'error',
        });
      } finally {
        clearTimeout(timeout);
      }

      const latencyMs = Date.now() - start;

      if (response.status !== 200) {
        await this.appendHealthEvent(
          healthEventId,
          'unavailable',
          latencyMs,
          `non-200-status-${response.status}`,
        );
        return {
          status: 'unavailable',
          model: this.config.model,
          digest: null,
          latencyMs,
        };
      }

      const body = await this.readResponseBody(response, healthEventId);
      let parsed: z.infer<typeof ollamaTagsResponseSchema>;
      try {
        parsed = ollamaTagsResponseSchema.parse(body);
      } catch {
        await this.appendHealthEvent(
          healthEventId,
          'malformed',
          latencyMs,
          'malformed-tags-response',
        );
        return {
          status: 'malformed',
          model: this.config.model,
          digest: null,
          latencyMs,
        };
      }

      const found = parsed.models.find((m) => m.name === this.config.model);
      if (found === undefined) {
        await this.appendHealthEvent(
          healthEventId,
          'unavailable',
          latencyMs,
          'model-not-found',
        );
        return {
          status: 'unavailable',
          model: this.config.model,
          digest: null,
          latencyMs,
        };
      }

      if (found.digest !== this.config.digest) {
        await this.appendHealthEvent(
          healthEventId,
          'unavailable',
          latencyMs,
          'digest-mismatch',
        );
        return {
          status: 'unavailable',
          model: this.config.model,
          digest: found.digest,
          latencyMs,
        };
      }

      await this.appendHealthEvent(
        healthEventId,
        'healthy',
        latencyMs,
        'health-ok',
      );

      return {
        status: 'healthy',
        model: this.config.model,
        digest: found.digest,
        latencyMs,
      };
    } catch (error) {
      const latencyMs = Date.now() - start;
      const isTimeout =
        error instanceof Error && error.message === 'Health probe timed out';
      const isMalformed =
        error instanceof OllamaAdapterError &&
        error.code === 'MALFORMED_RESPONSE';
      const status = isTimeout ? 'timeout' : isMalformed ? 'malformed' : 'unavailable';
      const reason = isTimeout ? 'health-timeout' : isMalformed ? 'malformed-response' : 'health-error';

      await this.appendHealthEvent(
        healthEventId,
        status,
        latencyMs,
        reason,
      );

      return {
        status,
        model: this.config.model,
        digest: null,
        latencyMs,
      };
    }
  }

  public async invoke(params: InvokeParams): Promise<InvokeResult> {
    const attemptId = `attempt-${randomUUID()}`;
    const startTime = Date.now();
    const startIso = this.now().toISOString();

    const estimatedInputTokens = estimateTokenCount(params.prompt);
    const reservation = await this.reserveBudget(
      attemptId,
      estimatedInputTokens,
    );

    try {
      const result = await this.invokeInternal(
        params,
        reservation,
        attemptId,
        startTime,
        startIso,
      );

      await this.settleBudget(
        reservation.event.reservation_id,
        attemptId,
        result.inputTokens,
        result.outputTokens,
        0,
        0,
        result.latencyMs,
        'completed',
      );

      await this.appendAttemptCompleted(
        attemptId,
        'completed',
        result.inputTokens,
        result.outputTokens,
        result.latencyMs,
        sha256(result.text),
        null,
      );

      return result;
    } catch (error) {
      const latencyMs = Date.now() - startTime;
      const reasonCode =
        error instanceof OllamaAdapterError
          ? error.code.toLowerCase().replace(/_/g, '-')
          : 'invoke-error';

      await this.releaseBudget(
        reservation.event.reservation_id,
        attemptId,
        reasonCode,
      );

      const errorFingerprint = sha256(
        canonicalize({
          code: reasonCode,
          message: error instanceof Error ? error.message : String(error),
        }),
      );

      await this.appendAttemptCompleted(
        attemptId,
        'failed',
        0,
        0,
        latencyMs,
        null,
        errorFingerprint,
      );

      throw error;
    }
  }

  public async invokeStructured<T extends z.ZodType>(
    params: StructuredInvokeParams<T>,
  ): Promise<StructuredInvokeResult<z.infer<T>>> {
    const attemptId = `attempt-${randomUUID()}`;
    const startTime = Date.now();
    const startIso = this.now().toISOString();

    const estimatedInputTokens = estimateTokenCount(params.prompt);
    const reservation = await this.reserveBudget(
      attemptId,
      estimatedInputTokens,
    );

    try {
      const invokeParams: InvokeParams = {
        prompt: params.prompt,
        format: 'json',
        ...(params.system !== undefined ? { system: params.system } : {}),
        ...(params.temperature !== undefined ? { temperature: params.temperature } : {}),
        ...(params.maxTokens !== undefined ? { maxTokens: params.maxTokens } : {}),
      };

      const result = await this.invokeInternal(
        invokeParams,
        reservation,
        attemptId,
        startTime,
        startIso,
      );

      this.assertNoExecutableContent(result.text);

      let parsed: z.infer<T>;
      try {
        parsed = params.schema.parse(JSON.parse(result.text));
      } catch {
        throw new OllamaAdapterError(
          'MALFORMED_OUTPUT',
          'Model output failed structured output validation',
        );
      }

      await this.settleBudget(
        reservation.event.reservation_id,
        attemptId,
        result.inputTokens,
        result.outputTokens,
        0,
        0,
        result.latencyMs,
        'completed',
      );

      await this.appendAttemptCompleted(
        attemptId,
        'completed',
        result.inputTokens,
        result.outputTokens,
        result.latencyMs,
        sha256(result.text),
        null,
      );

      return {
        parsed,
        text: result.text,
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
        latencyMs: result.latencyMs,
      };
    } catch (error) {
      const latencyMs = Date.now() - startTime;
      const reasonCode =
        error instanceof OllamaAdapterError
          ? error.code.toLowerCase().replace(/_/g, '-')
          : 'invoke-error';

      await this.releaseBudget(
        reservation.event.reservation_id,
        attemptId,
        reasonCode,
      );

      const errorFingerprint = sha256(
        canonicalize({
          code: reasonCode,
          message: error instanceof Error ? error.message : String(error),
        }),
      );

      await this.appendAttemptCompleted(
        attemptId,
        'failed',
        0,
        0,
        latencyMs,
        null,
        errorFingerprint,
      );

      throw error;
    }
  }

  private async invokeInternal(
    params: InvokeParams,
    reservation: ReserveResult,
    _attemptId: string,
    startTime: number,
    startIso: string,
  ): Promise<InvokeResult> {
    const requestBody = canonicalize({
      model: this.config.model,
      prompt: params.prompt,
      system: params.system ?? '',
      stream: false,
      ...(params.format !== undefined ? { format: params.format } : {}),
      options: {
        temperature: params.temperature ?? 0,
        num_predict: Math.min(
          params.maxTokens ?? this.config.maxOutputTokens,
          this.config.maxOutputTokens,
        ),
      },
    });

    const requestBytes = Buffer.byteLength(requestBody, 'utf8');
    if (requestBytes > MAX_REQUEST_BYTES) {
      throw new OllamaAdapterError(
        'REQUEST_TOO_LARGE',
        `Request body exceeds ${MAX_REQUEST_BYTES} byte limit`,
      );
    }

    await this.appendAttemptStarted(
      _attemptId,
      params.prompt,
      reservation.event.estimated_input_tokens,
      startIso,
    );

    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(new Error('Invocation timed out')),
      this.config.timeoutMs,
    );

    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}/api/generate`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: requestBody,
        signal: controller.signal,
        redirect: 'error',
      });
    } catch (error) {
      clearTimeout(timeout);
      if (error instanceof Error && error.name === 'AbortError') {
        throw new OllamaAdapterError(
          'TIMEOUT',
          'Ollama invocation timed out',
        );
      }
      throw new OllamaAdapterError(
        'NETWORK_ERROR',
        `Ollama invocation failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      clearTimeout(timeout);
    }

    const latencyMs = Date.now() - startTime;

    if (REDIRECT_STATUS_CODES.has(response.status)) {
      throw new OllamaAdapterError(
        'REDIRECT_REJECTED',
        `Ollama returned redirect status ${response.status}`,
      );
    }

    if (response.status !== 200) {
      throw new OllamaAdapterError(
        'INVOKE_FAILED',
        `Ollama returned status ${response.status}`,
      );
    }

    const body = await this.readResponseBody(response, 'invoke');
    let parsed: z.infer<typeof ollamaGenerateResponseSchema>;
    try {
      parsed = ollamaGenerateResponseSchema.parse(body);
    } catch {
      throw new OllamaAdapterError(
        'MALFORMED_RESPONSE',
        'Ollama response failed schema validation',
      );
    }

    if (!parsed.done) {
      throw new OllamaAdapterError(
        'MALFORMED_RESPONSE',
        'Ollama response is incomplete',
      );
    }

    if (parsed.model !== this.config.model) {
      throw new OllamaAdapterError(
        'MODEL_MISMATCH',
        `Ollama returned model ${parsed.model}, expected ${this.config.model}`,
      );
    }

    const inputTokens = parsed.prompt_eval_count ?? 0;
    const outputTokens = parsed.eval_count ?? 0;

    return {
      text: parsed.response,
      inputTokens,
      outputTokens,
      latencyMs,
    };
  }

  private async readResponseBody(
    response: Response,
    context: string,
  ): Promise<unknown> {
    let text: string;
    try {
      text = await response.text();
    } catch {
      throw new OllamaAdapterError(
        'RESPONSE_READ_ERROR',
        `Failed to read response body for ${context}`,
      );
    }

    if (Buffer.byteLength(text, 'utf8') > MAX_RESPONSE_BYTES) {
      throw new OllamaAdapterError(
        'RESPONSE_TOO_LARGE',
        `Response body exceeds ${MAX_RESPONSE_BYTES} byte limit`,
      );
    }

    try {
      return JSON.parse(text);
    } catch {
      throw new OllamaAdapterError(
        'MALFORMED_RESPONSE',
        `Response body is not valid JSON for ${context}`,
      );
    }
  }

  private assertNoExecutableContent(text: string): void {
    const toolCallPatterns = [
      /\bfunction\s*\(/i,
      /\bexecute\s*\(/i,
      /\beval\s*\(/i,
      /\bimport\s+os\b/i,
      /\bimport\s+subprocess\b/i,
      /\bchild_process\b/i,
      /\brequire\s*\(\s*['"]child_process['"]/i,
      /\bProcess\.Start\b/i,
      /\bRuntime\.getRuntime\(\)\.exec\b/i,
      /\bexec\s*\(/i,
      /\bspawn\s*\(/i,
      /\bexecSync\b/i,
      /\bspawnSync\b/i,
    ];

    for (const pattern of toolCallPatterns) {
      if (pattern.test(text)) {
        throw new OllamaAdapterError(
          'TOOL_CALL_DETECTED',
          'Model output contains executable content patterns',
        );
      }
    }
  }

  private async reserveBudget(
    attemptId: string,
    estimatedInputTokens: number,
  ): Promise<ReserveResult> {
    const provider = this.config.provider;
    const providerConfig =
      this.configSnapshot.configuration.providers.providers[provider];

    const request: BudgetReservationRequest = {
      eventId: `reserve-${randomUUID()}`,
      reservationId: `reservation-${randomUUID()}`,
      taskId: this.taskId,
      attemptId,
      provider,
      model: this.config.model,
      route: 'local',
      dataClass: 'public',
      automatic: providerConfig.invocationMode === 'automatic',
      retry: false,
      estimatedInputTokens,
    };

    return this.budgetController.reserve(request);
  }

  private async settleBudget(
    reservationId: string,
    _attemptId: string,
    actualInputTokens: number,
    actualOutputTokens: number,
    cacheReadTokens: number,
    cacheWriteTokens: number,
    actualLocalWallTimeMs: number,
    reasonCode: string,
  ): Promise<SettlementResult> {
    const request: BudgetSettlementRequest = {
      eventId: `settle-${randomUUID()}`,
      settlementId: `settlement-${randomUUID()}`,
      reservationId,
      actualInputTokens,
      actualOutputTokens,
      cacheReadTokens,
      cacheWriteTokens,
      actualLocalWallTimeMs,
      reasonCode,
    };

    return this.budgetController.settle(request);
  }

  private async releaseBudget(
    reservationId: string,
    _attemptId: string,
    reasonCode: string,
  ): Promise<void> {
    await this.budgetController.release({
      eventId: `release-${randomUUID()}`,
      settlementId: `settlement-${randomUUID()}`,
      reservationId,
      reasonCode,
    });
  }

  private async appendHealthEvent(
    eventId: string,
    status: 'healthy' | 'unavailable' | 'timeout' | 'malformed',
    latencyMs: number,
    reasonCode: string,
  ): Promise<void> {
    await this.ledger.append(
      parseLedgerEvent({
        event_version: 1,
        event_id: eventId,
        event_type: 'ProviderHealthEvent',
        occurred_at: this.now().toISOString(),
        provider: this.config.provider,
        model: this.config.model,
        status,
        latency_ms: latencyMs,
        reason_code: reasonCode,
      }),
    );
  }

  private async appendAttemptStarted(
    attemptId: string,
    prompt: string,
    _estimatedInputTokens: number,
    startIso: string,
  ): Promise<void> {
    const pricingVersion =
      this.configSnapshot.configuration.pricing.pricingVersion;
    const zeroCost = createMoney('USD', 0);
    const promptHash = sha256(prompt);
    const inputHash = sha256(prompt);

    await this.ledger.append(
      parseLedgerEvent({
        event_version: 1,
        event_id: `attempt-start-${randomUUID()}`,
        event_type: 'AttemptStarted',
        occurred_at: startIso,
        task_id: this.taskId,
        attempt_id: attemptId,
        parent_attempt_id: null,
        route: 'local',
        provider: this.config.provider,
        model: this.config.model,
        purpose: 'local-inference',
        data_class: 'public',
        cache_hit: false,
        request_fingerprint: promptHash,
        input_hash: inputHash,
        prompt_version: 'local-adapter-1',
        config_hash: this.configSnapshot.configHash,
        pricing_version: pricingVersion,
        estimated_cost: zeroCost,
        status: 'started',
      }),
    );
  }

  private async appendAttemptCompleted(
    attemptId: string,
    status: 'completed' | 'failed' | 'blocked' | 'cancelled',
    inputTokens: number,
    outputTokens: number,
    latencyMs: number,
    resultHash: string | null,
    errorFingerprint: string | null,
  ): Promise<void> {
    const zeroCost = createMoney('USD', 0);

    await this.ledger.append(
      parseLedgerEvent({
        event_version: 1,
        event_id: `attempt-complete-${randomUUID()}`,
        event_type: 'AttemptCompleted',
        occurred_at: this.now().toISOString(),
        task_id: this.taskId,
        attempt_id: attemptId,
        status,
        input_tokens: inputTokens,
        output_tokens: outputTokens,
        actual_cost: zeroCost,
        latency_ms: latencyMs,
        result_hash: resultHash,
        patch_hash: null,
        error_fingerprint: errorFingerprint,
        verification_result: status === 'completed' ? 'pass' : null,
        escalation_reason: null,
      }),
    );
  }
}

const TOKEN_ESTIMATE_CHARS_PER_TOKEN = 4;

function estimateTokenCount(text: string): number {
  return Math.max(1, Math.ceil(text.length / TOKEN_ESTIMATE_CHARS_PER_TOKEN));
}
