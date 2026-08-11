import { canonicalize, sha256 } from './canonical.js';
import {
  type BudgetReservationEvent,
  type BudgetSettlementEvent,
  type LedgerEvent,
  parseLedgerEvent,
} from './ledger-events.js';
import type { AccountingLedger } from './ledger.js';
import {
  addMoney,
  calculateMicrosForTokens,
  createMoney,
  type Money,
} from './money.js';
import {
  PricingResolver,
  type ResolvedPricing,
} from './pricing.js';
import type { ConfigSnapshot } from './snapshot.js';
import type { ProviderId } from './schemas.js';

export interface BudgetUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cacheReadTokens: number;
  readonly cacheWriteTokens: number;
  readonly calls: number;
  readonly retries: number;
  readonly localWallTimeMs: number;
  readonly cost: Money;
}

export interface BudgetReservationRecord {
  readonly reservation: BudgetReservationEvent;
  readonly settlement: BudgetSettlementEvent | null;
}

export interface BudgetTotals {
  readonly perTask: ReadonlyMap<string, BudgetUsage>;
  readonly providerTask: ReadonlyMap<string, BudgetUsage>;
  readonly providerDay: ReadonlyMap<string, BudgetUsage>;
  readonly cloudDay: ReadonlyMap<string, BudgetUsage>;
  readonly providerMonth: ReadonlyMap<string, BudgetUsage>;
  readonly cloudMonth: ReadonlyMap<string, BudgetUsage>;
  readonly cloudCallsTask: ReadonlyMap<string, number>;
  readonly retryTask: ReadonlyMap<string, number>;
  readonly retryProviderTask: ReadonlyMap<string, number>;
  readonly localWallTimeTask: ReadonlyMap<string, number>;
}

export interface ReplayedBudgetState {
  readonly activeReservations: ReadonlyMap<
    string,
    BudgetReservationRecord
  >;
  readonly recoveryBlockingReservationIds: ReadonlySet<string>;
  readonly settledReservationIds: ReadonlySet<string>;
  readonly totals: BudgetTotals;
  readonly discrepancyCircuitOpen: boolean;
  readonly automaticCallsBlocked: boolean;
}

export class BudgetStateError extends Error {
  public constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'BudgetStateError';
  }
}

export function budgetScopeKey(...parts: readonly string[]): string {
  if (parts.some((part) => part.includes('|'))) {
    throw new BudgetStateError('Budget scope part contains a reserved delimiter');
  }
  return parts.join('|');
}

export function replayBudgetState(
  events: readonly LedgerEvent[],
): ReplayedBudgetState {
  return deriveBudgetState(events);
}

function deriveBudgetState(
  events: readonly LedgerEvent[],
  recoveredReservationIds?: ReadonlySet<string>,
): ReplayedBudgetState {
  const records = new Map<string, BudgetReservationRecord>();
  let discrepancyCircuit = false;

  for (const event of events) {
    if (event.event_type === 'BudgetReservation') {
      if (records.has(event.reservation_id)) {
        throw new BudgetStateError('Duplicate budget reservation');
      }
      validateReservation(event);
      records.set(
        event.reservation_id,
        Object.freeze({ reservation: event, settlement: null }),
      );
      continue;
    }
    if (event.event_type !== 'BudgetSettlement') {
      continue;
    }

    const record = records.get(event.reservation_id);
    if (record === undefined) {
      throw new BudgetStateError('Settlement references an unknown reservation');
    }
    if (record.settlement !== null) {
      throw new BudgetStateError('Reservation has already been settled');
    }
    validateSettlement(record.reservation, event);
    records.set(
      event.reservation_id,
      Object.freeze({ reservation: record.reservation, settlement: event }),
    );
    discrepancyCircuit ||= event.overrun;
  }

  const activeReservations = new Map<string, BudgetReservationRecord>();
  const settledReservationIds = new Set<string>();
  const mutableTotals = createEmptyTotals();

  for (const [reservationId, record] of records) {
    if (record.settlement === null) {
      activeReservations.set(reservationId, record);
      addRecordToTotals(mutableTotals, record.reservation, null);
      continue;
    }

    settledReservationIds.add(reservationId);
    if (record.settlement.disposition === 'settled') {
      addRecordToTotals(
        mutableTotals,
        record.reservation,
        record.settlement,
      );
    }
  }

  const recoveryBlockingReservationIds = new Set(
    [...activeReservations.keys()].filter(
      (reservationId) =>
        recoveredReservationIds === undefined ||
        recoveredReservationIds.has(reservationId),
    ),
  );
  return Object.freeze({
    activeReservations: freezeMap(activeReservations),
    recoveryBlockingReservationIds: freezeSet(
      recoveryBlockingReservationIds,
    ),
    settledReservationIds: freezeSet(settledReservationIds),
    totals: freezeTotals(mutableTotals),
    discrepancyCircuitOpen: discrepancyCircuit,
    automaticCallsBlocked:
      discrepancyCircuit || recoveryBlockingReservationIds.size > 0,
  });
}

