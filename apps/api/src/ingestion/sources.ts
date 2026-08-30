import {
  CURRENCY_VALUES,
  RENOVATION_VALUES,
  SELLER_TYPES,
  TRANSACTION_TYPE_VALUES,
} from '../schemas.js';

export const SOURCE_IDS = [
  'bina',
  'emlak',
  'yeni_emlak',
  'arenda',
  'vip_emlak',
  'ev10',
  'kub',
  'mertebe',
  'ucuz_emlak',
  'emlak_bazari',
  'tap',
  'stop',
] as const;

export type SourceId = (typeof SOURCE_IDS)[number];
export type SellerType = (typeof SELLER_TYPES)[number];

const SOURCE_SET = new Set<string>(SOURCE_IDS);

export function isKnownSource(value: unknown): value is SourceId {
  return typeof value === 'string' && SOURCE_SET.has(value);
}

export const ALLOWED_TRANSACTION_TYPES = TRANSACTION_TYPE_VALUES;
export const ALLOWED_CURRENCIES = CURRENCY_VALUES;
export const ALLOWED_RENOVATIONS = RENOVATION_VALUES;
export const ALLOWED_SELLER_TYPES = SELLER_TYPES;
