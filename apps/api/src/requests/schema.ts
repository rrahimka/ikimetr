import { z } from '@ikimetr/validation';

import { RENOVATION_VALUES, TRANSACTION_TYPE_VALUES } from '../schemas.js';

export const createRequestSchema = z.object({
  operation: z.enum(TRANSACTION_TYPE_VALUES as [string, ...string[]]),
  propertyType: z.string().trim().min(1).max(40).optional(),
  district: z.string().trim().min(1).max(120).optional(),
  priceMin: z.coerce.number().int().nonnegative().optional(),
  priceMax: z.coerce.number().int().nonnegative().optional(),
  roomsMin: z.coerce.number().int().min(0).max(100).optional(),
  roomsMax: z.coerce.number().int().min(0).max(100).optional(),
  areaMin: z.coerce.number().positive().optional(),
  areaMax: z.coerce.number().positive().optional(),
  floorMin: z.coerce.number().int().min(0).max(200).optional(),
  floorMax: z.coerce.number().int().min(0).max(200).optional(),
  renovation: z.enum(RENOVATION_VALUES as [string, ...string[]]).optional(),
  freeText: z.string().max(5000).optional(),
});

export const updateRequestSchema = createRequestSchema.partial();

export type CreateRequestInput = z.infer<typeof createRequestSchema>;
export type UpdateRequestInput = z.infer<typeof updateRequestSchema>;
