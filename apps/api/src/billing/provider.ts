import { createHmac, timingSafeEqual } from 'node:crypto';
import { randomUUID } from 'node:crypto';

export const DEFAULT_TEST_SECRET = 'ikimetr-test-payment-secret';

export type PaymentEventType =
  | 'checkout.completed'
  | 'payment.succeeded'
  | 'subscription.cancelled'
  | 'subscription.expired'
  | 'unknown';

export interface PaymentEvent {
  id: string;
  type: PaymentEventType;
  subscriptionId?: string;
  paymentId?: string;
  amount?: number;
  currency?: string;
  status?: string;
}

export interface CheckoutInput {
  userId: string;
  planId: string;
  planCode: string;
  amount: number;
  currency: string;
}

export interface CheckoutResult {
  providerPaymentId: string;
  checkoutUrl: string;
}

export interface PaymentProvider {
  readonly name: string;
  createCheckout(input: CheckoutInput): Promise<CheckoutResult>;
  verifyWebhookSignature(payload: unknown, signature: string): boolean;
  parseEvent(payload: unknown): PaymentEvent;
}

interface ProviderConfig {
  name: string;
  eventTypeMap: (raw: Record<string, unknown>) => PaymentEventType;
}

function sign(payload: unknown, secret: string): string {
  return createHmac('sha256', secret)
    .update(JSON.stringify(payload))
    .digest('hex');
}

export function signPayload(payload: unknown, secret: string): string {
  return sign(payload, secret);
}

export class HmacPaymentProvider implements PaymentProvider {
  readonly name: string;
  private readonly secret: string;
  private readonly eventTypeMap: (
    raw: Record<string, unknown>,
  ) => PaymentEventType;

  constructor(config: ProviderConfig, secret: string) {
    this.name = config.name;
    this.secret = secret;
    this.eventTypeMap = config.eventTypeMap;
  }

  async createCheckout(_input: CheckoutInput): Promise<CheckoutResult> {
    void _input;
    const providerPaymentId = `pay_${this.name}_${randomUUID()}`;
    return {
      providerPaymentId,
      checkoutUrl: `https://${this.name}.example/checkout/${providerPaymentId}`,
    };
  }

  verifyWebhookSignature(payload: unknown, signature: string): boolean {
    const expected = sign(payload, this.secret);
    const a = Buffer.from(expected);
    const b = Buffer.from(signature);
    if (a.length !== b.length) {
      return false;
    }
    return timingSafeEqual(a, b);
  }

  parseEvent(payload: unknown): PaymentEvent {
    const raw = (payload ?? {}) as Record<string, unknown>;
    const id =
      typeof raw['id'] === 'string'
        ? raw['id']
        : `evt_${String(raw['id'] ?? '')}`;
    const event: PaymentEvent = {
      id,
      type: this.eventTypeMap(raw),
    };
    const subscriptionId =
      typeof raw['subscriptionId'] === 'string'
        ? raw['subscriptionId']
        : typeof raw['providerSubscriptionId'] === 'string'
          ? raw['providerSubscriptionId']
          : undefined;
    const paymentId =
      typeof raw['paymentId'] === 'string'
        ? raw['paymentId']
        : typeof raw['providerPaymentId'] === 'string'
          ? raw['providerPaymentId']
          : undefined;
    const amount =
      typeof raw['amount'] === 'number' ? raw['amount'] : undefined;
    const currency =
      typeof raw['currency'] === 'string' ? raw['currency'] : undefined;
    const status =
      typeof raw['status'] === 'string' ? raw['status'] : undefined;
    if (subscriptionId) {
      event.subscriptionId = subscriptionId;
    }
    if (paymentId) {
      event.paymentId = paymentId;
    }
    if (amount !== undefined) {
      event.amount = amount;
    }
    if (currency) {
      event.currency = currency;
    }
    if (status) {
      event.status = status;
    }
    return event;
  }
}

const TEST_EVENT_MAP: (raw: Record<string, unknown>) => PaymentEventType = (
  raw,
) => {
  const type = raw['type'];
  switch (type) {
    case 'checkout.completed':
    case 'payment.succeeded':
      return 'payment.succeeded';
    case 'subscription.cancelled':
      return 'subscription.cancelled';
    case 'subscription.expired':
      return 'subscription.expired';
    default:
      return 'unknown';
  }
};

const STRIPE_EVENT_MAP: (raw: Record<string, unknown>) => PaymentEventType = (
  raw,
) => {
  const type = raw['type'];
  if (typeof type !== 'string') {
    return 'unknown';
  }
  if (type === 'checkout.session.completed' || type === 'invoice.paid') {
    return 'payment.succeeded';
  }
  if (type === 'customer.subscription.deleted') {
    return 'subscription.cancelled';
  }
  if (type === 'customer.subscription.past_due') {
    return 'subscription.expired';
  }
  return 'unknown';
};

export interface PaymentProviderEnvironment {
  NODE_ENV: string;
  PAYMENT_PROVIDER?: string;
  PAYMENT_PROVIDER_SECRET?: string | undefined;
}

export function createPaymentProvider(
  environment: PaymentProviderEnvironment,
): PaymentProvider {
  const name = environment.PAYMENT_PROVIDER ?? 'test';
  const secret = environment.PAYMENT_PROVIDER_SECRET ?? DEFAULT_TEST_SECRET;

  if (name === 'test') {
    if (environment.NODE_ENV === 'production') {
      throw new Error(
        'test payment provider must not be enabled in production',
      );
    }
    return new HmacPaymentProvider(
      { name: 'test', eventTypeMap: TEST_EVENT_MAP },
      secret,
    );
  }

  if (!environment.PAYMENT_PROVIDER_SECRET) {
    throw new Error(
      `payment provider "${name}" requires PAYMENT_PROVIDER_SECRET`,
    );
  }

  if (name === 'stripe' || name === 'epoint') {
    return new HmacPaymentProvider(
      { name, eventTypeMap: STRIPE_EVENT_MAP },
      environment.PAYMENT_PROVIDER_SECRET,
    );
  }

  throw new Error(`unsupported payment provider "${name}"`);
}
