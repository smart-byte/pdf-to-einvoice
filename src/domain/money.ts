// Money in exact cents: amounts are taken in millionths and summed as whole cents in BigInt, rounded half away from
// zero. The functions that take and return numbers are for every layer; those on BigInt cents are for the
// calculation of the totals (calculate.ts) and of the discounts and charges (adjustments.ts).

// Binary floating point cannot represent 1.005 and would round it down.
export const micro = (n: number) => BigInt(Math.round(n * 1e6));

const abs = (n: bigint) => (n < 0n ? -n : n);

/** Integer division, rounding half away from zero (commercial rounding). */
export function divRound(n: bigint, d: bigint): bigint {
  if (d < 0n) return divRound(-n, -d);
  const q = (abs(n) + d / 2n) / d;
  return n < 0n ? -q : q;
}

export const toCents = (n: number) => divRound(micro(n), 10_000n);
export const fromCents = (c: bigint) => Number(c) / 100;
export const baseCents = (quantity: number, unitPrice: number) =>
  divRound(micro(quantity) * micro(unitPrice), 10n ** 10n);
export const percentCents = (base: bigint, percent: number) => divRound(base * micro(percent), 10n ** 8n);

/**
 * An amount in whole cents, rounded half away from zero: 1.005 is 101, where `Math.round(1.005 * 100)` gives 100. NaN
 * for what cannot be calculated with: NaN, infinity, or a number too large for its millionths.
 */
export const cents = (n: number) => (Number.isFinite(n * 1e6) ? Number(toCents(n)) : NaN);

/** The sum of amounts as given, not rounded: summed in millionths, where 0.1 + 0.2 is 0.3. */
export const exactSum = (amounts: number[]) => Number(amounts.reduce((sum, n) => sum + micro(n), 0n)) / 1e6;

/** Quantity times unit price, rounded to the cent: the base of a line and of its discount. */
export const lineBase = (quantity: number, unitPrice: number) => fromCents(baseCents(quantity, unitPrice));

/** The percentage of a base, rounded to the cent. */
export const percentOf = (base: number, percent: number) => fromCents(percentCents(toCents(base), percent));

/** The net amount a gross amount holds at a VAT rate, rounded to the cent: 119 at 19 % holds 100. */
export const netOfGross = (gross: number, rate: number) =>
  fromCents(divRound(toCents(gross) * 10n ** 8n, 10n ** 8n + micro(rate)));

/** The price of one unit of an amount, rounded to the cent. */
export const perUnit = (amount: number, quantity: number) =>
  fromCents(divRound(toCents(amount) * 10n ** 6n, micro(quantity)));

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
export function lineAgrees(quantity: number, unitPrice: number, less: number, net: number, slack: number): boolean {
  const apart = micro(quantity) * micro(unitPrice) - (micro(less) + micro(net)) * 10n ** 6n;
  return abs(apart) <= micro(slack) * 10n ** 6n;
}

/** How far a stated amount may be from the calculated one: two cents, half a forint where there are no cents (PEPPOL-EN16931-R120). */
export const slackOf = (currency?: string) => (currency === 'HUF' ? 0.5 : 0.02);

export const formatCents = (amount: bigint) => fromCents(amount).toFixed(2);
