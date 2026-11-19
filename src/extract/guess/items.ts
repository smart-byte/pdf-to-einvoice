import { cents, lineBase, netOfGross, percentOf, perUnit } from '../../domain/calculate.js';
import type { Line, VatCategory } from '../../domain/model.js';
import { senderOf } from './parties.js';
import { cells, KEY_VALUE, MAX_WRAPPED } from './rows.js';
import { rateOf, type Totals, TOTALS_CELL, TOTALS_ROW } from './totals.js';
import { anyOf, CURRENCY, lastIndex, MONEY, toNumber } from './values.js';

// Items: the rows of the table that add up to the totals, with quantity, unit, price and VAT rate, and the note that
// says why no VAT is charged.

const UNITS: [RegExp, string][] = [
  [/^(std|stunden?|h|hours?|hrs?)\.?$/i, 'HUR'],
  [/^(tage?|days?)\.?$/i, 'DAY'],
  [/^(monate?|months?)\.?$/i, 'MON'],
  [/^kg\.?$/i, 'KGM'],
  [/^(l|liter|litre)(\(?s\)?)?\.?$/i, 'LTR'],
  [/^(m²|qm)\.?$/i, 'MTK'],
  [/^m\.?$/i, 'MTR'],
  [/^(pauschal|psch|flat(?: rate)?|lump sum)\.?$/i, 'LS'],
  [/^km\.?$/i, 'KMT'],
  [/^(wochen?|weeks?)\.?$/i, 'WEE'],
  [/^(stk|stück|st|pcs?|pieces?|units?|unit\(s\))\.?$/i, 'C62'],
];
/** The code of a printed unit. A quantity without one counts pieces; a unit not listed here stays open. */
const unitOf = (mark: string) => (mark === '' ? 'C62' : UNITS.find(([pattern]) => pattern.test(mark))?.[1]);
const MONEY_CELL = new RegExp(`^[€$£]?\\s*${MONEY}\\s*${CURRENCY}?$`);
const RATE_CELL = /^\(?(\d{1,2}(?:[.,]\d+)?)\s?%\)?$/;
const QUANTITY_CELL = /^(-?\d+(?:[.,]\d+)?)\s*(\p{L}+\.?)?$/u;
/** A number with what follows it: a percent sign, a currency, or a unit. */
const NUMBER = new RegExp(`(-?\\d[\\d.,']*)\\s*(%|${CURRENCY}|\\p{L}[\\p{L}\\d()²³]*\\.?)?`, 'gu');
const IS_CURRENCY = new RegExp(`^${CURRENCY}$`);
/** "Seite 1 von 2", "Page 1 of 2", "1 / 2": where a page ends. Nothing below it belongs to the item above it. */
const PAGE_COUNT = /^(?:(?:seite|page|pagina|página|blatt)\s*)?\d{1,3}\s*(?:von|of|de|sur|di|\/)\s*\d{1,3}$/i;

/** A row of the table as read: `total` is its net amount, or its gross amount where prices include VAT. */
interface Item {
  name?: string;
  quantity?: number;
  unit?: string;
  unitPrice?: number;
  vatRate?: number;
  total: number;
  /** Counts the summing rows and headings above it: the items of an invoice stand in one table. */
  table: number;
  /** The cell that holds its name, as printed. */
  cell?: string;
  /** The cells of the rows between this item and the next: its description may go on in some of them. */
  below: string[];
}

/** A number in a row, with the sign or word behind it, and whether it is written like an amount of money. */
interface Figure {
  value: number;
  mark: string;
  money: boolean;
}

/**
 * One row of the table, from its cells up to the one with the row total. Which number is the quantity and which the
 * price is read from the product: the two that multiply to the total. A row may also carry net, VAT and gross.
 */