export type BudgetControllerErrorCode =
  | 'REPLAY_FAILED'
  | 'STORAGE_FAILURE'
  | 'RECOVERY_REQUIRED'
  | 'DISCREPANCY_BLOCK'
  | 'NOT_CONFIGURED'
  | 'PROVIDER_DISABLED'
  | 'LIMIT_EXCEEDED'
  | 'INVALID_REQUEST'
  | 'DUPLICATE_TRANSITION'
  | 'UNKNOWN_RESERVATION'
  | 'ALREADY_SETTLED';

export class BudgetControllerError extends Error {
  public constructor(
    public readonly code: BudgetControllerErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'BudgetControllerError';
  }
}

function validateReservation(reservation: BudgetReservationEvent): void {
  const expectedCloud = reservation.provider !== 'local-ai';
  if (reservation.cloud !== expectedCloud) {
    throw new BudgetStateError('Reservation cloud classification is invalid');
  }
  if (reservation.cloud && reservation.reserved_local_wall_time_ms !== 0) {
    throw new BudgetStateError('Cloud reservation contains local wall-time');
  }

  try {
    const expectedCost = addMoney(
      createMoney(
        reservation.reserved_cost.currency,
        calculateMicrosForTokens(
          reservation.estimated_input_tokens,
          reservation.input_rate_micros_per_million_tokens,
        ),
      ),
      createMoney(
        reservation.reserved_cost.currency,
        calculateMicrosForTokens(
          reservation.reserved_output_tokens,
          reservation.output_rate_micros_per_million_tokens,
        ),
      ),
    );
    if (expectedCost.amountMicros !== reservation.reserved_cost.amountMicros) {
      throw new BudgetStateError('Reservation cost does not match its rates');
    }
  } catch (error) {
    if (error instanceof BudgetStateError) {
      throw error;
    }
    throw new BudgetStateError('Reservation cost is invalid', { cause: error });
  }
}

export interface BudgetReservationRequest {
  readonly eventId: string;
  readonly reservationId: string;
  readonly taskId: string;
  readonly attemptId: string;
  readonly provider: ProviderId;
  readonly model: string;
  readonly route: 'local' | 'cheap-cloud' | 'strong';
  readonly dataClass: 'public' | 'internal' | 'sensitive';
  readonly automatic: boolean;
  readonly retry: boolean;
  readonly estimatedInputTokens: number;
}

export type BudgetQuoteRequest = Omit<
  BudgetReservationRequest,
  'eventId' | 'reservationId' | 'attemptId'
>;

export type BudgetQuoteResult =
  | Readonly<{
      status: 'ALLOWED';
      provider: ProviderId;
      model: string;
      route: BudgetReservationRequest['route'];
      estimatedInputTokens: number;
      reservedOutputTokens: number;
      estimatedCost: Money;
      reservedLocalWallTimeMs: number;
      pricingVersion: string;
    }>
  | Readonly<{
      status: 'DENIED';
      reasonCode: BudgetControllerErrorCode;
    }>;

export interface BudgetSettlementRequest {
  readonly eventId: string;
  readonly settlementId: string;
  readonly reservationId: string;
  readonly actualInputTokens: number;
  readonly actualOutputTokens: number;
  readonly cacheReadTokens: number;
  readonly cacheWriteTokens: number;
  readonly actualLocalWallTimeMs: number;
  readonly reasonCode: string;
}

export interface BudgetReleaseRequest {
  readonly eventId: string;
  readonly settlementId: string;
  readonly reservationId: string;
  readonly reasonCode: string;
}

export interface ReserveResult {
  readonly status: 'RESERVED';
  readonly event: BudgetReservationEvent;
}

export interface SettlementResult {
  readonly status: 'SETTLED' | 'DISCREPANCY';
  readonly event: BudgetSettlementEvent;
}

export interface ReleaseResult {
  readonly status: 'RELEASED';
  readonly event: BudgetSettlementEvent;
}

interface PreparedReservation {
  readonly event: BudgetReservationEvent;
  readonly candidateEvents: readonly LedgerEvent[];
  readonly candidateState: ReplayedBudgetState;
}

export class BudgetController {
  private transitionQueue: Promise<void> = Promise.resolve();
  private storageFailed = false;

  private constructor(
    private readonly ledger: AccountingLedger,
    private readonly config: ConfigSnapshot,
    private readonly pricingResolver: PricingResolver,
    private readonly now: () => Date,
    private readonly events: LedgerEvent[],
    private readonly recoveredReservationIds: Set<string>,
    private state: ReplayedBudgetState,
  ) {}

