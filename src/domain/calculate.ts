import { error, warning, type Finding } from './finding.js';
import type { MessageKey, MessageParams } from './messages.js';
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
  const lineCents = lines.map((l, i) =>
    l.netAmount != null ? toCents(l.netAmount) : baseCents(l.quantity, l.unitPrice) - (discounts[i]?.amount ?? 0n),
  );
  return { discounts, lineCents };
}

type Entry = Omit<Adjustment, 'amount' | 'base'> & { cents: bigint; base?: bigint };
type Adjustable = Pick<Invoice, 'lines' | 'discounts' | 'charges' | 'currency'>;
type List = Adjustment['list'];

/** The lines of one VAT category and rate, summed. */
interface Group {
  category: VatCategory;
  rate: number;
  cents: bigint;
}

/**
 * A discount or charge whose fields are all usable. It states a percentage, an amount, or both: a percentage alone, an
 * amount alone, or a percentage with the amount it comes to.
 */
type Checked = ({ percent: number; amount?: number } | { percent?: undefined; amount: number }) & {
  list: List;
  index: number;
  /** The category it states; a rate above 0 alone means S. */
  category?: VatCategory;
  /** The rate of the group it goes into: 0 for every category but S, otherwise the rate it states. */
  rate?: number;
  /** The rate as given, which tells where a problem is reported. */
  vatRate?: number;
  reason?: string;
};

/** What placing one entry into the VAT groups gave: its parts, and whether it found a group at all. */
interface Placed {
  entries: Entry[];
  problems: Finding[];
  placed: boolean;
}

const LISTS = ['discounts', 'charges'] as const;
const WHAT = { discounts: 'discount', charges: 'charge' } as const;

const pathOf = (list: List, index: number, field?: string) =>
  field ? `${list}.${index}.${field}` : `${list}.${index}`;

/** The lines summed by VAT category and rate, in the order the groups first appear. */
function groupLines(lines: Line[], lineCents: bigint[]): Group[] {
  const groups = new Map<string, Group>();
  lines.forEach((l, i) => {
    const key = `${l.vatCategory}|${l.vatRate}`;
    const group = groups.get(key) ?? { category: l.vatCategory, rate: l.vatRate, cents: 0n };
    group.cents += lineCents[i]!;
    groups.set(key, group);
  });
  return [...groups.values()];
}

/**
 * What one entry needs by itself, without the lines: numbers that are numbers, a percentage or an amount, a VAT
 * category and rate that fit together. `checked` is missing where a field cannot be used. A charge without its reason
 * is reported, but can still be placed.
 */
function checkEntry(raw: unknown, list: List, index: number): { checked?: Checked; problems: Finding[] } {
  const what = WHAT[list];
  const at = (field?: string) => pathOf(list, index, field);
  const e: Record<string, any> = raw && typeof raw === 'object' ? raw : {};
  const problems: Finding[] = [];
  let usable = true;
  const refuse = <K extends MessageKey>(path: string, key: K, ...params: MessageParams<K>) => {
    problems.push(error(path, key, ...params));
    usable = false;
  };

  for (const field of ['percent', 'amount', 'vatRate']) {
    if (e[field] !== undefined && !isNumber(e[field])) refuse(at(field), 'format.number');
  }
  if (e.percent === undefined && e.amount === undefined) refuse(at(), 'adjustment', { what });
  if (isNumber(e.percent) && e.percent < 0) refuse(at('percent'), 'adjustment.negative');
  if (list === 'charges' && e.reason === undefined) {
    problems.push(error(at('reason'), 'charge-reason'));
  }

  let category: VatCategory | undefined = e.vatCategory;
  if (category !== undefined && !(category in VAT_CATEGORIES)) {
    refuse(at('vatCategory'), 'format.category');
  } else if (isNumber(e.vatRate)) {
    if (category === undefined && e.vatRate > 0) category = 'S';
    if (e.vatRate < 0) refuse(at('vatRate'), 'vat-rate.negative');
    else if (category === 'S' && e.vatRate === 0) refuse(at('vatRate'), 'vat-rate.standard');
    else if (category !== undefined && category !== 'S' && e.vatRate !== 0)
      refuse(at('vatRate'), 'vat-rate.zero', { category });
  }
  if (!usable) return { problems };

  const rate: number | undefined = category !== undefined && category !== 'S' ? 0 : e.vatRate;
  const checked = {
    list,
    index,
    category,
    rate,
    vatRate: e.vatRate,
    percent: e.percent,
    amount: e.amount,
    reason: e.reason,
  } as Checked;
  return { checked, problems };
}

/**
 * A percentage, taken of every group that matches, each rounded to the cent. An amount beside it counts on one group
 * if it is within R040, and has to be the sum of the rounded group amounts on several.
 */
