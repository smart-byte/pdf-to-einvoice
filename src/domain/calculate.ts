import type { Finding } from './finding.js';
import { VAT_CATEGORIES, type Invoice, type Line, type VatCategory } from './model.js';

export interface VatGroup {
  category: VatCategory;
  rate: number;
  taxable: number;
  tax: number;
}

/** A discount or charge on the whole invoice as it goes into one VAT group: one entry of BG-20 or BG-21. */
export interface Adjustment {
  /** The list and the position in it the entry was made from. */
  list: 'discounts' | 'charges';
  index: number;
  category: VatCategory;
  rate: number;
  /** Signed as in the standard. */
  amount: number;
  /** With a percentage: the sum of the lines of the VAT group, which it is taken of. */
  base?: number;
  percent?: number;
  reason?: string;
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

const isNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const money = (cents: bigint) => fromCents(cents).toFixed(2);

/** Each line in cents, and its discount with the base it was taken from. Expects the numbers of every line. */
function linesInCents(lines: Line[]) {
  const discounts = lines.map((l) => {
    if (!l.discount) return undefined;
    const base = baseCents(l.quantity, l.unitPrice);
    const amount = l.discount.amount != null ? toCents(l.discount.amount) : percentCents(base, l.discount.percent ?? 0);
    return { base, amount };
  });
  const lineCents = lines.map((l, i) => (l.netAmount != null ? toCents(l.netAmount) : baseCents(l.quantity, l.unitPrice) - (discounts[i]?.amount ?? 0n)));
  return { discounts, lineCents };
}

type Entry = Omit<Adjustment, 'amount' | 'base'> & { cents: bigint; base?: bigint };
type Adjustable = Pick<Invoice, 'lines' | 'discounts' | 'charges' | 'currency'>;

/**
 * Puts each discount and charge on the whole invoice into the VAT groups of the lines (category and rate). What an
 * entry states of these filters the groups; a rate above 0 alone means category S. A percentage is taken of every
 * group that matches, each rounded to the cent, and always of the lines alone, so the order of the entries does not
 * matter. An amount goes into the one group that matches; with none it makes a group of its own if its category and
 * rate are known, and with several it is an error: an amount is never split between VAT rates. Beside a percentage an
 * amount counts on one group if it is within R040, and has to be the sum of the rounded group amounts on several.
 * Without `lineCents` only what an entry needs by itself is checked.
 */
function resolve(invoice: Adjustable, lineCents?: bigint[]) {
  const problems: Finding[] = [];
  const add = (severity: Finding['severity'], path: string, code: string, message: string) => problems.push({ path, severity, code, message });
  const error = (path: string, code: string, message: string) => add('error', path, code, message);
  const groups = new Map<string, { category: VatCategory; rate: number; cents: bigint }>();
  if (lineCents) {
    invoice.lines.forEach((l, i) => {
      const key = `${l.vatCategory}|${l.vatRate}`;
      const group = groups.get(key) ?? { category: l.vatCategory, rate: l.vatRate, cents: 0n };
      group.cents += lineCents[i]!;
      groups.set(key, group);
    });
  }
  const lineGroups = [...groups.values()];
  const entries: Entry[] = [];
  let resolved = lineCents !== undefined;
  const slack = slackOf(invoice.currency);

  for (const [list, what] of [
    ['discounts', 'discount'],
    ['charges', 'charge'],
  ] as const) {
    const given: unknown = invoice[list];
    if (given === undefined) continue;
    if (!Array.isArray(given)) {
      error(list, 'format', `Not a list of ${what}s.`);
      resolved = false;
      continue;
    }
    given.forEach((raw: unknown, index) => {
      const at = (field?: string) => (field ? `${list}.${index}.${field}` : `${list}.${index}`);
      const e: Record<string, any> = raw && typeof raw === 'object' ? raw : {};
      let ok = true;
      const refuse = (path: string, code: string, message: string) => {
        error(path, code, message);
        ok = false;
      };
      for (const field of ['percent', 'amount', 'vatRate']) {
        if (e[field] !== undefined && !isNumber(e[field])) refuse(at(field), 'format', 'Not a number.');
      }
      if (e.percent === undefined && e.amount === undefined) refuse(at(), 'adjustment', `A ${what} needs a percentage or an amount.`);
      if (isNumber(e.percent) && e.percent < 0) refuse(at('percent'), 'adjustment', 'A percentage is never negative; the sign comes from the lines.');
      if (list === 'charges' && e.reason === undefined) error(at('reason'), 'charge-reason', 'A charge needs its reason as printed, e.g. freight.');
      let category: VatCategory | undefined = e.vatCategory;
      if (category !== undefined && !(category in VAT_CATEGORIES)) {
        refuse(at('vatCategory'), 'format', `Unknown VAT category. Use one of ${Object.keys(VAT_CATEGORIES).join(', ')}.`);
      } else if (isNumber(e.vatRate)) {
        if (category === undefined && e.vatRate > 0) category = 'S';
        if (e.vatRate < 0) refuse(at('vatRate'), 'vat-rate', 'A VAT rate is never negative.');
        else if (category === 'S' && e.vatRate === 0) refuse(at('vatRate'), 'vat-rate', 'With VAT charged (category S), the rate must be above 0.');
        else if (category !== undefined && category !== 'S' && e.vatRate !== 0)
          refuse(at('vatRate'), 'vat-rate', `Category ${category} carries no VAT: the rate must be 0.`);
      }
      if (!ok || !lineCents) {
        resolved = false;
        return;
      }

      const rate: number | undefined = category !== undefined && category !== 'S' ? 0 : e.vatRate;
      const matching = lineGroups.filter((g) => (category === undefined || g.category === category) && (rate === undefined || g.rate === rate));
      const named = [category, rate !== undefined ? `${rate} %` : undefined].filter(Boolean).join(' ');
      const unplaced = (path: string, code: string, message: string) => {
        error(path, code, message);
        resolved = false;
      };

      if (e.percent !== undefined) {
        if (!matching.length) {
          unplaced(
            at(e.vatRate !== undefined ? 'vatRate' : 'vatCategory'),
            'adjustment-group',
            `No line is in the VAT group ${named}, so the percentage has nothing to be taken of. Correct the VAT category or rate, or leave both out to take it of all lines.`,
          );
          return;
        }
        const parts = matching.map((g) => ({ g, cents: percentCents(g.cents, e.percent) }));
        if (e.amount !== undefined) {
          const stated = toCents(e.amount);
          if (parts.length === 1) {
            const part = parts[0]!;
            if (!percentAgrees(fromCents(part.g.cents), e.percent, fromCents(stated), slack)) {
              error(
                at('amount'),
                'adjustment-mismatch',
                `${e.percent} % of ${money(part.g.cents)} is ${money(part.cents)}, but the ${what} states ${money(stated)}. Correct the percentage or the amount.`,
              );
            }
            // The stated amount is the one written, as on a line.
            part.cents = stated;
          } else {
            const sum = parts.reduce((a, p) => a + p.cents, 0n);
            if (sum !== stated) {
              error(
                at('amount'),
                'adjustment-mismatch',
                `${e.percent} % of the lines comes to ${parts.map((p) => money(p.cents)).join(' + ')} = ${money(sum)} by VAT rate, but the ${what} states ${money(stated)}. Correct the percentage or the amount; an amount is not split between VAT rates.`,
              );
            }
          }
        }
        entries.push(
          ...parts.map((p) => ({ list, index, category: p.g.category, rate: p.g.rate, cents: p.cents, base: p.g.cents, percent: e.percent, reason: e.reason })),
        );
        return;
      }

      const where = e.vatRate === undefined ? 'vatRate' : 'vatCategory';
      if (matching.length > 1) {
        unplaced(
          at(where),
          'adjustment-group',
          `The lines are in several VAT groups (${matching.map((g) => `${g.category} ${g.rate} %`).join(', ')}). State the VAT category and rate this ${what} belongs to; an amount is not split between them.`,
        );
        return;
      }
      const group = matching[0] ?? (category !== undefined && rate !== undefined ? { category, rate, cents: 0n } : undefined);
      if (!group) {
        unplaced(at(where), 'adjustment-group', `No line is in the VAT group ${named || 'it names'}. State the VAT category and rate this ${what} belongs to.`);
        return;
      }
      const stated = toCents(e.amount);
      if (group.cents !== 0n && stated !== 0n && group.cents < 0n !== stated < 0n) {
        add(
          'warning',
          at('amount'),
          'adjustment-sign',
          `The ${what} and its lines have different signs. Where the lines add up to a negative amount, the ${what} is negative too: -10 for 10.`,
        );
      }
      entries.push({ list, index, category: group.category, rate: group.rate, cents: stated, reason: e.reason });
    });
  }
  return { entries, problems, resolved };
}

const adjustmentOf = ({ cents, base, percent, reason, ...entry }: Entry): Adjustment => ({
  ...entry,
  amount: fromCents(cents),
  ...(base !== undefined ? { base: fromCents(base), percent } : {}),
  ...(reason !== undefined ? { reason } : {}),
});

/**
 * The discounts and charges on the whole invoice, put into VAT groups as `calculate` does, with what is wrong with
 * them. `resolved` is false while any of them cannot be placed; `calculate` then refuses the invoice. Never throws.
 * With `lines` false (their numbers are not all there yet) only what each entry needs by itself is checked.
 */
export function resolveAdjustments(invoice: Adjustable, lines = true): { adjustments: Adjustment[]; problems: Finding[]; resolved: boolean } {
  const { entries, problems, resolved } = resolve(invoice, lines ? linesInCents(invoice.lines).lineCents : undefined);
  return { adjustments: entries.map(adjustmentOf), problems, resolved };
}

/**
 * Derives every total from the lines and the discounts and charges on the whole invoice, following the EN 16931
 * calculation rules: VAT is calculated per category and rate on the summed base (BR-CO-17), not per line. Throws if a
 * discount or charge on the whole invoice cannot be placed in a VAT group (see `resolveAdjustments`).
 */
export function calculate(invoice: Invoice): Totals {
  const { discounts, lineCents } = linesInCents(invoice.lines);
  const { entries, problems, resolved } = resolve(invoice, lineCents);
  if (!resolved) throw new Error(problems.flatMap((p) => (p.severity === 'error' ? [p.message] : [])).join(' '));

  const groups = new Map<string, { category: VatCategory; rate: number; taxable: bigint }>();
  const add = (category: VatCategory, rate: number, cents: bigint) => {
    const key = `${category}|${rate}`;
    const group = groups.get(key) ?? { category, rate, taxable: 0n };
    group.taxable += cents;
    groups.set(key, group);
  };
  invoice.lines.forEach((l, i) => add(l.vatCategory, l.vatRate, lineCents[i]!));
  for (const e of entries) add(e.category, e.rate, e.list === 'charges' ? e.cents : -e.cents);

  const breakdown = [...groups.values()].map((g) => ({
    ...g,
    tax: divRound(g.taxable * micro(g.rate), 10n ** 8n),
  }));

  const sum = (cents: bigint[]) => cents.reduce((a, b) => a + b, 0n);
  const lineTotal = sum(lineCents);
  const allowances = sum(entries.filter((e) => e.list === 'discounts').map((e) => e.cents));
  const charges = sum(entries.filter((e) => e.list === 'charges').map((e) => e.cents));
  const net = lineTotal - allowances + charges;
  const vat = breakdown.reduce((a, g) => a + g.tax, 0n);
  const prepaid = toCents(invoice.prepaidAmount ?? 0);

  return {
    lineNet: lineCents.map(fromCents),
    lineDiscounts: discounts.map((d) => d && { base: fromCents(d.base), amount: fromCents(d.amount) }),
    lineTotal: fromCents(lineTotal),
    allowances: fromCents(allowances),
    charges: fromCents(charges),
    adjustments: entries.map(adjustmentOf),
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