  public static async initialize(options: {
    readonly ledger: AccountingLedger;
    readonly config: ConfigSnapshot;
    readonly pricingResolver: PricingResolver;
    readonly now?: () => Date;
  }): Promise<BudgetController> {
    try {
      if (
        !(options.pricingResolver instanceof PricingResolver) ||
        options.pricingResolver.getConfigHash() !== options.config.configHash
      ) {
        throw new BudgetStateError(
          'Pricing resolver does not match the config snapshot',
        );
      }
      const events = [...(await options.ledger.replay())];
      const replayed = replayBudgetState(events);
      const recoveredReservationIds = new Set(
        replayed.activeReservations.keys(),
      );
      return new BudgetController(
        options.ledger,
        options.config,
        options.pricingResolver,
        options.now ?? (() => new Date()),
        events,
        recoveredReservationIds,
        deriveBudgetState(events, recoveredReservationIds),
      );
    } catch (error) {
      throw new BudgetControllerError(
        'REPLAY_FAILED',
        'Budget controller initialization failed closed',
        { cause: error },
      );
    }
  }

  public reserve(request: BudgetReservationRequest): Promise<ReserveResult> {
    return this.serializeTransition(() => this.reserveInternal(request));
  }

  public quote(request: BudgetQuoteRequest): Promise<BudgetQuoteResult> {
    return this.serializeTransition(async () => {
      try {
        return this.quoteInternal(request);
      } catch (error) {
        if (error instanceof BudgetControllerError) {
          return Object.freeze({
            status: 'DENIED' as const,
            reasonCode: error.code,
          });
        }
        throw error;
      }
    });
  }

  public settle(request: BudgetSettlementRequest): Promise<SettlementResult> {
    return this.serializeTransition(() => this.settleInternal(request));
  }

  public release(request: BudgetReleaseRequest): Promise<ReleaseResult> {
    return this.serializeTransition(() => this.releaseInternal(request));
  }

  public getState(): ReplayedBudgetState {
    return deriveBudgetState(this.events, this.recoveredReservationIds);
  }

  private async reserveInternal(
    request: BudgetReservationRequest,
  ): Promise<ReserveResult> {
    this.assertUniqueEventId(request.eventId);
    if (
      this.events.some(
        (event) =>
          event.event_type === 'BudgetReservation' &&
          event.reservation_id === request.reservationId,
      )
    ) {
      throw new BudgetControllerError(
        'DUPLICATE_TRANSITION',
        'Reservation identifier already exists',
      );
    }

    const prepared = this.prepareReservation(request);
    await this.appendAndApply(
      prepared.event,
      prepared.candidateEvents,
      prepared.candidateState,
    );
    return Object.freeze({ status: 'RESERVED', event: prepared.event });
  }

  private quoteInternal(request: BudgetQuoteRequest): BudgetQuoteResult {
    const quoteHash = sha256(
      canonicalize({
        config_hash: this.config.configHash,
        event_count: this.events.length,
        request,
      }),
    );
    const prepared = this.prepareReservation({
      ...request,
      eventId: `dry-run-quote-event-${quoteHash}`,
      reservationId: `dry-run-quote-reservation-${quoteHash}`,
      attemptId: `dry-run-quote-attempt-${quoteHash}`,
    });
    const event = prepared.event;
    return Object.freeze({
      status: 'ALLOWED' as const,
      provider: event.provider,
      model: event.model,
      route: request.route,
      estimatedInputTokens: event.estimated_input_tokens,
      reservedOutputTokens: event.reserved_output_tokens,
      estimatedCost: event.reserved_cost,
      reservedLocalWallTimeMs: event.reserved_local_wall_time_ms,
      pricingVersion: event.pricing_version,
    });
  }

