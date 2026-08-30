import { describe, expect, it } from 'vitest';

import {
  canonicalizeUrl,
  normalizePhone,
  normalizePrice,
  normalizeText,
} from '../src/ingestion/normalization.js';

describe('normalizePhone', () => {
  it('normalizes +994 international form', () => {
    const result = normalizePhone('+994 50 123 45 67');
    expect(result.canonical).toBe('+994501234567');
    expect(result.hash).toMatch(/^ph1:[a-f0-9]{64}$/u);
  });

  it('normalizes 0-prefixed local number', () => {
    const result = normalizePhone('0501234567');
    expect(result.canonical).toBe('+994501234567');
  });

  it('normalizes bare 9-digit national number', () => {
    const result = normalizePhone('501234567');
    expect(result.canonical).toBe('+994501234567');
  });

  it('rejects too-short input', () => {
    const result = normalizePhone('123');
    expect(result.canonical).toBeNull();
    expect(result.hash).toBeNull();
  });

  it('ignores empty input', () => {
    expect(normalizePhone('').canonical).toBeNull();
    expect(normalizePhone(undefined).canonical).toBeNull();
  });
});

describe('canonicalizeUrl', () => {
  it('drops query string and fragment, lowercases host', () => {
    expect(canonicalizeUrl('https://Bina.az/item/123?utm=x#frag')).toBe(
      'https://bina.az/item/123',
    );
  });

  it('trims trailing slash', () => {
    expect(canonicalizeUrl('http://tap.az/a/b/')).toBe('http://tap.az/a/b');
  });

  it('rejects unsafe protocols', () => {
    expect(canonicalizeUrl('javascript:alert(1)')).toBeNull();
  });
});

describe('normalizeText', () => {
  it('collapses whitespace and normalizes unicode', () => {
    expect(normalizeText('  Café　　spaces ')).toBe('Café spaces');
  });

  it('returns null for empty', () => {
    expect(normalizeText('   ')).toBeNull();
  });
});

describe('normalizePrice', () => {
  it('keeps valid amount and currency', () => {
    expect(normalizePrice(120000, 'USD')).toEqual({
      amount: 120000,
      currency: 'USD',
    });
  });

  it('defaults currency and drops negative amount', () => {
    expect(normalizePrice(-5, 'XYZ')).toEqual({
      amount: null,
      currency: 'AZN',
    });
  });
});
