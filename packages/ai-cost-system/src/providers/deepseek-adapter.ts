import { randomUUID } from 'node:crypto';
import { z } from 'zod';

import type {
  BudgetController,
  BudgetReservationRequest,
  BudgetSettlementRequest,
} from '../budget.js';
import { canonicalize, sha256 } from '../canonical.js';
import type { AccountingLedger } from '../ledger.js';
import { parseLedgerEvent } from '../ledger-events.js';
import { createMoney } from '../money.js';
import type { ConfigSnapshot } from '../snapshot.js';
import type { ProviderId } from '../schemas.js';

const DEFAULT_BASE_URL = 'https://api.deepseek.com';
const MAX_REQ_BYTES = 64 * 1024;
const MAX_RES_BYTES = 128 * 1024;

export interface DeepSeekAdapterConfig {
  readonly provider: ProviderId;
  readonly model: string;
  readonly maxInputTokens: number;
  readonly maxOutputTokens: number;
  readonly maxCallsPerTask: number;
  readonly timeoutMs: number;
  readonly baseUrl?: string;
  readonly apiKeyEnvVar?: string;
}

const responseSchema = z.object({
  choices: z.array(
    z.object({
      message: z.object({
        content: z.string(),
      }),
    }),
  ).nonempty(),
  usage: z.object({
    prompt_tokens: z.number().int().nonnegative(),
    completion_tokens: z.number().int().nonnegative(),
  }),
});

export class DeepSeekAdapterError extends Error {
  public constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'DeepSeekAdapterError';
  }
}

export interface InvokeParams {
  readonly prompt: string;
  readonly system?: string;
  readonly temperature?: number;
  readonly maxTokens?: number;
}

export interface InvokeResult {
  readonly text: string;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly latencyMs: number;
}

const HTTP_ERRORS: Record<number, string> = {
  400: 'BAD_REQUEST',
  401: 'UNAUTHORIZED',
  402: 'PAYMENT_REQUIRED',
  422: 'UNPROCESSABLE_ENTITY',
  429: 'RATE_LIMITED',
  500: 'INTERNAL_SERVER_ERROR',
  503: 'SERVICE_UNAVAILABLE',
};

export class DeepSeekAdapter {
  private readonly taskId: string;

  private constructor(
    private readonly config: DeepSeekAdapterConfig,
    private readonly budgetController: BudgetController,
    private readonly ledger: AccountingLedger,
    private readonly configSnapshot: ConfigSnapshot,
    private readonly now: () => Date,
  ) {
    this.taskId = `task-${randomUUID()}`;
  }

  public static create(options: {
    readonly config: DeepSeekAdapterConfig;
    readonly budgetController: BudgetController;
    readonly ledger: AccountingLedger;
    readonly configSnapshot: ConfigSnapshot;
    readonly now?: () => Date;
  }): DeepSeekAdapter {
    return new DeepSeekAdapter(
      options.config,
      options.budgetController,
      options.ledger,
      options.configSnapshot,
      options.now ?? (() => new Date()),
    );
  }