  private prepareReservation(
    request: BudgetReservationRequest,
  ): PreparedReservation {
    this.assertStorageReady();
    if (request.automatic && this.state.discrepancyCircuitOpen) {
      throw new BudgetControllerError(
        'DISCREPANCY_BLOCK',
        'Automatic calls are blocked by a persistent discrepancy',
      );
    }
    if (
      request.automatic &&
      this.state.recoveryBlockingReservationIds.size > 0
    ) {
      throw new BudgetControllerError(
        'RECOVERY_REQUIRED',
        'Automatic calls require explicit recovery of active reservations',
      );
    }

    const provider =
      this.config.configuration.providers.providers[request.provider];
    if (!provider.enabled) {
      throw new BudgetControllerError(
        'PROVIDER_DISABLED',
        'Provider is disabled',
      );
    }
    this.validateProviderRequest(request, provider);
    const cloud = request.provider !== 'local-ai';
    let pricing: ResolvedPricing;
    try {
      pricing = this.pricingResolver.resolve({
        provider: request.provider,
        model: request.model,
        automatic: request.automatic,
        cloud,
      });
    } catch (error) {
      throw new BudgetControllerError(
        'NOT_CONFIGURED',
        'Pricing is unavailable for the reservation',
        { cause: error },
      );
    }

    if (
      provider.maxOutputTokens === null ||
      provider.timeoutMs === null
    ) {
      throw new BudgetControllerError(
        'NOT_CONFIGURED',
        'Provider reservation limits are not configured',
      );
    }
    const reservedLocalWallTimeMs = cloud ? 0 : provider.timeoutMs;
    const usage = {
      inputTokens: request.estimatedInputTokens,
      outputTokens: provider.maxOutputTokens,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    };
    let reservedCost: Money;
    try {
      reservedCost = this.pricingResolver.calculateCost(pricing, usage);
    } catch (error) {
      throw new BudgetControllerError(
        'INVALID_REQUEST',
        'Reservation cost cannot be represented safely',
        { cause: error },
      );
    }

    const event = parseLedgerEvent({
      event_version: 1,
      event_id: request.eventId,
      event_type: 'BudgetReservation',
      occurred_at: this.currentTimestamp(),
      reservation_id: request.reservationId,
      task_id: request.taskId,
      attempt_id: request.attemptId,
      provider: request.provider,
      model: request.model,
      route: request.route,
      data_class: request.dataClass,
      automatic: request.automatic,
      cloud,
      retry: request.retry,
      estimated_input_tokens: request.estimatedInputTokens,
      reserved_output_tokens: provider.maxOutputTokens,
      reserved_cost: reservedCost,
      reserved_local_wall_time_ms: reservedLocalWallTimeMs,
      pricing_version: pricing.pricingVersion,
      input_rate_micros_per_million_tokens:
        pricing.inputRateMicrosPerMillionTokens,
      output_rate_micros_per_million_tokens:
        pricing.outputRateMicrosPerMillionTokens,
      cache_read_rate_micros_per_million_tokens:
        pricing.cacheReadRateMicrosPerMillionTokens,
      cache_write_rate_micros_per_million_tokens:
        pricing.cacheWriteRateMicrosPerMillionTokens,
      config_hash: this.config.configHash,
    }) as BudgetReservationEvent;

    const candidateEvents = [...this.events, event];
    const candidateState = deriveBudgetState(
      candidateEvents,
      this.recoveredReservationIds,
    );
    this.validateCandidateLimits(event, provider, candidateState);
    return Object.freeze({ event, candidateEvents, candidateState });
  }

  private async settleInternal(
    request: BudgetSettlementRequest,
  ): Promise<SettlementResult> {
    this.assertStorageReady();
    const record = this.requireActiveReservation(request.reservationId);
    this.assertUniqueEventId(request.eventId);
    this.assertUniqueSettlementId(request.settlementId);
    const pricing = pricingFromReservation(record.reservation);
    let actualCost: Money;
    try {
      actualCost = this.pricingResolver.calculateCost(pricing, {
        inputTokens: request.actualInputTokens,
        outputTokens: request.actualOutputTokens,
        cacheReadTokens: request.cacheReadTokens,
        cacheWriteTokens: request.cacheWriteTokens,
      });
    } catch (error) {
      throw new BudgetControllerError(
        'INVALID_REQUEST',
        'Settlement cost cannot be represented safely',
        { cause: error },
      );
    }
    const reservation = record.reservation;
    const overrun =
      request.actualInputTokens > reservation.estimated_input_tokens ||
      request.actualOutputTokens > reservation.reserved_output_tokens ||
      actualCost.amountMicros > reservation.reserved_cost.amountMicros ||
      request.actualLocalWallTimeMs >
        reservation.reserved_local_wall_time_ms;
    const event = parseLedgerEvent({
      event_version: 1,
      event_id: request.eventId,
      event_type: 'BudgetSettlement',
      occurred_at: this.currentTimestamp(),
      settlement_id: request.settlementId,
      reservation_id: reservation.reservation_id,
      task_id: reservation.task_id,
      attempt_id: reservation.attempt_id,
      provider: reservation.provider,
      disposition: 'settled',
      actual_input_tokens: request.actualInputTokens,
      actual_output_tokens: request.actualOutputTokens,
      cache_read_tokens: request.cacheReadTokens,
      cache_write_tokens: request.cacheWriteTokens,
      actual_cost: actualCost,
      actual_local_wall_time_ms: request.actualLocalWallTimeMs,
      overrun,
      reason_code: request.reasonCode,
    }) as BudgetSettlementEvent;

    await this.appendSettlement(event);
    return Object.freeze({
      status: overrun ? 'DISCREPANCY' : 'SETTLED',
      event,
    });
  }

