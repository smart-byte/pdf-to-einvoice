// The totals of an invoice, following the EN 16931 calculation rules, in exact cents.
import {
  adjustmentOf,
  lineParts,
  resolveAdjustments,
  sumByGroup,
  type Adjustment,
  type Entry,
  type Group,
} from './adjustments.js';
import type { Finding } from './finding.js';
import type { Invoice, Line, VatCategory } from './model.js';
import { baseCents, divRound, fromCents, micro, percentCents, toCents } from './money.js';

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
  /** Sum of the lines (BT-106). */
  lineTotal: number;
  /** Sum of the discounts on the whole invoice (BT-107). */
  allowances: number;
  /** Sum of the charges on the whole invoice (BT-108). */
  charges: number;
  /** The discounts and charges on the whole invoice, one for each VAT group they go into. */
  adjustments: Adjustment[];
  vatBreakdown: VatGroup[];
  /** Total without VAT, after the discounts and charges on the whole invoice (BT-109). */
  net: number;
  vat: number;
  gross: number;
  prepaid: number;
  due: number;
}

/**
 * Derives every total from the lines and the discounts and charges on the whole invoice, following the EN 16931
 * calculation rules: VAT is calculated per category and rate on the summed base (BR-CO-17), not per line. Throws if a
 * discount or charge on the whole invoice cannot be placed in a VAT group (see `tryCalculate`).
 */
export function calculate(invoice: Invoice): Totals {
  const { totals, problems } = tryCalculate(invoice);
  if (!totals) {
    throw new Error(problems.flatMap((problem) => (problem.severity === 'error' ? [problem.message] : [])).join(' '));
  }
  return totals;
}

/**
 * `calculate` for data that may not allow it: the totals, where every discount and charge on the whole invoice could
 * be placed in a VAT group, and what is wrong with these entries. Never throws, but expects the numbers of every line;
 * without them `checkAdjustments` says what it can.
 */
export function tryCalculate(invoice: Invoice): { totals?: Totals; problems: Finding[] } {
  const inCents = linesInCents(invoice.lines);
  const { entries, problems, resolved } = resolveAdjustments(invoice, inCents.lineCents);
  return resolved ? { totals: totalsOf(invoice, inCents, entries), problems } : { problems };
}

/** Each line in cents, and its discount with the base it was taken from. Expects the numbers of every line. */
function linesInCents(lines: Line[]) {
  const discounts = lines.map((line) => {
    if (!line.discount) return undefined;
    const base = baseCents(line.quantity, line.unitPrice);
    const amount =
      line.discount.amount != null ? toCents(line.discount.amount) : percentCents(base, line.discount.percent ?? 0);
    return { base, amount };
  });
  const lineCents = lines.map((line, i) =>
    line.netAmount != null
      ? toCents(line.netAmount)
      : baseCents(line.quantity, line.unitPrice) - (discounts[i]?.amount ?? 0n),
  );
  return { discounts, lineCents };
}

function totalsOf(
  invoice: Invoice,
  { discounts, lineCents }: ReturnType<typeof linesInCents>,
  entries: Entry[],
): Totals {
  const breakdown = vatGroupsOf(invoice.lines, lineCents, entries);
  const lineTotal = sum(lineCents);
  const allowances = sum(centsOf(entries, 'discounts'));
  const charges = sum(centsOf(entries, 'charges'));
  const net = lineTotal - allowances + charges;
  const vat = sum(breakdown.map((group) => group.tax));
  const prepaid = toCents(invoice.prepaidAmount ?? 0);

  return {
    lineNet: lineCents.map(fromCents),
    lineDiscounts: discounts.map(
      (discount) => discount && { base: fromCents(discount.base), amount: fromCents(discount.amount) },
    ),
    lineTotal: fromCents(lineTotal),
    allowances: fromCents(allowances),
    charges: fromCents(charges),
    adjustments: entries.map(adjustmentOf),
    vatBreakdown: breakdown.map((group) => ({
      category: group.category,
      rate: group.rate,
      taxable: fromCents(group.cents),
      tax: fromCents(group.tax),
    })),
    net: fromCents(net),
    vat: fromCents(vat),
    gross: fromCents(net + vat),
    prepaid: fromCents(prepaid),
    due: fromCents(net + vat - prepaid),
  };
}

/**
 * The VAT groups of the lines with the discounts taken off and the charges added, each with its VAT on its summed
 * base (BR-CO-17).
 */
function vatGroupsOf(lines: Line[], lineCents: bigint[], entries: Entry[]): (Group & { tax: bigint })[] {
  return sumByGroup([
    ...lineParts(lines, lineCents),
    ...entries.map((entry) => ({
      category: entry.category,
      rate: entry.rate,
      cents: entry.list === 'charges' ? entry.cents : -entry.cents,
    })),
  ]).map((group) => ({ ...group, tax: divRound(group.cents * micro(group.rate), 10n ** 8n) }));
}

/** The amounts of the discounts or of the charges on the whole invoice. */
function centsOf(entries: Entry[], list: Entry['list']): bigint[] {
  return entries.filter((entry) => entry.list === list).map((entry) => entry.cents);
}

function sum(amounts: bigint[]): bigint {
  return amounts.reduce((total, amount) => total + amount, 0n);
}
