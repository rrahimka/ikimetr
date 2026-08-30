import { z } from '@ikimetr/validation';

export const SUBSCRIPTION_STATUSES = [
  'pending',
  'active',
  'cancelled',
  'expired',
  'past_due',
] as const;

export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];

export const createCheckoutSchema = z
  .object({
    planCode: z.enum(['free', 'pro']),
  })
  .strict();

export type CreateCheckoutInput = z.infer<typeof createCheckoutSchema>;

export const webhookParamsSchema = z
  .object({
    provider: z.enum(['test', 'stripe', 'epoint']),
  })
  .strict();

export type WebhookParams = z.infer<typeof webhookParamsSchema>;

export const ownerAlertCreateSchema = z
  .object({
    listingId: z.string().uuid(),
  })
  .strict();

export type OwnerAlertCreateInput = z.infer<typeof ownerAlertCreateSchema>;

export const ownerAlertListSchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(100).default(20),
    cursor: z.string().uuid().optional(),
  })
  .strict();

export type OwnerAlertListInput = z.infer<typeof ownerAlertListSchema>;