  private async releaseInternal(
    request: BudgetReleaseRequest,
  ): Promise<ReleaseResult> {
    this.assertStorageReady();
    const record = this.requireActiveReservation(request.reservationId);
    this.assertUniqueEventId(request.eventId);
    this.assertUniqueSettlementId(request.settlementId);
    const reservation = record.reservation;
    const event = parseLedgerEvent({
      event_version: 1,
      event_id: request.eventId,
      event_type: 'BudgetSettlement',
      occurred_at: this.currentTimestamp(),
      settlement_id: request.settlementId,
      reservation_id: reservation.reservation_id,
      task_id: reservation.task_id,
      attempt_id: reservation.attempt_id,
      provider: reservation.provider,
      disposition: 'released',
      actual_input_tokens: 0,
      actual_output_tokens: 0,
      cache_read_tokens: 0,
      cache_write_tokens: 0,
      actual_cost: {
        currency: reservation.reserved_cost.currency,
        amountMicros: 0,
      },
      actual_local_wall_time_ms: 0,
      overrun: false,
      reason_code: request.reasonCode,
    }) as BudgetSettlementEvent;

    await this.appendSettlement(event);
    return Object.freeze({ status: 'RELEASED', event });
  }

  private async appendSettlement(event: BudgetSettlementEvent): Promise<void> {
    const candidateEvents = [...this.events, event];
    const nextRecovered = new Set(this.recoveredReservationIds);
    nextRecovered.delete(event.reservation_id);
    const candidateState = deriveBudgetState(candidateEvents, nextRecovered);
    await this.appendAndApply(
      event,
      candidateEvents,
      candidateState,
      nextRecovered,
    );
  }

  private async appendAndApply(
    event: LedgerEvent,
    candidateEvents: readonly LedgerEvent[],
    candidateState: ReplayedBudgetState,
    nextRecovered = this.recoveredReservationIds,
  ): Promise<void> {
    try {
      await this.ledger.append(event);
    } catch (error) {
      this.storageFailed = true;
      throw new BudgetControllerError(
        'STORAGE_FAILURE',
        'Ledger append failed; controller is blocked',
        { cause: error },
      );
    }

    const recoveredIds = [...nextRecovered];
    this.events.splice(0, this.events.length, ...candidateEvents);
    this.recoveredReservationIds.clear();
    for (const reservationId of recoveredIds) {
      this.recoveredReservationIds.add(reservationId);
    }
    this.state = candidateState;
  }

  private validateProviderRequest(
    request: BudgetReservationRequest,
    provider: ConfigSnapshot['configuration']['providers']['providers'][ProviderId],
  ): void {
    const routes = this.config.configuration.router.routes;
    const routeProviders = routes[request.route].providers as readonly string[];
    if (!routeProviders.includes(request.provider)) {
      throw new BudgetControllerError(
        'INVALID_REQUEST',
        'Provider is not allowed on the requested route',
      );
    }
    if (!provider.allowedDataClasses.includes(request.dataClass)) {
      throw new BudgetControllerError(
        'INVALID_REQUEST',
        'Provider is not allowed for the requested data class',
      );
    }
    if (request.automatic && provider.invocationMode !== 'automatic') {
      throw new BudgetControllerError(
        'INVALID_REQUEST',
        'Provider does not allow automatic invocation',
      );
    }
    if (provider.model !== request.model) {
      throw new BudgetControllerError(
        'INVALID_REQUEST',
        'Provider model does not match configuration',
      );
    }

    const budgetClass = this.config.configuration.budgets.defaultBudgetClass;
    const allowedRoutes = {
      NONE: [] as const,
      LOCAL_ONLY: ['local'] as const,
      CHEAP_ALLOWED: ['local', 'cheap-cloud'] as const,
      STRONG_ALLOWED: ['local', 'cheap-cloud', 'strong'] as const,
      INCIDENT_OVERRIDE: ['local', 'cheap-cloud', 'strong'] as const,
    }[budgetClass] as readonly string[];
    if (!allowedRoutes.includes(request.route)) {
      throw new BudgetControllerError(
        'NOT_CONFIGURED',
        'Budget class does not allow the requested route',
      );
    }
  }

