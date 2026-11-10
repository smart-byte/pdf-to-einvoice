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
  vatBreakdown: VatGroup[];
  net: number;
  vat: number;
  gross: number;
  prepaid: number;
  due: number;
}

// Amounts are summed as whole cents in BigInt: binary floating point cannot
// represent 1.005 and would round it down.
const micro = (n: number) => BigInt(Math.round(n * 1e6));

/** Integer division, rounding half away from zero (commercial rounding). */
function divRound(n: bigint, d: bigint): bigint {
  const abs = n < 0n ? -n : n;
  const q = (abs + d / 2n) / d;
  return n < 0n ? -q : q;
}

const toCents = (n: number) => divRound(micro(n), 10_000n);
const fromCents = (c: bigint) => Number(c) / 100;

/**
 * Derives every total from the lines, following the EN 16931 calculation
 * rules: VAT is calculated per category and rate on the summed base
 * (BR-CO-17), not per line.
 */
export function calculate(invoice: Invoice): Totals {
  const lineCents = invoice.lines.map((l) => (l.netAmount != null ? toCents(l.netAmount) : divRound(micro(l.quantity) * micro(l.unitPrice), 10n ** 10n)));

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