  public async invoke(params: InvokeParams): Promise<InvokeResult> {
    let url: URL;
    try {
      url = new URL(this.config.baseUrl ?? DEFAULT_BASE_URL);
    } catch {
      throw new DeepSeekAdapterError('INVALID_ENDPOINT', 'Invalid URL');
    }
    if (url.protocol !== 'https:') {
      throw new DeepSeekAdapterError('INVALID_ENDPOINT', 'Must use https://');
    }
    if (url.username !== '' || url.password !== '') {
      throw new DeepSeekAdapterError(
        'INVALID_ENDPOINT',
        'Credentials not allowed',
      );
    }

    const envKey = this.config.apiKeyEnvVar ?? 'DEEPSEEK_API_KEY';
    const apiKey = process.env[envKey]?.trim();
    if (!apiKey) {
      throw new DeepSeekAdapterError(
        'MISSING_API_KEY',
        `API key environment variable '${envKey}' is missing or empty`,
      );
    }

    const attemptId = `attempt-${randomUUID()}`;
    const startMs = Date.now();
    const startIso = this.now().toISOString();
    const estInput = Math.max(1, Math.ceil(params.prompt.length / 4));
    const providerConfig =
      this.configSnapshot.configuration.providers.providers[this.config.provider];

    const reserveReq: BudgetReservationRequest = {
      eventId: `reserve-${randomUUID()}`,
      reservationId: `reservation-${randomUUID()}`,
      taskId: this.taskId,
      attemptId,
      provider: this.config.provider,
      model: this.config.model,
      route: 'cheap-cloud',
      dataClass: 'public',
      automatic: providerConfig?.invocationMode === 'automatic',
      retry: false,
      estimatedInputTokens: estInput,
    };
    const reservation = await this.budgetController.reserve(reserveReq);

    const promptHash = sha256(params.prompt);
    await this.ledger.append(
      parseLedgerEvent({
        event_version: 1,
        event_id: `attempt-start-${randomUUID()}`,
        event_type: 'AttemptStarted',
        occurred_at: startIso,
        task_id: this.taskId,
        attempt_id: attemptId,
        parent_attempt_id: null,
        route: 'cheap-cloud',
        provider: this.config.provider,
        model: this.config.model,
        purpose: 'cloud-inference',
        data_class: 'public',
        cache_hit: false,
        request_fingerprint: promptHash,
        input_hash: promptHash,
        prompt_version: 'deepseek-adapter-1',
        config_hash: this.configSnapshot.configHash,
        pricing_version:
          this.configSnapshot.configuration.pricing.pricingVersion,
        estimated_cost: createMoney('USD', 0),
        status: 'started',
      }),
    );

    try {
      const bodyStr = canonicalize({
        model: this.config.model,
        messages: [
          ...(params.system ? [{ role: 'system', content: params.system }] : []),
          { role: 'user', content: params.prompt },
        ],
        stream: false,
        temperature: params.temperature ?? 0,
        max_tokens: Math.min(
          params.maxTokens ?? this.config.maxOutputTokens,
          this.config.maxOutputTokens,
        ),
      });

      if (Buffer.byteLength(bodyStr, 'utf8') > MAX_REQ_BYTES) {
        throw new DeepSeekAdapterError('REQUEST_TOO_LARGE', 'Body too large');
      }

      const controller = new AbortController();
      const timer = setTimeout(
        () => controller.abort(new Error('Invocation timed out')),
        this.config.timeoutMs,
      );
      let response: Response;
      const targetUrl = `${url.origin}${url.pathname.replace(/\/$/u, '')}/chat/completions`;

      try {
        response = await fetch(targetUrl, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${apiKey}`,
          },
          body: bodyStr,
          signal: controller.signal,
          redirect: 'manual',
        });
      } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') {
          throw new DeepSeekAdapterError('TIMEOUT', 'DeepSeek invocation timed out');
        }
        throw new DeepSeekAdapterError('NETWORK_ERROR', 'Network request failed');
      } finally {
        clearTimeout(timer);
      }

      if ([301, 302, 303, 307, 308].includes(response.status)) {
        throw new DeepSeekAdapterError(
          'REDIRECT_REJECTED',
          `Redirect status ${response.status}`,
        );
      }
      if (response.status !== 200) {
        const code = HTTP_ERRORS[response.status] ?? 'INTERNAL_SERVER_ERROR';
        throw new DeepSeekAdapterError(code, `HTTP status ${response.status}`);
      }

      let resText: string;
      try {
        resText = await response.text();
      } catch {
        throw new DeepSeekAdapterError('MALFORMED_RESPONSE', 'Read error');
      }

      if (Buffer.byteLength(resText, 'utf8') > MAX_RES_BYTES) {
        throw new DeepSeekAdapterError('MALFORMED_RESPONSE', 'Response too large');
      }

      let parsedJson: unknown;
      try {
        parsedJson = JSON.parse(resText);
      } catch {
        throw new DeepSeekAdapterError('MALFORMED_RESPONSE', 'Invalid JSON');
      }

      const val = responseSchema.safeParse(parsedJson);
      if (!val.success) {
        throw new DeepSeekAdapterError(
          'MALFORMED_RESPONSE',
          'Schema validation failed',
        );
      }

      const latencyMs = Date.now() - startMs;
      const inputTokens = val.data.usage.prompt_tokens;
      const outputTokens = val.data.usage.completion_tokens;
      const [firstChoice] = val.data.choices;
      if (!firstChoice) {
        throw new DeepSeekAdapterError(
          'MALFORMED_RESPONSE',
          'Schema validation failed',
        );
      }
      const text = firstChoice.message.content;

      const settleReq: BudgetSettlementRequest = {
        eventId: `settle-${randomUUID()}`,
        settlementId: `settlement-${randomUUID()}`,
        reservationId: reservation.event.reservation_id,
        actualInputTokens: inputTokens,
        actualOutputTokens: outputTokens,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        actualLocalWallTimeMs: latencyMs,
        reasonCode: 'completed',
      };
      await this.budgetController.settle(settleReq);

      await this.ledger.append(
        parseLedgerEvent({
          event_version: 1,
          event_id: `attempt-complete-${randomUUID()}`,
          event_type: 'AttemptCompleted',
          occurred_at: this.now().toISOString(),
          task_id: this.taskId,
          attempt_id: attemptId,
          status: 'completed',
          input_tokens: inputTokens,
          output_tokens: outputTokens,
          actual_cost: createMoney('USD', 0),
          latency_ms: latencyMs,
          result_hash: sha256(text),
          patch_hash: null,
          error_fingerprint: null,
          verification_result: 'pass',
          escalation_reason: null,
        }),
      );

      return { text, inputTokens, outputTokens, latencyMs };
    } catch (error) {
      const latencyMs = Date.now() - startMs;
      const code =
        error instanceof DeepSeekAdapterError ? error.code : 'NETWORK_ERROR';
      const reasonCode = code.toLowerCase().replace(/_/g, '-');
      await this.budgetController.release({
        eventId: `release-${randomUUID()}`,
        settlementId: `settlement-${randomUUID()}`,
        reservationId: reservation.event.reservation_id,
        reasonCode,
      });
      await this.ledger.append(
        parseLedgerEvent({
          event_version: 1,
          event_id: `attempt-complete-${randomUUID()}`,
          event_type: 'AttemptCompleted',
          occurred_at: this.now().toISOString(),
          task_id: this.taskId,
          attempt_id: attemptId,
          status: 'failed',
          input_tokens: 0,
          output_tokens: 0,
          actual_cost: createMoney('USD', 0),
          latency_ms: latencyMs,
          result_hash: null,
          patch_hash: null,
          error_fingerprint: sha256(
            canonicalize({
              code,
              message: error instanceof Error ? error.message : String(error),
            }),
          ),
          verification_result: null,
          escalation_reason: null,
        }),
      );
      throw error;
    }
  }
}