  private validateCandidateLimits(
    event: BudgetReservationEvent,
    provider: ConfigSnapshot['configuration']['providers']['providers'][ProviderId],
    candidate: ReplayedBudgetState,
  ): void {
    const limits = this.config.configuration.budgets.limits;
    const providerTaskKey = budgetScopeKey(event.task_id, event.provider);
    const day = event.occurred_at.slice(0, 10);
    const month = event.occurred_at.slice(0, 7);
    const providerTask = requiredUsage(
      candidate.totals.providerTask.get(providerTaskKey),
    );
    checkNumberLimit(
      event.estimated_input_tokens,
      provider.maxInputTokens,
      'provider input/request',
    );
    checkNumberLimit(
      event.reserved_output_tokens,
      provider.maxOutputTokens,
      'provider output/request',
    );
    checkNumberLimit(
      providerTask.calls,
      provider.maxCallsPerTask,
      'provider calls/task',
    );
    checkMoneyLimit(
      providerTask.cost,
      provider.maxCostPerTask,
      'provider cost/task',
    );
    checkUsageLimits(
      requiredUsage(candidate.totals.perTask.get(event.task_id)),
      limits.perTask,
      'task',
    );
    checkUsageLimits(providerTask, limits.providerTask, 'provider/task');
    checkUsageLimits(
      requiredUsage(
        candidate.totals.providerDay.get(
          budgetScopeKey(event.provider, day),
        ),
      ),
      limits.providerDay,
      'provider/day',
    );
    checkUsageLimits(
      requiredUsage(
        candidate.totals.providerMonth.get(
          budgetScopeKey(event.provider, month),
        ),
      ),
      limits.providerMonth,
      'provider/month',
    );

    if (event.cloud) {
      checkUsageLimits(
        requiredUsage(candidate.totals.cloudDay.get(day)),
        limits.cloudDay,
        'cloud/day',
      );
      checkUsageLimits(
        requiredUsage(candidate.totals.cloudMonth.get(month)),
        limits.cloudMonth,
        'cloud/month',
      );
      checkNumberLimit(
        candidate.totals.cloudCallsTask.get(event.task_id) ?? 0,
        limits.cloudCallsTask.maxCalls,
        'cloud calls/task',
      );
    }

    if (event.retry) {
      checkNumberLimit(
        candidate.totals.retryTask.get(event.task_id) ?? 0,
        limits.retryLimits.maxRetriesPerTask,
        'retries/task',
      );
      checkNumberLimit(
        candidate.totals.retryProviderTask.get(providerTaskKey) ?? 0,
        limits.retryLimits.maxRetriesPerProviderTask,
        'retries/provider-task',
      );
      checkNumberLimit(
        candidate.totals.retryProviderTask.get(providerTaskKey) ?? 0,
        provider.retryPolicy.maxRetries,
        'provider retries/task',
      );
    }

    if (!event.cloud) {
      checkNumberLimit(
        candidate.totals.localWallTimeTask.get(event.task_id) ?? 0,
        limits.localWallTime.maxMillisecondsPerTask,
        'local wall-time/task',
      );
    }
  }

  private requireActiveReservation(
    reservationId: string,
  ): BudgetReservationRecord {
    const active = this.state.activeReservations.get(reservationId);
    if (active !== undefined) {
      return active;
    }
    if (this.state.settledReservationIds.has(reservationId)) {
      throw new BudgetControllerError(
        'ALREADY_SETTLED',
        'Reservation has already been settled or released',
      );
    }
    throw new BudgetControllerError(
      'UNKNOWN_RESERVATION',
      'Reservation does not exist',
    );
  }

  private assertUniqueEventId(eventId: string): void {
    if (this.events.some((event) => event.event_id === eventId)) {
      throw new BudgetControllerError(
        'DUPLICATE_TRANSITION',
        'Event identifier already exists',
      );
    }
  }

  private assertUniqueSettlementId(settlementId: string): void {
    if (
      this.events.some(
        (event) =>
          event.event_type === 'BudgetSettlement' &&
          event.settlement_id === settlementId,
      )
    ) {
      throw new BudgetControllerError(
        'DUPLICATE_TRANSITION',
        'Settlement identifier already exists',
      );
    }
  }

  private assertStorageReady(): void {
    if (this.storageFailed) {
      throw new BudgetControllerError(
        'STORAGE_FAILURE',
        'Controller is blocked after a ledger storage failure',
      );
    }
  }

  private currentTimestamp(): string {
    const value = this.now();
    if (!Number.isFinite(value.getTime())) {
      throw new BudgetControllerError(
        'INVALID_REQUEST',
        'Clock returned an invalid timestamp',
      );
    }
    return value.toISOString();
  }

  private serializeTransition<Result>(
    operation: () => Promise<Result>,
  ): Promise<Result> {
    const pending = this.transitionQueue.then(operation);
    this.transitionQueue = pending.then(
      () => undefined,
      () => undefined,
    );
    return pending;
  }
}

interface UsageLimits {
  readonly maxInputTokens: number | null;
  readonly maxOutputTokens: number | null;
  readonly maxCalls: number | null;
  readonly maxCost: Money | null;
}

function requiredUsage(value: BudgetUsage | undefined): BudgetUsage {
  if (value === undefined) {
    throw new BudgetControllerError(
      'INVALID_REQUEST',
      'Candidate budget usage is unavailable',
    );
  }
  return value;
}

