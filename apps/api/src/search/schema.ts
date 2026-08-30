import { z } from '@ikimetr/validation';

import { SELLER_TYPES } from '../schemas.js';
import {
  ALLOWED_RENOVATIONS,
  ALLOWED_TRANSACTION_TYPES,
  SOURCE_IDS,
} from '../ingestion/sources.js';

export const SORT_VALUES = ['newest', 'price_asc', 'price_desc'] as const;

export const searchQuerySchema = z.object({
  operation: z
    .enum(ALLOWED_TRANSACTION_TYPES as [string, ...string[]])
    .optional(),
  propertyType: z.string().trim().min(1).max(40).optional(),
  district: z.string().trim().min(1).max(120).optional(),
  priceMin: z.coerce.number().int().nonnegative().optional(),
  priceMax: z.coerce.number().int().nonnegative().optional(),
  rooms: z.coerce.number().int().min(0).max(100).optional(),
  areaMin: z.coerce.number().positive().optional(),
  areaMax: z.coerce.number().positive().optional(),
  floor: z.coerce.number().int().min(0).max(200).optional(),
  renovation: z.enum(ALLOWED_RENOVATIONS as [string, ...string[]]).optional(),
  source: z.enum(SOURCE_IDS as unknown as [string, ...string[]]).optional(),
  sellerType: z.enum(SELLER_TYPES as [string, ...string[]]).optional(),
  status: z.enum(['active', 'outdated', 'archived']).optional(),
  sort: z.enum(SORT_VALUES).default('newest'),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().optional(),
});

export const ownerFeedQuerySchema = searchQuerySchema.omit({
  sellerType: true,
});

export type SearchQuery = z.infer<typeof searchQuerySchema>;
export type OwnerFeedQuery = z.infer<typeof ownerFeedQuerySchema>;
