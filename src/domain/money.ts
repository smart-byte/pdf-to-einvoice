// Money in exact cents: amounts are taken in millionths and summed as whole cents in BigInt, rounded half away from
// zero. The functions that take and return numbers are for every layer and come first; those on BigInt cents are for
// the calculation of the totals (calculate.ts) and of the discounts and charges (adjustments.ts).

/**
 * An amount in whole cents, rounded half away from zero: 1.005 is 101, where `Math.round(1.005 * 100)` gives 100. NaN
 * for what cannot be calculated with: NaN, infinity, or a number too large for its millionths.
 */
export function cents(n: number): number {
  return Number.isFinite(n * 1e6) ? Number(toCents(n)) : NaN;
}

/** Whole cents as an amount, from a number or from BigInt: 101 is 1.01. */
export function fromCents(c: number | bigint): number {
  return Number(c) / 100;
}

/** The sum of amounts as given, not rounded: summed in millionths, where 0.1 + 0.2 is 0.3. */
export function exactSum(amounts: number[]): number {
  return Number(amounts.reduce((sum, n) => sum + micro(n), 0n)) / 1e6;
}

/** Quantity times unit price, rounded to the cent: the base of a line and of its discount. */
export function lineBase(quantity: number, unitPrice: number): number {
  return fromCents(baseCents(quantity, unitPrice));
}

/** The percentage of a base, rounded to the cent. */
export function percentOf(base: number, percent: number): number {
  return fromCents(percentCents(toCents(base), percent));
}

/** The net amount a gross amount holds at a VAT rate, rounded to the cent: 119 at 19 % holds 100. */
export function netOfGross(gross: number, rate: number): number {
  return fromCents(divRound(toCents(gross) * 10n ** 8n, 10n ** 8n + micro(rate)));
}

/** The price of one unit of an amount, rounded to the cent. */
export function perUnit(amount: number, quantity: number): number {
  return fromCents(divRound(toCents(amount) * 10n ** 6n, micro(quantity)));
}

/**
 * Whether an amount is the percentage of its base, `slack` apart at most (Peppol R040). The product is not rounded
 * first: 10 % of 0.15 is 0.015, which 0.04 misses by 0.025.
 */
export function percentAgrees(base: number, percent: number, amount: number, slack: number): boolean {
  const apart = micro(amount) * 100n * 10n ** 6n - micro(base) * micro(percent);
  return abs(apart) <= micro(slack) * 100n * 10n ** 6n;
}

/**
 * Whether a stated line total is quantity times price less `less` (its discount), `slack` apart at most. The product is
 * not rounded first, as with `percentAgrees`.
 */
export function lineAgrees(
  { quantity, unitPrice }: { quantity: number; unitPrice: number },
  less: number,
  net: number,
  slack: number,
): boolean {
  const apart = micro(quantity) * micro(unitPrice) - (micro(less) + micro(net)) * 10n ** 6n;
  return abs(apart) <= micro(slack) * 10n ** 6n;
}

/** How far a stated amount may be from the calculated one: two cents, half a forint where there are no cents (PEPPOL-EN16931-R120). */
export function slackOf(currency?: string): number {
  return currency === 'HUF' ? 0.5 : 0.02;
}

// Binary floating point cannot represent 1.005 and would round it down.
export function micro(n: number): bigint {
  return BigInt(Math.round(n * 1e6));
}

/** Integer division, rounding half away from zero (commercial rounding). */
export function divRound(n: bigint, d: bigint): bigint {
  if (d < 0n) return divRound(-n, -d);
  const q = (abs(n) + d / 2n) / d;
  return n < 0n ? -q : q;
}

export function toCents(n: number): bigint {
  return divRound(micro(n), 10_000n);
}

export function baseCents(quantity: number, unitPrice: number): bigint {
  return divRound(micro(quantity) * micro(unitPrice), 10n ** 10n);
}

export function percentCents(base: bigint, percent: number): bigint {
  return divRound(base * micro(percent), 10n ** 8n);
}

export function formatCents(amount: bigint): string {
  return fromCents(amount).toFixed(2);
}

function abs(n: bigint): bigint {
  return n < 0n ? -n : n;
}