function checkUsageLimits(
  usage: BudgetUsage,
  limits: UsageLimits,
  label: string,
): void {
  checkNumberLimit(usage.inputTokens, limits.maxInputTokens, `${label} input`);
  checkNumberLimit(
    usage.outputTokens,
    limits.maxOutputTokens,
    `${label} output`,
  );
  checkNumberLimit(usage.calls, limits.maxCalls, `${label} calls`);
  checkMoneyLimit(usage.cost, limits.maxCost, `${label} cost`);
}

function checkMoneyLimit(
  cost: Money,
  limit: Money | null,
  label: string,
): void {
  if (limit === null) {
    throw new BudgetControllerError(
      'NOT_CONFIGURED',
      `${label} limit is not configured`,
    );
  }
  if (cost.currency !== limit.currency) {
    throw new BudgetControllerError(
      'INVALID_REQUEST',
      `${label} currency does not match pricing`,
    );
  }
  if (cost.amountMicros > limit.amountMicros) {
    throw new BudgetControllerError(
      'LIMIT_EXCEEDED',
      `${label} limit would be exceeded`,
    );
  }
}

function checkNumberLimit(
  value: number,
  limit: number | null,
  label: string,
): void {
  if (limit === null) {
    throw new BudgetControllerError(
      'NOT_CONFIGURED',
      `${label} limit is not configured`,
    );
  }
  if (value > limit) {
    throw new BudgetControllerError(
      'LIMIT_EXCEEDED',
      `${label} limit would be exceeded`,
    );
  }
}

function pricingFromReservation(
  reservation: BudgetReservationEvent,
): ResolvedPricing {
  return Object.freeze({
    pricingVersion: reservation.pricing_version,
    provider: reservation.provider,
    model: reservation.model,
    currency: reservation.reserved_cost.currency,
    inputRateMicrosPerMillionTokens:
      reservation.input_rate_micros_per_million_tokens,
    outputRateMicrosPerMillionTokens:
      reservation.output_rate_micros_per_million_tokens,
    cacheReadRateMicrosPerMillionTokens:
      reservation.cache_read_rate_micros_per_million_tokens,
    cacheWriteRateMicrosPerMillionTokens:
      reservation.cache_write_rate_micros_per_million_tokens,
    status: 'known',
  });
}

function validateSettlement(
  reservation: BudgetReservationEvent,
  settlement: BudgetSettlementEvent,
): void {
  if (
    settlement.task_id !== reservation.task_id ||
    settlement.attempt_id !== reservation.attempt_id ||
    settlement.provider !== reservation.provider
  ) {
    throw new BudgetStateError('Settlement scope does not match reservation');
  }
  if (settlement.actual_cost.currency !== reservation.reserved_cost.currency) {
    throw new BudgetStateError('Settlement currency does not match reservation');
  }

  const computedOverrun =
    settlement.actual_input_tokens > reservation.estimated_input_tokens ||
    settlement.actual_output_tokens > reservation.reserved_output_tokens ||
    settlement.actual_cost.amountMicros >
      reservation.reserved_cost.amountMicros ||
    settlement.actual_local_wall_time_ms >
      reservation.reserved_local_wall_time_ms;

  if (settlement.disposition === 'released') {
    if (
      settlement.actual_input_tokens !== 0 ||
      settlement.actual_output_tokens !== 0 ||
      settlement.cache_read_tokens !== 0 ||
      settlement.cache_write_tokens !== 0 ||
      settlement.actual_cost.amountMicros !== 0 ||
      settlement.actual_local_wall_time_ms !== 0 ||
      settlement.overrun
    ) {
      throw new BudgetStateError('Released reservation contains usage');
    }
    return;
  }

  if (settlement.overrun !== computedOverrun) {
    throw new BudgetStateError('Settlement overrun flag is inconsistent');
  }
}

interface MutableBudgetTotals {
  readonly perTask: Map<string, BudgetUsage>;
  readonly providerTask: Map<string, BudgetUsage>;
  readonly providerDay: Map<string, BudgetUsage>;
  readonly cloudDay: Map<string, BudgetUsage>;
  readonly providerMonth: Map<string, BudgetUsage>;
  readonly cloudMonth: Map<string, BudgetUsage>;
  readonly cloudCallsTask: Map<string, number>;
  readonly retryTask: Map<string, number>;
  readonly retryProviderTask: Map<string, number>;
  readonly localWallTimeTask: Map<string, number>;
}

function createEmptyTotals(): MutableBudgetTotals {
  return {
    perTask: new Map(),
    providerTask: new Map(),
    providerDay: new Map(),
    cloudDay: new Map(),
    providerMonth: new Map(),
    cloudMonth: new Map(),
    cloudCallsTask: new Map(),
    retryTask: new Map(),
    retryProviderTask: new Map(),
    localWallTimeTask: new Map(),
  };
}

