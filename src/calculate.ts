import type { Invoice, VatCategory } from './model.js';

export interface VatGroup {
  category: VatCategory;
  rate: number;
  taxable: number;
  tax: number;
}

export interface Totals {
  /** Net amount of each line, in line order. */
  lineNet: number[];
  /** The discount of each line, in line order, with the base it was taken from; undefined for a line without one. */
  lineDiscounts: ({ base: number; amount: number } | undefined)[];
  vatBreakdown: VatGroup[];
  net: number;
  vat: number;
  gross: number;
  prepaid: number;
  due: number;
}

// Amounts are summed as whole cents in BigInt: binary floating point cannot
// represent 1.005 and would round it down.
export const micro = (n: number) => BigInt(Math.round(n * 1e6));

/** Integer division, rounding half away from zero (commercial rounding). */
function divRound(n: bigint, d: bigint): bigint {
  const abs = n < 0n ? -n : n;
  const q = (abs + d / 2n) / d;
  return n < 0n ? -q : q;
}

const toCents = (n: number) => divRound(micro(n), 10_000n);
const fromCents = (c: bigint) => Number(c) / 100;
const baseCents = (quantity: number, unitPrice: number) => divRound(micro(quantity) * micro(unitPrice), 10n ** 10n);
const percentCents = (base: bigint, percent: number) => divRound(base * micro(percent), 10n ** 8n);

/** Quantity times unit price, rounded to the cent: the base of a line and of its discount. */
export const lineBase = (quantity: number, unitPrice: number) => fromCents(baseCents(quantity, unitPrice));

/** The percentage of a base, rounded to the cent. */
export const percentOf = (base: number, percent: number) => fromCents(percentCents(toCents(base), percent));

/**
 * Whether an amount is the percentage of its base, `slack` apart at most (Peppol R040). The product is not rounded
 * first: 10 % of 0.15 is 0.015, which 0.04 misses by 0.025.
 */
export function percentAgrees(base: number, percent: number, amount: number, slack: number): boolean {
  const apart = micro(amount) * 100n * 10n ** 6n - micro(base) * micro(percent);
  return (apart < 0n ? -apart : apart) <= micro(slack) * 100n * 10n ** 6n;
}

/** How far a stated amount may be from the calculated one: two cents, half a forint where there are no cents (PEPPOL-EN16931-R120). */
export const slackOf = (currency?: string) => (currency === 'HUF' ? 0.5 : 0.02);

/**
 * Derives every total from the lines, following the EN 16931 calculation
 * rules: VAT is calculated per category and rate on the summed base
 * (BR-CO-17), not per line.
 */
export function calculate(invoice: Invoice): Totals {
  const discounts = invoice.lines.map((l) => {
    if (!l.discount) return undefined;
    const base = baseCents(l.quantity, l.unitPrice);
    const amount = l.discount.amount != null ? toCents(l.discount.amount) : percentCents(base, l.discount.percent ?? 0);
    return { base, amount };
  });
  const lineCents = invoice.lines.map((l, i) =>
    l.netAmount != null ? toCents(l.netAmount) : baseCents(l.quantity, l.unitPrice) - (discounts[i]?.amount ?? 0n),
  );

  const groups = new Map<string, { category: VatCategory; rate: number; taxable: bigint }>();
  invoice.lines.forEach((l, i) => {
    const key = `${l.vatCategory}|${l.vatRate}`;
    const group = groups.get(key) ?? { category: l.vatCategory, rate: l.vatRate, taxable: 0n };
    group.taxable += lineCents[i]!;
    groups.set(key, group);
  });

  const breakdown = [...groups.values()].map((g) => ({
    ...g,
    tax: divRound(g.taxable * micro(g.rate), 10n ** 8n),
  }));

  const net = lineCents.reduce((a, b) => a + b, 0n);
  const vat = breakdown.reduce((a, g) => a + g.tax, 0n);
  const prepaid = toCents(invoice.prepaidAmount ?? 0);

  return {
    lineNet: lineCents.map(fromCents),
    lineDiscounts: discounts.map((d) => d && { base: fromCents(d.base), amount: fromCents(d.amount) }),
    vatBreakdown: breakdown.map((g) => ({
      category: g.category,
      rate: g.rate,
      taxable: fromCents(g.taxable),
      tax: fromCents(g.tax),
    })),
    net: fromCents(net),
    vat: fromCents(vat),
    gross: fromCents(net + vat),
    prepaid: fromCents(prepaid),
    due: fromCents(net + vat - prepaid),
  };
}
