import { z } from '@ikimetr/validation';

const emailSchema = z.string().trim().email().max(320);
const passwordSchema = z.string().min(8).max(200);
const displayNameSchema = z.string().trim().min(1).max(120);
const localeSchema = z
  .string()
  .regex(/^[a-z]{2}(?:-[A-Z]{2})?$/u)
  .default('az');

export const registerSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  displayName: displayNameSchema.optional(),
});

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1).max(200),
});

export const updateProfileSchema = z.object({
  displayName: displayNameSchema.optional(),
  avatarUrl: z.string().url().max(512).nullable().optional(),
  phone: z.string().trim().max(40).nullable().optional(),
  phoneVisible: z.boolean().optional(),
  language: localeSchema.optional(),
  locale: localeSchema.optional(),
  bio: z.string().max(1000).nullable().optional(),
});

export const updateRealtorSchema = z.object({
  publicName: z.string().trim().min(1).max(160).optional(),
  bio: z.string().max(2000).nullable().optional(),
  specialization: z.string().trim().max(80).nullable().optional(),
  serviceAreas: z.array(z.string().trim().min(1).max(120)).max(50).optional(),
  languages: z.array(z.string().trim().min(2).max(8)).max(20).optional(),
});

export const createAgencySchema = z.object({
  name: z.string().trim().min(2).max(160),
  slug: z
    .string()
    .trim()
    .min(2)
    .max(160)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u),
  description: z.string().max(2000).nullable().optional(),
});

export const updateAgencySchema = z.object({
  name: z.string().trim().min(2).max(160).optional(),
  slug: z
    .string()
    .trim()
    .min(2)
    .max(160)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u)
    .optional(),
  description: z.string().max(2000).nullable().optional(),
});

export const addAgencyMemberSchema = z.object({
  userId: z.string().uuid(),
  role: z.enum(['admin', 'member']),
});

const TRANSACTION_TYPES = [
  'sale',
  'rent_long',
  'rent_daily',
  'land',
  'commercial',
];
const PROPERTY_STATUSES = [
  'draft',
  'active',
  'pending',
  'sold',
  'rented',
  'outdated',
  'archived',
];
const CURRENCIES = ['AZN', 'USD', 'EUR', 'TRY'];
const RENOVATIONS = [
  'none',
  'cosmetic',
  'euro',
  'designer',
  'rough',
  'after_construction',
];

export const SELLER_TYPES = ['owner', 'realtor', 'agency', 'unknown'];
export const PROPERTY_TYPES = [
  'apartment',
  'house',
  'room',
  'land',
  'commercial',
  'garage',
  'office',
  'villa',
  'cottage',
  'new_building',
];
export const LISTING_STATUSES = ['active', 'outdated', 'archived'];
export const FRESHNESS_STATUSES = ['confirmed', 'stale', 'inactive'];
export const REQUEST_STATUSES = ['active', 'archived', 'expired'];

export const TRANSACTION_TYPE_VALUES = TRANSACTION_TYPES;
export const CURRENCY_VALUES = CURRENCIES;
export const RENOVATION_VALUES = RENOVATIONS;

export const createPropertySchema = z.object({
  agencyId: z.string().uuid().optional(),
  transactionType: z
    .enum(TRANSACTION_TYPES as [string, ...string[]])
    .default('sale'),
  title: z.string().trim().min(1).max(200),
  description: z.string().max(20000).nullable().optional(),
  priceAmount: z.number().int().nonnegative().nullable().optional(),
  currency: z.enum(CURRENCIES as [string, ...string[]]).default('AZN'),
  district: z.string().trim().max(120).nullable().optional(),
  address: z.string().trim().max(400).nullable().optional(),
  latitude: z.number().min(-90).max(90).nullable().optional(),
  longitude: z.number().min(-180).max(180).nullable().optional(),
  rooms: z.number().int().min(0).max(100).nullable().optional(),
  area: z.number().positive().max(1_000_000).nullable().optional(),
  floor: z.number().int().min(0).max(200).nullable().optional(),
  totalFloors: z.number().int().min(0).max(200).nullable().optional(),
  renovation: z
    .enum(RENOVATIONS as [string, ...string[]])
    .nullable()
    .optional(),
});

export const updatePropertySchema = createPropertySchema
  .omit({ transactionType: true })
  .partial();

export const propertyStatusSchema = z.object({
  status: z.enum(PROPERTY_STATUSES as [string, ...string[]]),
});

export const addPropertyImageSchema = z.object({
  url: z.string().url().max(1024),
  ordering: z.number().int().min(0).max(100_000).optional(),
  isPrimary: z.boolean().optional(),
});

export const paginationSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().optional(),
});

export type CreatePropertyInput = z.infer<typeof createPropertySchema>;
