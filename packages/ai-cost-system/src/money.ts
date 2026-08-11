const currencyPattern = /^[A-Z]{3}$/u;
const tokensPerMillion = 1_000_000n;
const maximumSafeInteger = BigInt(Number.MAX_SAFE_INTEGER);

export interface Money {
  readonly currency: string;
  readonly amountMicros: number;
}

export function createMoney(
  currency: string,
  amountMicros: number,
): Money {
  if (!currencyPattern.test(currency)) {
    throw new TypeError('Money currency must be a three-letter uppercase code');
  }
  assertNonNegativeSafeInteger(amountMicros, 'Money amount');
  return Object.freeze({ currency, amountMicros });
}

export function addMoney(left: Money, right: Money): Money {
  if (left.currency !== right.currency) {
    throw new TypeError('Cannot add money values with different currencies');
  }

  return createMoney(
    left.currency,
    safeBigIntToNumber(
      BigInt(left.amountMicros) + BigInt(right.amountMicros),
      'Money sum',
    ),
  );
}

export function calculateMicrosForTokens(
  tokens: number,
  rateMicrosPerMillionTokens: number,
): number {
  assertNonNegativeSafeInteger(tokens, 'Token count');
  assertNonNegativeSafeInteger(
    rateMicrosPerMillionTokens,
    'Pricing rate',
  );

  const product = BigInt(tokens) * BigInt(rateMicrosPerMillionTokens);
  const roundedUp =
    product === 0n ? 0n : (product + tokensPerMillion - 1n) / tokensPerMillion;
  return safeBigIntToNumber(roundedUp, 'Calculated cost');
}

export function assertNonNegativeSafeInteger(
  value: number,
  label: string,
): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`${label} must be a non-negative safe integer`);
  }
}

function safeBigIntToNumber(value: bigint, label: string): number {
  if (value > maximumSafeInteger) {
    throw new RangeError(`${label} exceeds the maximum safe integer`);
  }
  return Number(value);
}
