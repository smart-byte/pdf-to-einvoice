import { cents, lineBase, netOfGross, percentOf, perUnit } from '../../domain/money.js';
import type { Line, VatCategory } from '../../domain/model.js';
import { toNumber } from '../../domain/spellings.js';
import { senderOf } from './parties.js';
import { cells } from '../../util/rows.js';
import { KEY_VALUE, MAX_WRAPPED } from './rows.js';
import { rateOf, type ReadTotals, TOTALS_CELL, TOTALS_ROW } from './totals.js';
import { anyOf, CURRENCY, lastIndex, MONEY } from './values.js';

// Items: the rows of the table that add up to the totals, with quantity, unit, price and VAT rate, and the note that
// says why no VAT is charged.

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
export function readItems(
  rows: string[],
  totals: ReadTotals,
  blocks: string[][] | undefined,
): Partial<Line>[] | undefined {
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
  // A rate that the rows do not carry is the one the totals name, if they name exactly one.
  const onlyRate = rateOfTotals(rows);
  const lines = found.run.map((item) => ({ ...item, vatRate: item.vatRate ?? onlyRate, net: cents(item.total) }));
  if (found.inclusive && !toNet(lines, totals.net!)) return undefined;
  const rated = ratesGiveVat(lines, totals.vat);
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

/** What reading the rows has found so far. */
interface Reading {
  items: Item[];
  /** Rows of text between items: the end of the description above, or the start of the one below. */
  loose: string[];
  table: number;
  /** The last item, while it may still take the rows that follow it. */
  open?: Item;
  /** The rows of headings seen so far. */
  heads: Set<string>;
}

/** Every row with a name and an amount, in the order of the page, with the rows its description wraps into. */
function rowItems(rows: string[], span: Span): Item[] {
  const reading: Reading = { items: [], loose: [], table: 0, heads: new Set() };
  for (const row of rows) {
    const all = cells(row).flatMap(splitAmounts);
    // A row may end with a cell of the column beside the table.
    const parts = all.slice(0, lastIndex(all, (cell) => MONEY_CELL.test(cell)) + 1);
    if (TOTALS_ROW.test(row) || all.some((cell) => TOTALS_CELL.test(cell))) totalsRow(reading, all, span);
    else if (parts.length >= 2) itemRow(reading, parts);
    else otherRow(reading, row, all, span);
  }
  closeLoose(reading);
  return reading.items;
}

/** A row of totals ends the items above it, and the table, unless it carries the sum so far over a page break. */
function totalsRow(reading: Reading, all: string[], span: Span): void {
  closeLoose(reading);
  reading.open = undefined;
  // The sum of the items so far, printed at a page break: a subtotal below them, a carry-over above the next ones.
  const amount = MONEY_CELL.exec(all.at(-1)!)?.[1];
  const soFar = reading.items
    .filter((item) => item.table === reading.table)
    .reduce((sum, item) => sum + cents(item.total), 0);
  const carried = span === 'pages' && amount !== undefined && soFar !== 0 && cents(toNumber(amount)) === soFar;
  if (!carried) reading.table++;
}

/** A row with a name and an amount is an item. */
function itemRow(reading: Reading, parts: string[]): void {
  const item = itemOf(parts, reading.table);
  // A row with only number and amount takes its description from the text above it; other text above belongs to the previous item.
  if (item.name === undefined && parts.length === 2) item.name = unwrap(reading.loose.splice(0).slice(-MAX_WRAPPED));
  closeLoose(reading);
  reading.items.push(item);
  reading.open = item;
}

/** Any other row: text that may go on a description, the count of a page, or a row that ends the description above. */
function otherRow(reading: Reading, row: string, all: string[], span: Span): void {
  reading.items.at(-1)?.below.push(...all);
  if (PAGE_COUNT.test(row)) {
    closeLoose(reading);
    reading.open = undefined;
    return;
  }
  if (all.length === 1 && !/:/.test(row)) {
    reading.loose.push(all[0]!);
    return;
  }
  // Another row ends the description above it, and a row of headings starts another table.
  reading.loose = [];
  reading.open = undefined;
  if (all.length >= 3 && !/\d/.test(row)) noteHeadings(reading, row, span);
}

/** A row of headings starts another table, but not where a table that goes on over pages repeats them. */
function noteHeadings(reading: Reading, row: string, span: Span): void {
  if (!(span === 'pages' && reading.heads.has(row))) reading.table++;
  reading.heads.add(row);
}

/** The loose rows go on the description of the open item, where they are few enough. */
function closeLoose(reading: Reading): void {
  if (reading.open && reading.loose.length <= MAX_WRAPPED)
    reading.open.name = unwrap([reading.open.name, ...reading.loose].filter((part): part is string => Boolean(part)));
  reading.loose = [];
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
  const before = withUnits(parts.slice(numbered ? 1 : 0, -1));
  const name = before.find(isNameCell);
  const figures = figuresIn(before.filter((cell) => cell !== name && /^\(?[€$£]?\s*-?\d/.test(cell)));
  const rates = figures.filter((figure) => figure.mark === '%');
  const others = figures.filter((figure) => figure.mark !== '%');
  const printed = toNumber(MONEY_CELL.exec(parts.at(-1)!)![1]!);
  // "10,00 €   1,90 €   11,90 €": net, VAT and gross of the row.
  const taxed = netAndVatOf(others, printed);
  const total = taxed ? taxed.net.value : printed;
  const item: Item = {
    name,
    cell: name,
    total,
    table,
    below: [],
    ...(rates.length === 1 ? { vatRate: rates[0]!.value } : {}),
  };
  const rest = taxed ? others.filter((figure) => figure !== taxed.net && figure !== taxed.vat) : others;
  return { ...item, ...quantityAndPrice(rest, total) };
}

/** A cell that is no rate, no amount and no quantity. */
function isNameCell(cell: string): boolean {
  return !RATE_CELL.test(cell) && !MONEY_CELL.test(cell) && !QUANTITY_CELL.test(cell);
}

/** The last two amounts of a row as its net and VAT, where they add up to its total at a rate there is. */
function netAndVatOf(figures: Figure[], total: number): { net: Figure; vat: Figure } | undefined {
  const [net, vat] = figures.filter((figure) => figure.money).slice(-2);
  if (!net || !vat) return undefined;
  const addsUp = cents(net.value) + cents(vat.value) === cents(total);
  return addsUp && rateOf(net.value, vat.value) !== undefined ? { net, vat } : undefined;
}

/** A unit in a column of its own belongs to the quantity before it: "8   Std.". */
function withUnits(row: string[]): string[] {
  return row.reduce<string[]>((joined, cell) => {
    const last = joined.at(-1);
    if (isUnitOf(last, cell)) joined[joined.length - 1] = `${last} ${cell}`;
    else joined.push(cell);
    return joined;
  }, []);
}

/** Whether `cell` is a unit and `last`, the cell before it, a number. */
function isUnitOf(last: string | undefined, cell: string): boolean {
  return last !== undefined && /^-?\d+(?:[.,]\d+)?$/.test(last) && UNITS.some(([pattern]) => pattern.test(cell));
}

/** The numbers of cells, each with the sign or word behind it. */
function figuresIn(numbers: string[]): Figure[] {
  return (
    numbers
      .flatMap((cell) => [...cell.matchAll(NUMBER)])
      .map(([, number, mark = '']) => ({ value: toNumber(number!), mark, money: /[.,]\d{2}$/.test(number!) }))
      // A number too large to calculate with is no quantity and no price.
      .filter((figure) => !Number.isNaN(cents(figure.value)))
  );
}

/** The two figures that multiply to the total, as quantity and unit price. */
function quantityAndPrice(figures: Figure[], total: number): Pick<Item, 'quantity' | 'unit' | 'unitPrice'> {
  // Nothing but the total, or the total once more: one unit at that price.
  if (figures.every((figure) => cents(figure.value) === cents(total)))
    return { quantity: 1, unit: 'C62', unitPrice: total };
  const factors = factorsOf(figures, total);
  // No two numbers give the total, e.g. because of a discount or a rounded quantity: both stay open.
  if (!factors) return {};
  const [quantity, price] = inOrder(...factors);
  return { quantity: quantity.value, unit: unitOf(quantity.mark), unitPrice: price.value };
}

/** The first two figures that multiply to the total. */
function factorsOf(figures: Figure[], total: number): [Figure, Figure] | undefined {
  for (const [i, a] of figures.entries()) {
    const b = figures.slice(i + 1).find((other) => cents(lineBase(a.value, other.value)) === cents(total));
    if (b) return [a, b];
  }
  return undefined;
}

/** Two factors as quantity and price: a currency marks the price, a unit the quantity, or else a whole number. */
function inOrder(a: Figure, b: Figure): [quantity: Figure, price: Figure] {
  if (isPrice(a) || hasUnit(b)) return [b, a];
  if (hasUnit(a) || isPrice(b)) return [a, b];
  // Known limit: where neither a currency nor a unit nor a whole number tells, the quantity is taken to come first.
  return !Number.isInteger(a.value) && Number.isInteger(b.value) ? [b, a] : [a, b];
}

function isPrice(figure: Figure): boolean {
  return IS_CURRENCY.test(figure.mark);
}

function hasUnit(figure: Figure): boolean {
  return figure.mark !== '' && !isPrice(figure);
}

/** The code of a printed unit. A quantity without one counts pieces; a unit not listed here stays open. */
function unitOf(mark: string): string | undefined {
  return mark === '' ? 'C62' : UNITS.find(([pattern]) => pattern.test(mark))?.[1];
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
function unwrap(lines: string[]): string {
  return lines
    .slice(1)
    .reduce(
      (text, line) => (/[\p{L}\d]-$/u.test(text) || /^-\p{L}/u.test(line) ? text + line : `${text} ${line}`),
      lines[0] ?? '',
    );
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
    const place = placesOf(item.cell, blocks)[nth];
    // Where the block of the name is known, it says what the name is: text below it in another column is none of it.
    if (place) item.name = unwrap([item.cell, ...linesBelow(item, place)]);
  }
}

/** The lines of a block below the first one of a name, as far as they stand in the rows of its item. */
function linesBelow(item: Item, { block, i }: { block: string[]; i: number }): string[] {
  const more: string[] = [];
  for (let k = i + 1; more.length < MAX_WRAPPED; k++) {
    const line = block[k]!;
    if (!item.below.includes(line) || KEY_VALUE.test(line)) break;
    more.push(line);
  }
  return more;
}

/** Every line of the blocks that is `cell`, with its block. */
function placesOf(cell: string, blocks: string[][]): { block: string[]; i: number }[] {
  return blocks.flatMap((block) => block.flatMap((line, i) => (line === cell ? [{ block, i }] : [])));
}

/** The items that add up to the net total, or to the gross total where prices include VAT (`inclusive`). */
function runThatAddsUp(
  items: Item[],
  totals: ReadTotals,
  net: number | undefined,
): { run: Item[]; inclusive: boolean } | undefined {
  const run = runOf(items, net);
  if (run) return { run, inclusive: false };
  const withVat = totals.net !== undefined ? runOf(items, totals.gross) : undefined;
  return withVat && { run: withVat, inclusive: true };
}

/** The longest run of consecutive items of one table that adds up to the total, with the rows of nothing around it. */
function runOf(items: Item[], total: number | undefined): Item[] | undefined {
  if (total === undefined) return undefined;
  let best: Item[] | undefined;
  for (const i of items.keys()) {
    const run = runFrom(items, i, cents(total));
    if (run && outweighs(run, best)) best = run;
  }
  return best;
}

/**
 * The run that starts at item `i` and, within its table, first adds up to `total` cents, with the rows of nothing
 * around it; none where item `i` is one of nothing itself.
 */
function runFrom(items: Item[], i: number, total: number): Item[] | undefined {
  const table = items[i]!.table;
  const inTable = (item: Item | undefined): item is Item => item?.table === table;
  const isZero = (item: Item | undefined) => inTable(item) && cents(item.total) === 0;
  if (isZero(items[i])) return undefined;
  let sum = 0;
  for (let j = i; inTable(items[j]); j++) {
    sum += cents(items[j]!.total);
    if (sum === total) return withZerosAround(items, [i, j], isZero);
  }
  return undefined;
}

/** Items `first` to `last`, with the rows of nothing right before and after them. */
function withZerosAround(items: Item[], [first, last]: [number, number], isZero: (item?: Item) => boolean): Item[] {
  let [from, to] = [first, last];
  while (isZero(items[from - 1])) from--;
  while (isZero(items[to + 1])) to++;
  return items.slice(from, to + 1);
}

/** Whether a run counts more items that are not nothing than the best so far. */
function outweighs(run: Item[], best: Item[] | undefined): boolean {
  return !best || weight(run) > weight(best);
}

function weight(run: Item[]): number {
  return run.filter((item) => cents(item.total) !== 0).length;
}

/** The rate the totals name, if they name exactly one. */
function rateOfTotals(rows: string[]): number | undefined {
  const rates = new Set(
    rows
      .filter((row) => TOTALS_ROW.test(row))
      .flatMap((row) => [...row.matchAll(/(\d{1,2}(?:[.,]\d+)?)\s?%/g)].map((m) => toNumber(m[1]!))),
  );
  return rates.size === 1 ? [...rates][0] : undefined;
}

/** An item with its amount in cents: the net amount, once VAT is taken off where prices include it. */
type Counted = Item & { net: number };

/**
 * Takes the VAT off lines whose prices include it, by their rates. False where a line has no rate or no quantity, or
 * where the net amounts do not come out to the printed net total, also line by line, to the cent.
 */
function toNet(lines: Counted[], net: number): boolean {
  for (const line of lines) {
    if (line.vatRate === undefined || !line.quantity) return false;
    line.net = cents(netOfGross(line.total, line.vatRate));
    line.unitPrice = perUnit(line.net / 100, line.quantity);
    if (cents(lineBase(line.quantity, line.unitPrice)) !== line.net) return false;
  }
  return lines.reduce((sum, line) => sum + line.net, 0) === cents(net);
}

/** Rates are believed when they give the printed VAT: a percentage in a row may as well be a discount. */
function ratesGiveVat(lines: Counted[], vat: number | undefined): boolean {
  const taxable = new Map<number | undefined, number>();
  for (const line of lines) taxable.set(line.vatRate, (taxable.get(line.vatRate) ?? 0) + line.net);
  const tax = [...taxable].reduce(
    (sum, [rate, base]) => sum + (rate === undefined ? NaN : cents(percentOf(base / 100, rate))),
    0,
  );
  return vat === undefined || Math.abs(tax - cents(vat)) <= taxable.size;
}

/** The printed sentence that says why no VAT is charged, joined over the rows it wraps into. */
export function readVatNote(rows: string[]): string | undefined {
  const start = rows.findIndex(isVatNote);
  if (start < 0) return undefined;
  const note = [rows[start]!.replace(/^\s*(note|hinweis|anmerkung)\s*:\s*/i, '')];
  // The sentence goes on while a row starts in lower case and the one before it did not end.
  for (let i = start + 1; i < rows.length && note.length <= MAX_WRAPPED; i++) {
    if (/[.!?]$/.test(note.at(-1)!) || !/^[\p{Ll}\d§(]/u.test(rows[i]!)) break;
    note.push(rows[i]!);
  }
  return note.join(' ').replace(/\s+/g, ' ').trim();
}

/** A row that speaks of VAT, and is no row of totals, no sender line and holds no VAT ID. */
function isVatNote(row: string): boolean {
  return (
    VAT_NOTE.test(row) && !TOTALS_ROW.test(row) && !cells(row).some(senderOf) && !/\b[A-Z]{2} ?\d[\d ]{7,}/.test(row)
  );
}

// What the page is searched for. The functions above use these only when a page is read, so they may stand below
// them; `NOTE_CATEGORIES` is used by the reader of the whole invoice as well.

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

const MONEY_CELL = new RegExp(`^[€$£]?\\s*${MONEY}\\s*${CURRENCY}?$`);
const RATE_CELL = /^\(?(\d{1,2}(?:[.,]\d+)?)\s?%\)?$/;
const QUANTITY_CELL = /^(-?\d+(?:[.,]\d+)?)\s*(\p{L}+\.?)?$/u;
/** A number with what follows it: a percent sign, a currency, or a unit. */
const NUMBER = new RegExp(`(-?\\d[\\d.,']*)\\s*(%|${CURRENCY}|\\p{L}[\\p{L}\\d()²³]*\\.?)?`, 'gu');
const IS_CURRENCY = new RegExp(`^${CURRENCY}$`);
/** "Seite 1 von 2", "Page 1 of 2", "1 / 2": where a page ends. Nothing below it belongs to the item above it. */
const PAGE_COUNT = /^(?:(?:seite|page|pagina|página|blatt)\s*)?\d{1,3}\s*(?:von|of|de|sur|di|\/)\s*\d{1,3}$/i;

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
