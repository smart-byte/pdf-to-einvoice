// Discounts and charges on the whole invoice (BG-20, BG-21): what each needs by itself, and how it goes into the VAT
// groups of the lines, by percentage or by amount, with what is wrong with it.
import { isNumber } from '../util/numbers.js';
import { error, warning, type Finding } from './finding.js';
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

export type Adjustable = Pick<Invoice, 'lines' | 'discounts' | 'charges' | 'currency'>;
export type Entry = Omit<Adjustment, 'amount' | 'base'> & { cents: bigint; base?: bigint };

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

/**
 * What is wrong with each discount and charge on the whole invoice by itself, without the lines: for data whose lines
 * cannot be calculated yet, so that nothing can be placed in a VAT group. Never throws.
 */
export function checkAdjustments(invoice: Adjustable): Finding[] {
  return resolveAdjustments(invoice).problems;
}

export function adjustmentOf({ cents: amount, base, percent, reason, ...entry }: Entry): Adjustment {
  return {
    ...entry,
    amount: fromCents(amount),
    ...(base !== undefined ? { base: fromCents(base), percent } : {}),
    ...(reason !== undefined ? { reason } : {}),
  };
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

/** The path of an entry, or of one of its fields. */
type At = (field?: string) => string;

/**
 * What one entry needs by itself, without the lines: numbers that are numbers, a percentage or an amount, a VAT
 * category and rate that fit together. `checked` is missing where a field cannot be used. A charge without its reason
 * is reported, but can still be placed.
 */
function checkEntry(raw: unknown, list: List, index: number): { checked?: Checked; problems: Finding[] } {
  const at: At = (field) => pathOf(list, index, field);
  const entry: Unchecked<DocumentAllowance> = raw && typeof raw === 'object' ? raw : {};
  const numbers = numbersRefused(entry, list, at);
  const reason = list === 'charges' && entry.reason === undefined ? [error(at('reason'), 'charge-reason')] : [];
  const vat = vatOf(entry, at);
  const problems = [...numbers, ...reason, ...vat.problems];
  if (numbers.length || vat.problems.length) return { problems };

  const vatRate = isNumber(entry.vatRate) ? entry.vatRate : undefined;
  const { category } = vat;
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

/** What keeps the numbers of an entry from being used: one that is no number, neither percentage nor amount, or a negative percentage. */
function numbersRefused(entry: Unchecked<DocumentAllowance>, list: List, at: At): Finding[] {
  const problems = (['percent', 'amount', 'vatRate'] as const)
    .filter((field) => entry[field] !== undefined && !isNumber(entry[field]))
    .map((field) => error(at(field), 'format.number'));
  if (entry.percent === undefined && entry.amount === undefined) {
    problems.push(error(at(), 'adjustment', { what: WHAT[list] }));
  }
  if (isNumber(entry.percent) && entry.percent < 0) problems.push(error(at('percent'), 'adjustment.negative'));
  return problems;
}

/** The VAT category an entry states, or S for a rate above 0 alone, and what keeps category and rate from being used. */
function vatOf(entry: Unchecked<DocumentAllowance>, at: At): { category?: VatCategory; problems: Finding[] } {
  const stated = isVatCategory(entry.vatCategory) ? entry.vatCategory : undefined;
  if (entry.vatCategory !== undefined && stated === undefined) {
    return { problems: [error(at('vatCategory'), 'format.category')] };
  }
  if (!isNumber(entry.vatRate)) return { category: stated, problems: [] };
  const category = stated ?? (entry.vatRate > 0 ? 'S' : undefined);
  const rateError = vatRateError(at('vatRate'), category, entry.vatRate);
  return { category, problems: rateError ? [rateError] : [] };
}

/** The lines of one VAT category and rate, summed. */
export interface Group {
  category: VatCategory;
  rate: number;
  cents: bigint;
}

/** What placing one entry into the VAT groups gave: its parts, and whether it found a group at all. */
interface Placed {
  entries: Entry[];
  problems: Finding[];
  placed: boolean;
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
 * A percentage, taken of every group that matches, each rounded to the cent. An amount beside it counts on one group
 * if it is within R040, and has to be the sum of the rounded group amounts on several.
 */
function placePercent(entry: Checked & { percent: number }, matching: Group[], named: string, slack: number): Placed {
  const { list, index, percent } = entry;
  if (!matching.length) {
    const field = entry.vatRate !== undefined ? 'vatRate' : 'vatCategory';
    return unplaced(error(pathOf(list, index, field), 'adjustment-group.percent', { group: named }));
  }
  const computed = matching.map((g) => ({ g, cents: percentCents(g.cents, percent) }));
  const problems = entry.amount === undefined ? [] : statedAgainst(entry, entry.amount, computed, slack);
  const entries = withStated(computed, entry.amount).map((p) => ({
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
 * The parts a percentage comes to, with the amount stated beside it. On one group that amount takes the place of the
 * part, as the amount written on a line does; on several the parts stay, and the amount has to be their sum.
 */
function withStated(computed: Part[], amount: number | undefined): Part[] {
  const [part] = computed;
  return part && computed.length === 1 && amount !== undefined ? [{ g: part.g, cents: toCents(amount) }] : computed;
}

/** What a percentage comes to in one VAT group. */
interface Part {
  g: Group;
  cents: bigint;
}

/**
 * What is wrong with the amount stated beside a percentage, against the parts the percentage comes to. On one group
 * it has to agree within R040; on several it has to be their sum.
 */
function statedAgainst(
  { list, index, percent }: Checked & { percent: number },
  amount: number,
  parts: Part[],
  slack: number,
): Finding[] {
  const what = WHAT[list];
  const at = pathOf(list, index, 'amount');
  const stated = toCents(amount);
  const [part] = parts;
  if (part && parts.length === 1) {
    const agrees = percentAgrees(fromCents(part.g.cents), percent, fromCents(stated), slack);
    if (agrees) return [];
    const [base, expected] = [formatCents(part.g.cents), formatCents(part.cents)];
    return [error(at, 'adjustment-mismatch', { percent, base, expected, what, stated: formatCents(stated) })];
  }
  const sum = parts.reduce((a, p) => a + p.cents, 0n);
  if (sum === stated) return [];
  const split = parts.map((p) => formatCents(p.cents)).join(' + ');
  return [
    error(at, 'adjustment-mismatch.split', {
      percent,
      parts: split,
      sum: formatCents(sum),
      what,
      stated: formatCents(stated),
    }),
  ];
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
    const groups = matching.map((g) => `${g.category} ${g.rate} %`).join(', ');
    return unplaced(error(where, 'adjustment-group.several', { groups, what }));
  }
  const group =
    matching[0] ?? (category !== undefined && rate !== undefined ? { category, rate, cents: 0n } : undefined);
  if (!group) return unplaced(error(where, 'adjustment-group.none', { group: named || 'it names', what }));

  const stated = toCents(entry.amount);
  const signs = group.cents !== 0n && stated !== 0n && group.cents < 0n !== stated < 0n;
  return {
    entries: [{ list, index, category: group.category, rate: group.rate, cents: stated, reason: entry.reason }],
    problems: signs ? [warning(pathOf(list, index, 'amount'), 'adjustment-sign', { what })] : [],
    placed: true,
  };
}

/** An entry that found no group to go into. */
function unplaced(problem: Finding): Placed {
  return { entries: [], problems: [problem], placed: false };
}

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
export function lineParts(lines: Line[], lineCents: bigint[]): Group[] {
  return lines.map((line, i) => ({ category: line.vatCategory, rate: line.vatRate, cents: lineCents[i]! }));
}

function pathOf(list: List, index: number, field?: string): string {
  return field ? `${list}.${index}.${field}` : `${list}.${index}`;
}

type List = Adjustment['list'];
const LISTS = ['discounts', 'charges'] as const;
const WHAT = { discounts: 'discount', charges: 'charge' } as const;