function addRecordToTotals(
  totals: MutableBudgetTotals,
  reservation: BudgetReservationEvent,
  settlement: BudgetSettlementEvent | null,
): void {
  const usage = settlementToUsage(reservation, settlement);
  const utcDay = reservation.occurred_at.slice(0, 10);
  const utcMonth = reservation.occurred_at.slice(0, 7);
  const providerTaskKey = budgetScopeKey(
    reservation.task_id,
    reservation.provider,
  );

  addUsage(totals.perTask, reservation.task_id, usage);
  addUsage(totals.providerTask, providerTaskKey, usage);
  addUsage(
    totals.providerDay,
    budgetScopeKey(reservation.provider, utcDay),
    usage,
  );
  addUsage(
    totals.providerMonth,
    budgetScopeKey(reservation.provider, utcMonth),
    usage,
  );
  addNumber(
    totals.retryTask,
    reservation.task_id,
    usage.retries,
  );
  addNumber(
    totals.retryProviderTask,
    providerTaskKey,
    usage.retries,
  );
  addNumber(
    totals.localWallTimeTask,
    reservation.task_id,
    usage.localWallTimeMs,
  );

  if (reservation.cloud) {
    addUsage(totals.cloudDay, utcDay, usage);
    addUsage(totals.cloudMonth, utcMonth, usage);
    addNumber(totals.cloudCallsTask, reservation.task_id, usage.calls);
  }
}

function settlementToUsage(
  reservation: BudgetReservationEvent,
  settlement: BudgetSettlementEvent | null,
): BudgetUsage {
  if (settlement === null) {
    return Object.freeze({
      inputTokens: reservation.estimated_input_tokens,
      outputTokens: reservation.reserved_output_tokens,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      calls: 1,
      retries: reservation.retry ? 1 : 0,
      localWallTimeMs: reservation.reserved_local_wall_time_ms,
      cost: reservation.reserved_cost,
    });
  }

  return Object.freeze({
    inputTokens: settlement.actual_input_tokens,
    outputTokens: settlement.actual_output_tokens,
    cacheReadTokens: settlement.cache_read_tokens,
    cacheWriteTokens: settlement.cache_write_tokens,
    calls: 1,
    retries: reservation.retry ? 1 : 0,
    localWallTimeMs: settlement.actual_local_wall_time_ms,
    cost: settlement.actual_cost,
  });
}

function addUsage(
  target: Map<string, BudgetUsage>,
  key: string,
  value: BudgetUsage,
): void {
  const current = target.get(key);
  if (current === undefined) {
    target.set(key, value);
    return;
  }

  try {
    target.set(
      key,
      Object.freeze({
        inputTokens: safeAdd(current.inputTokens, value.inputTokens),
        outputTokens: safeAdd(current.outputTokens, value.outputTokens),
        cacheReadTokens: safeAdd(
          current.cacheReadTokens,
          value.cacheReadTokens,
        ),
        cacheWriteTokens: safeAdd(
          current.cacheWriteTokens,
          value.cacheWriteTokens,
        ),
        calls: safeAdd(current.calls, value.calls),
        retries: safeAdd(current.retries, value.retries),
        localWallTimeMs: safeAdd(
          current.localWallTimeMs,
          value.localWallTimeMs,
        ),
        cost: addMoney(current.cost, value.cost),
      }),
    );
  } catch (error) {
    throw new BudgetStateError('Budget totals cannot be aggregated safely', {
      cause: error,
    });
  }
}

function addNumber(target: Map<string, number>, key: string, value: number) {
  if (value === 0) {
    return;
  }
  target.set(key, safeAdd(target.get(key) ?? 0, value));
}

function safeAdd(left: number, right: number): number {
  const sum = BigInt(left) + BigInt(right);
  if (sum > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new BudgetStateError('Budget counter exceeds the safe integer range');
  }
  return Number(sum);
}

function freezeTotals(totals: MutableBudgetTotals): BudgetTotals {
  return Object.freeze({
    perTask: freezeMap(totals.perTask),
    providerTask: freezeMap(totals.providerTask),
    providerDay: freezeMap(totals.providerDay),
    cloudDay: freezeMap(totals.cloudDay),
    providerMonth: freezeMap(totals.providerMonth),
    cloudMonth: freezeMap(totals.cloudMonth),
    cloudCallsTask: freezeMap(totals.cloudCallsTask),
    retryTask: freezeMap(totals.retryTask),
    retryProviderTask: freezeMap(totals.retryProviderTask),
    localWallTimeTask: freezeMap(totals.localWallTimeTask),
  });
}

function freezeMap<Key, Value>(map: Map<Key, Value>): ReadonlyMap<Key, Value> {
  return Object.freeze(map);
}

function freezeSet<Value>(set: Set<Value>): ReadonlySet<Value> {
  return Object.freeze(set);
}
