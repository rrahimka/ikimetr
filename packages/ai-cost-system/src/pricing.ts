import { addMoney, calculateMicrosForTokens, createMoney } from './money.js';
import type { ConfigSnapshot } from './snapshot.js';
import type { ProviderId } from './schemas.js';

export interface TokenUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cacheReadTokens: number;
  readonly cacheWriteTokens: number;
}

export interface ResolvedPricing {
  readonly pricingVersion: string;
  readonly provider: ProviderId;
  readonly model: string;
  readonly currency: string;
  readonly inputRateMicrosPerMillionTokens: number;
  readonly outputRateMicrosPerMillionTokens: number;
  readonly cacheReadRateMicrosPerMillionTokens: number | null;
  readonly cacheWriteRateMicrosPerMillionTokens: number | null;
  readonly status: 'known' | 'stale';
}

export interface PricingResolutionRequest {
  readonly provider: ProviderId;
  readonly model: string;
  readonly automatic: boolean;
  readonly cloud: boolean;
}

export class PricingResolutionError extends Error {
  public constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'PricingResolutionError';
  }
}

export class PricingResolver {
  public constructor(private readonly snapshot: ConfigSnapshot) {}

  public getConfigHash(): string {
    return this.snapshot.configHash;
  }

  public resolve(request: PricingResolutionRequest): ResolvedPricing {
    const snapshot = this.snapshot.configuration.pricing.snapshots.find(
      ({ provider }) => provider === request.provider,
    );
    if (snapshot === undefined) {
      throw new PricingResolutionError('Pricing provider is not configured');
    }
    if (request.automatic && request.cloud && snapshot.status !== 'known') {
      throw new PricingResolutionError(
        'Automatic cloud usage requires known pricing',
      );
    }
    if (snapshot.status === 'unknown') {
      throw new PricingResolutionError('Pricing is unknown');
    }
    if (
      snapshot.model === null ||
      snapshot.currency === null ||
      snapshot.inputRatePerMillionTokens === null ||
      snapshot.outputRatePerMillionTokens === null
    ) {
      throw new PricingResolutionError('Pricing snapshot is incomplete');
    }
    if (snapshot.model !== request.model) {
      throw new PricingResolutionError('Pricing model does not match');
    }

    return Object.freeze({
      pricingVersion: this.snapshot.configuration.pricing.pricingVersion,
      provider: snapshot.provider,
      model: snapshot.model,
      currency: snapshot.currency,
      inputRateMicrosPerMillionTokens:
        snapshot.inputRatePerMillionTokens,
      outputRateMicrosPerMillionTokens:
        snapshot.outputRatePerMillionTokens,
      cacheReadRateMicrosPerMillionTokens:
        snapshot.cacheReadRatePerMillionTokens,
      cacheWriteRateMicrosPerMillionTokens:
        snapshot.cacheWriteRatePerMillionTokens,
      status: snapshot.status,
    });
  }

  public calculateCost(
    pricing: ResolvedPricing,
    usage: TokenUsage,
  ) {
    let total = createMoney(pricing.currency, 0);
    const charge = (tokens: number, rate: number | null, label: string) => {
      if (rate === null) {
        if (tokens !== 0) {
          throw new PricingResolutionError(`${label} pricing is unavailable`);
        }
        return;
      }
      total = addMoney(
        total,
        createMoney(
          pricing.currency,
          calculateMicrosForTokens(tokens, rate),
        ),
      );
    };

    charge(
      usage.inputTokens,
      pricing.inputRateMicrosPerMillionTokens,
      'Input token',
    );
    charge(
      usage.outputTokens,
      pricing.outputRateMicrosPerMillionTokens,
      'Output token',
    );
    charge(
      usage.cacheReadTokens,
      pricing.cacheReadRateMicrosPerMillionTokens,
      'Cache read',
    );
    charge(
      usage.cacheWriteTokens,
      pricing.cacheWriteRateMicrosPerMillionTokens,
      'Cache write',
    );

    return total;
  }
}