function placePercent(entry: Checked & { percent: number }, matching: Group[], named: string, slack: number): Placed {
  const { list, index, percent } = entry;
  const what = WHAT[list];
  const at = (field?: string) => pathOf(list, index, field);
  if (!matching.length) {
    return {
      entries: [],
      problems: [
        error(at(entry.vatRate !== undefined ? 'vatRate' : 'vatCategory'), 'adjustment-group.percent', {
          group: named,
        }),
      ],
      placed: false,
    };
  }

  const problems: Finding[] = [];
  const parts = matching.map((g) => ({ g, cents: percentCents(g.cents, percent) }));
  if (entry.amount !== undefined) {
    const stated = toCents(entry.amount);
    if (parts.length === 1) {
      const part = parts[0]!;
      if (!percentAgrees(fromCents(part.g.cents), percent, fromCents(stated), slack)) {
        problems.push(
          error(at('amount'), 'adjustment-mismatch', {
            percent,
            base: money(part.g.cents),
            expected: money(part.cents),
            what,
            stated: money(stated),
          }),
        );
      }
      // The stated amount is the one written, as on a line.
      part.cents = stated;
    } else {
      const sum = parts.reduce((a, p) => a + p.cents, 0n);
      if (sum !== stated) {
        problems.push(
          error(at('amount'), 'adjustment-mismatch.split', {
            percent,
            parts: parts.map((p) => money(p.cents)).join(' + '),
            sum: money(sum),
            what,
            stated: money(stated),
          }),
        );
      }
    }
  }
  const entries = parts.map((p) => ({
    list,
    index,
    category: p.g.category,
    rate: p.g.rate,
    cents: p.cents,
    base: p.g.cents,
    percent,
    reason: entry.reason,
  }));
  return { entries, problems, placed: true };
}

/**
 * An amount, into the one group that matches. With none it makes a group of its own if its category and rate are
 * known; with several it is an error, since an amount is never split between VAT rates.
 */
function placeAmount(entry: Checked & { amount: number }, matching: Group[], named: string): Placed {
  const { list, index, category, rate } = entry;
  const what = WHAT[list];
  const where = pathOf(list, index, entry.vatRate === undefined ? 'vatRate' : 'vatCategory');
  if (matching.length > 1) {
    return {
      entries: [],
      problems: [
        error(where, 'adjustment-group.several', {
          groups: matching.map((g) => `${g.category} ${g.rate} %`).join(', '),
          what,
        }),
      ],
      placed: false,
    };
  }
  const group =
    matching[0] ?? (category !== undefined && rate !== undefined ? { category, rate, cents: 0n } : undefined);
  if (!group) {
    return {
      entries: [],
      problems: [error(where, 'adjustment-group.none', { group: named || 'it names', what })],
      placed: false,
    };
  }

  const problems: Finding[] = [];
  const stated = toCents(entry.amount);
  if (group.cents !== 0n && stated !== 0n && group.cents < 0n !== stated < 0n) {
    problems.push(warning(pathOf(list, index, 'amount'), 'adjustment-sign', { what }));
  }
  return {
    entries: [{ list, index, category: group.category, rate: group.rate, cents: stated, reason: entry.reason }],
    problems,
    placed: true,
  };
}

/** One checked entry into the VAT groups its category and rate match: by percentage or by amount. */
function place(entry: Checked, groups: Group[], slack: number): Placed {
  const { category, rate } = entry;
  const matching = groups.filter(
    (g) => (category === undefined || g.category === category) && (rate === undefined || g.rate === rate),
  );
  const named = [category, rate !== undefined ? `${rate} %` : undefined].filter(Boolean).join(' ');
  return entry.percent !== undefined
    ? placePercent(entry, matching, named, slack)
    : placeAmount(entry, matching, named);
}

/**
 * Puts each discount and charge on the whole invoice into the VAT groups of the lines (category and rate). What an
 * entry states of these filters the groups; a rate above 0 alone means category S. A percentage is always taken of
 * the lines alone, so the order of the entries does not matter. Without `lineCents` only what an entry needs by
 * itself is checked, and nothing is placed.
 */
function resolve(invoice: Adjustable, lineCents?: bigint[]) {
  const groups = lineCents ? groupLines(invoice.lines, lineCents) : [];
  const slack = slackOf(invoice.currency);
  const entries: Entry[] = [];
  const problems: Finding[] = [];
  let resolved = lineCents !== undefined;

  for (const list of LISTS) {
    const given: unknown = invoice[list];
    if (given === undefined) continue;
    if (!Array.isArray(given)) {
      problems.push(error(list, 'format.list', { what: WHAT[list] }));
      resolved = false;
      continue;
    }
    for (const [index, raw] of given.entries()) {
      const { checked, problems: own } = checkEntry(raw, list, index);
      problems.push(...own);
      if (!checked || !lineCents) {
        resolved = false;
        continue;
      }
      const placed = place(checked, groups, slack);
      entries.push(...placed.entries);
      problems.push(...placed.problems);
      resolved &&= placed.placed;
    }
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
export function resolveAdjustments(
  invoice: Adjustable,
  lines = true,
): { adjustments: Adjustment[]; problems: Finding[]; resolved: boolean } {
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
