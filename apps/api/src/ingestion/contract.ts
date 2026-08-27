import { z } from '@ikimetr/validation';

import {
  ALLOWED_CURRENCIES,
  ALLOWED_RENOVATIONS,
  ALLOWED_SELLER_TYPES,
  ALLOWED_TRANSACTION_TYPES,
  SOURCE_IDS,
} from './sources.js';

export const ingestionPayloadSchema = z.object({
  schemaVersion: z.literal(1),
  source: z.enum(SOURCE_IDS as unknown as [string, ...string[]]),
  externalId: z.string().trim().min(1).max(255),
  url: z.string().trim().url().max(2048),
  sellerType: z.enum(ALLOWED_SELLER_TYPES as [string, ...string[]]),
  listedAt: z.string().datetime().optional(),
  payload: z
    .object({
      operation: z
        .enum(ALLOWED_TRANSACTION_TYPES as [string, ...string[]])
        .optional(),
      propertyType: z.string().trim().min(1).max(40).optional(),
      title: z.string().trim().min(1).max(200).optional(),
      description: z.string().max(20000).optional(),
      price: z
        .object({
          amount: z.number().int().nonnegative().max(1_000_000_000_000),
          currency: z.enum(ALLOWED_CURRENCIES as [string, ...string[]]),
        })
        .optional(),
      district: z.string().trim().min(1).max(120).optional(),
      address: z.string().trim().max(400).optional(),
      rooms: z.number().int().min(0).max(100).optional(),
      area: z.number().positive().max(1_000_000).optional(),
      floor: z.number().int().min(0).max(200).optional(),
      totalFloors: z.number().int().min(0).max(200).optional(),
      renovation: z
        .enum(ALLOWED_RENOVATIONS as [string, ...string[]])
        .optional(),
      latitude: z.number().min(-90).max(90).optional(),
      longitude: z.number().min(-180).max(180).optional(),
      contact: z
        .object({
          phone: z.string().max(40).optional(),
          name: z.string().max(200).optional(),
        })
        .passthrough()
        .optional(),
      images: z.array(z.string().url().max(1024)).max(50).optional(),
      sourceStatus: z.enum(['active', 'removed']).optional(),
      evidence: z.record(z.string(), z.unknown()).optional(),
    })
    .passthrough(),
});

export type IngestionPayload = z.infer<typeof ingestionPayloadSchema>;
