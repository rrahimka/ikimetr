import { z } from '@ikimetr/validation';

// Status is validated per-entity in the admin service (isAllowedStatus), so the
// schema only constrains it to a non-empty string here. This prevents the
// previous cross-entity nonsense (e.g. a listing set to "verified").
export const adminStatusUpdateSchema = z
  .object({
    status: z.string().min(1).max(40),
    reason: z.string().min(1).max(500).optional(),
  })
  .strict();

export type AdminStatusUpdate = z.infer<typeof adminStatusUpdateSchema>;

export const adminSubscriptionOverrideSchema = z
  .object({
    userId: z.string().uuid(),
    planCode: z.enum(['free', 'pro']),
    status: z.enum(['active', 'cancelled', 'expired', 'pending']),
  })
  .strict();

export type AdminSubscriptionOverride = z.infer<
  typeof adminSubscriptionOverrideSchema
>;

export const adminListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).max(10000).default(0),
});

export type AdminListQuery = z.infer<typeof adminListQuerySchema>;
