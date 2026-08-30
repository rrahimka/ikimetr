import { z } from '@ikimetr/validation';

export const MESSAGE_MAX_LENGTH = 4000;
export const MESSAGES_PAGE_SIZE = 50;
export const MESSAGES_MAX_PAGE_SIZE = 100;

export const createConversationSchema = z
  .object({
    withUserId: z.string().uuid(),
  })
  .strict();

export const sendMessageSchema = z
  .object({
    content: z
      .string()
      .trim()
      .min(1, 'message content must not be empty')
      .max(
        MESSAGE_MAX_LENGTH,
        `message content must not exceed ${MESSAGE_MAX_LENGTH} characters`,
      ),
  })
  .strict();

export const conversationQuerySchema = z.object({
  limit: positiveInteger(MESSAGES_PAGE_SIZE, MESSAGES_MAX_PAGE_SIZE),
  cursor: z.string().uuid().optional(),
});

export const messageQuerySchema = z.object({
  limit: positiveInteger(MESSAGES_PAGE_SIZE, MESSAGES_MAX_PAGE_SIZE),
  cursor: z.string().uuid().optional(),
});

function positiveInteger(defaultValue: number, max: number) {
  return z.coerce.number().int().min(1).max(max).default(defaultValue);
}

export const conversationParamsSchema = z
  .object({
    id: z.string().uuid(),
  })
  .strict();

export type CreateConversationInput = z.infer<typeof createConversationSchema>;
export type SendMessageInput = z.infer<typeof sendMessageSchema>;
export type ConversationQuery = z.infer<typeof conversationQuerySchema>;
export type MessageQuery = z.infer<typeof messageQuerySchema>;
