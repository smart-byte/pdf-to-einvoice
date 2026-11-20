// Discounts and charges on the whole invoice (BG-20, BG-21): what each needs by itself, and how it goes into the VAT
// groups of the lines, by percentage or by amount, with what is wrong with it.
import { isNumber } from '../util/numbers.js';
import { error, warning, type Finding } from './finding.js';
import type { MessageKey, MessageParams } from './messages.js';
import {
  isVatCategory,
  type DocumentAllowance,
  type Invoice,
  type Line,
  type Unchecked,
  type VatCategory,
} from './model.js';
import { formatCents, fromCents, percentAgrees, percentCents, slackOf, toCents } from './money.js';
import { vatRateError } from './vat.js';

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

export type Entry = Omit<Adjustment, 'amount' | 'base'> & { cents: bigint; base?: bigint };
export type Adjustable = Pick<Invoice, 'lines' | 'discounts' | 'charges' | 'currency'>;
type List = Adjustment['list'];

/** The lines of one VAT category and rate, summed. */
export interface Group {
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

/** Amounts summed by VAT category and rate, in the order the groups first appear. */
export function sumByGroup(parts: Group[]): Group[] {
  const groups = new Map<string, Group>();
  for (const part of parts) {
    const key = `${part.category}|${part.rate}`;
    const group = groups.get(key) ?? { category: part.category, rate: part.rate, cents: 0n };
    group.cents += part.cents;
    groups.set(key, group);
  }
  return [...groups.values()];
}

/** Each line as a part of its VAT group. */
export const lineParts = (lines: Line[], lineCents: bigint[]): Group[] =>
  lines.map((line, i) => ({ category: line.vatCategory, rate: line.vatRate, cents: lineCents[i]! }));

/**
 * What one entry needs by itself, without the lines: numbers that are numbers, a percentage or an amount, a VAT
 * category and rate that fit together. `checked` is missing where a field cannot be used. A charge without its reason
 * is reported, but can still be placed.
 */
function checkEntry(raw: unknown, list: List, index: number): { checked?: Checked; problems: Finding[] } {
  const what = WHAT[list];
  const at = (field?: string) => pathOf(list, index, field);
  const entry: Unchecked<DocumentAllowance> = raw && typeof raw === 'object' ? raw : {};
  const problems: Finding[] = [];
  let usable = true;
  const refuse = <K extends MessageKey>(path: string, key: K, ...params: MessageParams<K>) => {
    problems.push(error(path, key, ...params));
    usable = false;
  };

  for (const field of ['percent', 'amount', 'vatRate'] as const) {
    if (entry[field] !== undefined && !isNumber(entry[field])) refuse(at(field), 'format.number');
  }
  if (entry.percent === undefined && entry.amount === undefined) refuse(at(), 'adjustment', { what });
  if (isNumber(entry.percent) && entry.percent < 0) refuse(at('percent'), 'adjustment.negative');
  if (list === 'charges' && entry.reason === undefined) {
    problems.push(error(at('reason'), 'charge-reason'));
  }

  let category = isVatCategory(entry.vatCategory) ? entry.vatCategory : undefined;
  if (entry.vatCategory !== undefined && category === undefined) {
    refuse(at('vatCategory'), 'format.category');
  } else if (isNumber(entry.vatRate)) {
    if (category === undefined && entry.vatRate > 0) category = 'S';
    const rateError = vatRateError(at('vatRate'), category, entry.vatRate);
    if (rateError) {
      problems.push(rateError);
      usable = false;
    }
  }
  if (!usable) return { problems };

  const vatRate = isNumber(entry.vatRate) ? entry.vatRate : undefined;
  const rate = category !== undefined && category !== 'S' ? 0 : vatRate;
  const checked = {
    list,
    index,
    category,
    rate,
    vatRate,
    percent: entry.percent,
    amount: entry.amount,
    reason: entry.reason,
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
            base: formatCents(part.g.cents),
            expected: formatCents(part.cents),
            what,
            stated: formatCents(stated),
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
            parts: parts.map((p) => formatCents(p.cents)).join(' + '),
            sum: formatCents(sum),
            what,
            stated: formatCents(stated),
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
export function resolveAdjustments(invoice: Adjustable, lineCents?: bigint[]) {
  const groups = lineCents ? sumByGroup(lineParts(invoice.lines, lineCents)) : [];
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

export const adjustmentOf = ({ cents: amount, base, percent, reason, ...entry }: Entry): Adjustment => ({
  ...entry,
  amount: fromCents(amount),
  ...(base !== undefined ? { base: fromCents(base), percent } : {}),
  ...(reason !== undefined ? { reason } : {}),
});

/**
 * What is wrong with each discount and charge on the whole invoice by itself, without the lines: for data whose lines
 * cannot be calculated yet, so that nothing can be placed in a VAT group. Never throws.
 */
export const checkAdjustments = (invoice: Adjustable): Finding[] => resolveAdjustments(invoice).problems;
