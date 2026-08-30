import { z } from '@ikimetr/validation';

export const NOTIFICATION_TYPES = [
  'new_message',
  'property_match',
  'new_owner_listing',
  'request_activity',
  'system_notice',
] as const;

export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

export const NOTIFICATIONS_PAGE_SIZE = 30;
export const NOTIFICATIONS_MAX_PAGE_SIZE = 100;

export const notificationQuerySchema = z.object({
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(NOTIFICATIONS_MAX_PAGE_SIZE)
    .default(NOTIFICATIONS_PAGE_SIZE),
  cursor: z.string().uuid().optional(),
});

export const notificationParamsSchema = z
  .object({
    id: z.string().uuid(),
  })
  .strict();

export const updatePreferencesSchema = z
  .object({
    disabledTypes: z.array(z.string().min(1).max(60)).max(50).optional(),
    dndEnabled: z.boolean().optional(),
    dndStart: z
      .string()
      .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'expected HH:MM time')
      .optional(),
    dndEnd: z
      .string()
      .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'expected HH:MM time')
      .optional(),
  })
  .strict();

export type NotificationQuery = z.infer<typeof notificationQuerySchema>;
export type UpdatePreferencesInput = z.infer<typeof updatePreferencesSchema>;
