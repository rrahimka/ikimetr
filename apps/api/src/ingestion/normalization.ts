import { createHash } from 'node:crypto';

import { CURRENCY_VALUES } from '../schemas.js';

export interface NormalizedPhone {
  canonical: string | null;
  hash: string | null;
}

const PHONE_HASH_PREFIX = 'ph1:';
const CONTROL_CHAR_REGEX = new RegExp(
  `[${String.fromCharCode(0)}-${String.fromCharCode(31)}${String.fromCharCode(127)}]`,
  'gu',
);

export function normalizePhone(input: unknown): NormalizedPhone {
  if (typeof input !== 'string') {
    return { canonical: null, hash: null };
  }
  const trimmed = input.trim();
  if (trimmed.length === 0) {
    return { canonical: null, hash: null };
  }

  const digits = trimmed.replace(/\D/gu, '');
  if (digits.length === 0) {
    return { canonical: null, hash: null };
  }

  let national: string;
  if (digits.startsWith('994') && digits.length >= 11) {
    national = digits.slice(3);
  } else if (digits.startsWith('0')) {
    national = digits.slice(1);
  } else {
    national = digits;
  }

  if (national.length !== 9 || !/^\d{9}$/u.test(national)) {
    return { canonical: null, hash: null };
  }

  const canonical = `+994${national}`;
  const hash = `${PHONE_HASH_PREFIX}${createHash('sha256')
    .update(canonical)
    .digest('hex')}`;
  return { canonical, hash };
}

export function canonicalizeUrl(input: unknown): string | null {
  if (typeof input !== 'string' || input.length === 0) {
    return null;
  }
  let parsed: URL;
  try {
    parsed = new URL(input);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return null;
  }
  const protocol = parsed.protocol === 'http:' ? 'http' : 'https';
  const host = parsed.host.toLowerCase();
  const pathname = parsed.pathname.replace(/\/+$/u, '') || '/';
  return `${protocol}://${host}${pathname}`;
}

export function normalizeText(input: unknown): string | null {
  if (typeof input !== 'string') {
    return null;
  }
  const collapsed = input
    .normalize('NFC')
    .replace(CONTROL_CHAR_REGEX, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
  return collapsed.length === 0 ? null : collapsed;
}

export interface NormalizedPrice {
  amount: number | null;
  currency: string;
}

export function normalizePrice(
  amount: unknown,
  currency: unknown,
): NormalizedPrice {
  const value =
    typeof amount === 'number' && Number.isFinite(amount) && amount >= 0
      ? Math.trunc(amount)
      : null;
  const cur =
    typeof currency === 'string' && CURRENCY_VALUES.includes(currency)
      ? currency
      : 'AZN';
  return { amount: value, currency: cur };
}
