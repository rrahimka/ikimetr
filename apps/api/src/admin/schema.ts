import { z } from '@ikimetr/validation';

export const adminStatusUpdateSchema = z
  .object({
    status: z.enum([
      'active',
      'suspended',
      'pending',
      'banned',
      'inactive',
      'verified',
      'unverified',
      'cancelled',
      'expired',
    ]),
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