function itemOf(parts: string[], table: number): Item {
  const numbered = /^\d{1,3}\.?$/.test(parts[0]!);
  // A unit in a column of its own belongs to the quantity before it: "8   Std.".
  const before = parts.slice(numbered ? 1 : 0, -1).reduce<string[]>((joined, cell) => {
    const last = joined.at(-1);
    if (last !== undefined && /^-?\d+(?:[.,]\d+)?$/.test(last) && UNITS.some(([pattern]) => pattern.test(cell)))
      joined[joined.length - 1] = `${last} ${cell}`;
    else joined.push(cell);
    return joined;
  }, []);
  const name = before.find((cell) => !RATE_CELL.test(cell) && !MONEY_CELL.test(cell) && !QUANTITY_CELL.test(cell));
  const figures: Figure[] = before
    .filter((cell) => cell !== name && /^\(?[€$£]?\s*-?\d/.test(cell))
    .flatMap((cell) => [...cell.matchAll(NUMBER)])
    .map(([, number, mark = '']) => ({ value: toNumber(number!), mark, money: /[.,]\d{2}$/.test(number!) }))
    // A number too large to calculate with is no quantity and no price.
    .filter((figure) => !Number.isNaN(cents(figure.value)));
  const item: Item = { name, cell: name, total: toNumber(MONEY_CELL.exec(parts.at(-1)!)![1]!), table, below: [] };

  const rates = figures.filter((figure) => figure.mark === '%');
  if (rates.length === 1) item.vatRate = rates[0]!.value;
  let others = figures.filter((figure) => figure.mark !== '%');
  // "10,00 €   1,90 €   11,90 €": net, VAT and gross of the row.
  const [net, vat] = others.filter((figure) => figure.money).slice(-2);
  if (
    net &&
    vat &&
    cents(net.value) + cents(vat.value) === cents(item.total) &&
    rateOf(net.value, vat.value) !== undefined
  ) {
    item.total = net.value;
    others = others.filter((figure) => figure !== net && figure !== vat);
  }

  // Nothing but the total, or the total once more: one unit at that price.
  if (others.every((figure) => cents(figure.value) === cents(item.total)))
    return { ...item, quantity: 1, unit: 'C62', unitPrice: item.total };
  const isPrice = (figure: Figure) => IS_CURRENCY.test(figure.mark);
  const hasUnit = (figure: Figure) => figure.mark !== '' && !isPrice(figure);
  for (const [i, a] of others.entries()) {
    for (const b of others.slice(i + 1)) {
      if (cents(lineBase(a.value, b.value)) !== cents(item.total)) continue;
      // Known limit: where neither a currency nor a unit nor a whole number tells, the quantity is taken to come first.
      const swap =
        isPrice(a) ||
        hasUnit(b) ||
        (!hasUnit(a) && !isPrice(b) && !Number.isInteger(a.value) && Number.isInteger(b.value));
      const [quantity, price] = swap ? [b, a] : [a, b];
      return { ...item, quantity: quantity.value, unit: unitOf(quantity.mark), unitPrice: price.value };
    }
  }
  // No two numbers give the total, e.g. because of a discount or a rounded quantity: both stay open.
  return item;
}

/** The longest run of consecutive items of one table that adds up to the total, with the rows of nothing around it. */
function runOf(items: Item[], total: number | undefined): Item[] | undefined {
  if (total === undefined) return undefined;
  const weight = (run: Item[]) => run.filter((item) => cents(item.total) !== 0).length;
  let best: Item[] | undefined;
  for (const [i, start] of items.entries()) {
    const inTable = (item: Item | undefined): item is Item => item?.table === start.table;
    const isZero = (item: Item | undefined) => inTable(item) && cents(item.total) === 0;
    if (isZero(start)) continue;
    let sum = 0;
    for (let j = i; inTable(items[j]); j++) {
      sum += cents(items[j]!.total);
      if (sum !== cents(total)) continue;
      let [from, to] = [i, j];
      while (isZero(items[from - 1])) from--;
      while (isZero(items[to + 1])) to++;
      const run = items.slice(from, to + 1);
      if (!best || weight(run) > weight(best)) best = run;
      break;
    }
  }
  return best;
}

/** "80,00 € 960,00 €": price and total set so close that they share a cell. Each amount is a cell of its own. */
function splitAmounts(cell: string): string[] {
  const parts: string[] = [];
  for (const word of cell.split(' ')) {
    if (parts.length && MONEY_CELL.test(`${parts.at(-1)} ${word}`)) parts[parts.length - 1] += ` ${word}`;
    else parts.push(word);
  }
  return parts.length > 1 && parts.every((part) => MONEY_CELL.test(part)) ? parts : [cell];
}

/** Joins the lines a text wraps into: with a space, or without one where a hyphen holds two of them together ("Wartungs-", "Vertrag"). */
const unwrap = (lines: string[]) =>
  lines
    .slice(1)
    .reduce(
      (text, line) => (/[\p{L}\d]-$/u.test(text) || /^-\p{L}/u.test(line) ? text + line : `${text} ${line}`),
      lines[0] ?? '',
    );

/**
 * The line items: rows with a name and an amount that add up to the printed total, wherever they stand. A
 * description may wrap into the rows around it. Rows that add up to the gross total carry prices with VAT; their net
 * prices are derived from the rate. Rows that do not add up are not believed: nothing is returned and a person fills
 * the lines in.
 *
 * A table may go on over pages. Then the sum so far is often printed at the end of a page and carried over to the
 * next, and the head of the table stands there once more. Such rows end a table on a single page, so they are read
 * as part of one table only where the rows do not add up otherwise.
 */
export function readItems(rows: string[], totals: Totals, blocks: string[][] | undefined): Partial<Line>[] | undefined {
  // Without VAT the rows add up to the total itself.
  const net = totals.net ?? (totals.vat === undefined ? totals.gross : undefined);
  const itemsOf = (span: Span) => {
    const items = rowItems(rows, span);
    if (blocks) nameFromBlocks(items, blocks);
    return items;
  };
  // Read as one page first, and only where nothing adds up that way as a table that goes on over pages.
  const found = runThatAddsUp(itemsOf('page'), totals, net) ?? runThatAddsUp(itemsOf('pages'), totals, net);
  if (!found) return undefined;
  const { run, inclusive } = found;

  // A rate that the rows do not carry is the one the totals name, if they name exactly one.
  const totalRates = new Set(
    rows
      .filter((row) => TOTALS_ROW.test(row))
      .flatMap((row) => [...row.matchAll(/(\d{1,2}(?:[.,]\d+)?)\s?%/g)].map((m) => toNumber(m[1]!))),
  );
  const onlyRate = totalRates.size === 1 ? [...totalRates][0] : undefined;
  const lines = run.map((item) => ({ ...item, vatRate: item.vatRate ?? onlyRate, net: cents(item.total) }));
  if (inclusive) {
    for (const line of lines) {
      if (line.vatRate === undefined || !line.quantity) return undefined;
      line.net = cents(netOfGross(line.total, line.vatRate));
      line.unitPrice = perUnit(line.net / 100, line.quantity);
      // The printed net total has to come out to the cent, also line by line.
      if (cents(lineBase(line.quantity, line.unitPrice)) !== line.net) return undefined;
    }
    if (lines.reduce((sum, line) => sum + line.net, 0) !== cents(totals.net!)) return undefined;
  }
  // Rates are believed when they give the printed VAT: a percentage in a row may as well be a discount.
  const taxable = new Map<number | undefined, number>();
  for (const line of lines) taxable.set(line.vatRate, (taxable.get(line.vatRate) ?? 0) + line.net);
  const tax = [...taxable].reduce(
    (sum, [rate, base]) => sum + (rate === undefined ? NaN : cents(percentOf(base / 100, rate))),
    0,
  );
  const rated = totals.vat === undefined || Math.abs(tax - cents(totals.vat)) <= taxable.size;
  return lines.map((line) => ({
    name: line.name || undefined,
    quantity: line.quantity,
    unit: line.unit,
    unitPrice: line.unitPrice,
    vatCategory: 'S' as VatCategory,
    vatRate: rated ? line.vatRate : undefined,
  }));
}

/**
 * How far a table goes: over one page, where a sum of the items so far and a table head printed once more end it, or
 * over several, where they do not.
 */
type Span = 'page' | 'pages';

/** Every row with a name and an amount, in the order of the page, with the rows its description wraps into. */
function rowItems(rows: string[], span: Span): Item[] {
  const items: Item[] = [];
  /** Rows of text between items: the end of the description above, or the start of the one below. */
  let loose: string[] = [];
  let table = 0;
  /** The last item, while it may still take the rows that follow it. */
  let open: Item | undefined;
  const heads = new Set<string>();
  const closeLoose = () => {
    if (open && loose.length <= MAX_WRAPPED)
      open.name = unwrap([open.name, ...loose].filter((part): part is string => Boolean(part)));
    loose = [];
  };
  for (const row of rows) {
    const all = cells(row).flatMap(splitAmounts);
    // A row may end with a cell of the column beside the table.
    const parts = all.slice(0, lastIndex(all, (cell) => MONEY_CELL.test(cell)) + 1);
    if (TOTALS_ROW.test(row) || all.some((cell) => TOTALS_CELL.test(cell))) {
      closeLoose();
      open = undefined;
      // The sum of the items so far, printed at a page break: a subtotal below them, a carry-over above the next ones.
      const amount = MONEY_CELL.exec(all.at(-1)!)?.[1];
      const soFar = items.filter((item) => item.table === table).reduce((sum, item) => sum + cents(item.total), 0);
      const carried = span === 'pages' && amount !== undefined && soFar !== 0 && cents(toNumber(amount)) === soFar;
      if (!carried) table++;
    } else if (parts.length >= 2) {
      const item = itemOf(parts, table);
      // A row with only number and amount takes its description from the text above it; other text above belongs to the previous item.
      if (item.name === undefined && parts.length === 2) item.name = unwrap(loose.splice(0).slice(-MAX_WRAPPED));
      closeLoose();
      items.push(item);
      open = item;
    } else {
      items.at(-1)?.below.push(...all);
      if (PAGE_COUNT.test(row)) {
        closeLoose();
        open = undefined;
      } else if (all.length === 1 && !/:/.test(row)) loose.push(all[0]!);
      else {
        // Another row ends the description above it, and a row of headings starts another table.
        loose = [];
        open = undefined;
        if (all.length >= 3 && !/\d/.test(row)) {
          if (!(span === 'pages' && heads.has(row))) table++;
          heads.add(row);
        }
      }
    }
  }
  closeLoose();
  return items;
}

/**
 * Beside a description that wraps, other columns go on, and the rows mix them. Its block has it alone: the lines below
 * its first one, as far as they stand in the rows of this item. Sets the name of each item whose block is known.
 */
function nameFromBlocks(items: Item[], blocks: string[][]): void {
  const seen = new Map<string, number>();
  for (const item of items) {
    if (item.cell === undefined) continue;
    // The same text may name several items: they stand in the blocks in the order of the rows.
    const nth = seen.get(item.cell) ?? 0;
    seen.set(item.cell, nth + 1);
    const place = blocks.flatMap((block) => block.flatMap((line, i) => (line === item.cell ? [{ block, i }] : [])))[
      nth
    ];
    const more: string[] = [];
    for (
      let k = (place?.i ?? 0) + 1;
      place && more.length < MAX_WRAPPED && item.below.includes(place.block[k]!) && !KEY_VALUE.test(place.block[k]!);
      k++
    )
      more.push(place.block[k]!);
    // Where the block of the name is known, it says what the name is: text below it in another column is none of it.
    if (place) item.name = unwrap([item.cell, ...more]);
  }
}

/** The items that add up to the net total, or to the gross total where prices include VAT (`inclusive`). */
function runThatAddsUp(
  items: Item[],
  totals: Totals,
  net: number | undefined,
): { run: Item[]; inclusive: boolean } | undefined {
  const run = runOf(items, net);
  if (run) return { run, inclusive: false };
  const withVat = totals.net !== undefined ? runOf(items, totals.gross) : undefined;
  return withVat && { run: withVat, inclusive: true };
}

/** What the printed reason for charging no VAT says the sale is. The exemptions of § 4 UStG other than 1a and 1b are E. */
export const NOTE_CATEGORIES: [RegExp, VatCategory][] = [
  [
    new RegExp(
      anyOf(
        /innergemeinschaftlich\w*\s+(?:waren)?lieferung/,
        /intra-?community\s+(?:supply|delivery)/,
        /livraison\s+intracommunautaire/,
        /§\s?4\s?nr\.?\s?1\s?b\b/,
      ),
      'i',
    ),
    'K',
  ],
  [/ausfuhr\w*|\bexport(?:s|ed)?\b|exportation|§\s?4\s?nr\.?\s?1\s?a\b/i, 'G'],
  [/steuerschuldnerschaft|reverse[- ]charge|autoliquidation|§\s?13b/i, 'AE'],
  [/kleinunternehmer|§\s?19\b|§\s?4\s?nr\.?\s?\d/i, 'E'],
  [/nicht\s+steuerbar|not\s+(?:taxable|subject\s+to)|non\s+soumis/i, 'O'],
];

/** A row that speaks of VAT: a word for it, or a paragraph of the UStG. */
const VAT_NOTE = new RegExp(
  `\\b(${[
    'vat',
    'umsatzsteuer',
    'mehrwertsteuer',
    'steuerschuld\\w*',
    'reverse[- ]charge',
    'steuerfrei\\w*',
    'steuerbefreit\\w*',
    'nicht steuerbar',
  ].join('|')})\\b|§\\s?\\d+\\w*\\s.*ustg`,
  'i',
);

/** The printed sentence that says why no VAT is charged, joined over the rows it wraps into. */
export function readVatNote(rows: string[]): string | undefined {
  const start = rows.findIndex(
    (row) =>
      VAT_NOTE.test(row) && !TOTALS_ROW.test(row) && !cells(row).some(senderOf) && !/\b[A-Z]{2} ?\d[\d ]{7,}/.test(row),
  );
  if (start < 0) return undefined;
  const note = [rows[start]!.replace(/^\s*(note|hinweis|anmerkung)\s*:\s*/i, '')];
  // The sentence goes on while a row starts in lower case and the one before it did not end.
  for (
    let i = start + 1;
    i < rows.length && note.length <= MAX_WRAPPED && !/[.!?]$/.test(note.at(-1)!) && /^[\p{Ll}\d§(]/u.test(rows[i]!);
    i++
  )
    note.push(rows[i]!);
  return note.join(' ').replace(/\s+/g, ' ').trim();
}
