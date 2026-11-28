import { lastDayOfMonth } from '../../domain/formats.js';
import type { InvoiceType } from '../../domain/model.js';
import { twoDigits } from '../../util/numbers.js';
import { escapeRegExp } from '../../util/regexp.js';
import { cells } from '../../util/rows.js';
import { KEY_VALUE, MAX_WRAPPED } from './rows.js';
import { after, anyOf, DATE, monthAs, monthNumber, SEPARATOR, toIsoDate } from './values.js';

// The head of the invoice: its number and type, its dates, the service period, the payment terms and the reference
// of the buyer.

/**
 * The invoice number: after its label, or straight after the word "Rechnung" / "Invoice". Also the date that the
 * same sentence gives ("Nr. 4711 vom 21.10.2026"), and the date beside the title.
 */
export function readNumber(searched: string, rows: string[]): { number?: string; dated?: string; beside?: string } {
  const [labelled] = after(searched, NUMBER_LABEL, NUMBER);
  const titles = rows.map(cells).filter((parts) => parts.some((cell) => TITLE.test(cell) || NAMED.test(cell)));
  return {
    number:
      labelled?.hit[1]!.replace(/ /g, '') ??
      titles.flatMap((parts) => parts.map((cell) => NAMED.exec(cell)?.[2])).find(Boolean),
    dated: labelled && isoDate(datedAfter(searched, labelled.hit[1]!)),
    beside: titles.flatMap((parts) => parts.map((cell) => isoDate(DATE.exec(cell)))).find(Boolean),
  };
}

/** The date the sentence of the invoice number gives right after it: "4711 vom 21.10.2026". */
function datedAfter(searched: string, number: string): RegExpExecArray | undefined {
  const dated = new RegExp(`${escapeRegExp(number)}\\s+(?:vom|von|issued\\s+(?:at|on)|dated|du|of)`);
  return after(searched, dated, DATE)[0]?.hit;
}

/** The date a match of `DATE` holds, read with the month first where it is written with slashes. */
function isoDate(hit: RegExpExecArray | null | undefined): string | undefined {
  return hit ? toIsoDate(hit, false) : undefined;
}

/** The kind of invoice the title names: the first cell that is a title, alone or with the number. */
export function readType(rows: string[]): InvoiceType | undefined {
  const title = rows
    .flatMap(cells)
    .map((cell) => (TITLE.exec(cell)?.index === 0 ? cell : NAMED.exec(cell)?.[1]))
    .find(Boolean);
  return title ? TYPES.find(([pattern]) => pattern.test(title))?.[1] : undefined;
}

/** The reference of the buyer after its label, as it is printed: a Leitweg-ID by its shape, another reference as it stands. */
export function readBuyerReference(searched: string): string | undefined {
  const found = [
    ...after(searched, LEITWEG_LABEL, LEITWEG),
    // A value that ends with a colon is the next label, in a column of labels.
    ...after(searched, REFERENCE_LABEL, REST_OF_CELL).filter(({ hit }) => !hit[1]!.endsWith(':')),
  ].map(({ hit }) => hit[1]!);
  return new Set(found.map((value) => value.replace(/\s/g, ''))).size === 1 ? found[0] : undefined;
}

/** The first and the last day of a service period. */
type Period = { periodStart: string; periodEnd: string };

/**
 * A service period given as a quarter ("Q2 2026"), a month ("Oktober 2026", "10/2026") or two dates, after its
 * label, as a row that holds nothing but a month, or as the month the title names ("Ihre Rechnung", below it "für
 * September 2026"). German VAT law accepts the calendar month as the date of supply (§ 31 (4) UStDV); the XML needs
 * its first and last day.
 */
export function readPeriod(text: string, rows: string[]): { periodStart?: string; periodEnd?: string } {
  // "September 2026 bis Januar 2027": from the first day of the one month to the last day of the other.
  for (const { hit } of after(text, PERIOD_LABEL, MONTH_RANGE)) {
    const period = monthRangeOf(hit.groups ?? {});
    if (period) return period;
  }
  for (const { hit } of after(text, PERIOD_LABEL, PERIOD)) {
    const period = periodOf(hit.groups ?? {});
    if (period) return period;
  }
  return namedMonth(rows) ?? {};
}

/** The months a match of `MONTH_RANGE` names: from the first day of the one to the last day of the other. */
function monthRangeOf(groups: Groups): Period | undefined {
  const range = allOf(groups, ['fromYear', 'fromMonth', 'toYear', 'toMonth']);
  if (!range) return undefined;
  const [fromYear, fromMonth, toYear, toMonth] = range;
  const from = month(fromYear, monthNumber(fromMonth));
  const to = month(toYear, monthNumber(toMonth));
  return from && to && from.periodStart < to.periodEnd
    ? { periodStart: from.periodStart, periodEnd: to.periodEnd }
    : undefined;
}

/** The period one alternative of `PERIOD` matched: a quarter, two dates, a month by its name or by its number. */
function periodOf(groups: Groups): Period | undefined {
  const quarter = Number(groups.quarter ?? groups.quartal);
  const quarterYear = groups.quarterYear ?? groups.quartalYear;
  if (quarter && quarterYear) return months(quarterYear, quarter * 3 - 2, quarter * 3);
  const days = allOf(groups, ['fromDay', 'fromMonth', 'toDay', 'toMonth']);
  if (days) return daysOf(groups, days);
  const named = allOf(groups, ['month', 'monthYear']);
  if (named) return month(named[1], monthNumber(named[0]));
  const numbered = allOf(groups, ['numberedMonth', 'numberedYear']);
  if (numbered) return month(numbered[1], Number(numbered[0]));
  return groups.isoYear ? month(groups.isoYear, Number(groups.isoMonth)) : undefined;
}

/** From one date to another; the years as they were matched. */
function daysOf(
  groups: Groups,
  [fromDay, fromMonth, toDay, toMonth]: readonly [string, string, string, string],
): Period {
  return {
    periodStart: `${groups.fromYear}-${twoDigits(fromMonth)}-${twoDigits(fromDay)}`,
    periodEnd: `${groups.toYear}-${twoDigits(toMonth)}-${twoDigits(toDay)}`,
  };
}

/** The named groups of a match. */
type Groups = Record<string, string | undefined>;

/** The values of the groups `names`, in their order, where every one of them matched something. */
function allOf<const N extends readonly string[]>(groups: Groups, names: N): { [K in keyof N]: string } | undefined {
  const values = names.map((name) => groups[name]);
  return values.every(Boolean) ? (values as { [K in keyof N]: string }) : undefined;
}

/** A row that holds nothing but a month, or the month the title names in its own row or the next. */
function namedMonth(rows: string[]): Period | undefined {
  const titled = rows.findIndex((row) => cells(row).some((cell) => TITLE.test(cell)));
  const named =
    rows.map((row) => MONTH_ROW.exec(row.trim())).find(Boolean) ??
    (titled < 0 ? null : MONTH_NAMED.exec(`${rows[titled]}\n${rows[titled + 1] ?? ''}`));
  const { month: name, year } = named?.groups ?? {};
  return name && year ? month(year, monthNumber(name)) : undefined;
}

/** One month of a year, from its first day to its last; none for a month that is no month. */
function month(year: string, number: number): Period | undefined {
  return months(year, number, number);
}

/** From the first day of the month `from` to the last day of the month `to` of one year; none for a month that is no month. */
function months(year: string, from: number, to: number): Period | undefined {
  if (from < 1 || to > 12) return undefined;
  return {
    periodStart: `${year}-${twoDigits(from)}-01`,
    periodEnd: `${year}-${twoDigits(to)}-${lastDayOfMonth(Number(year), to)}`,
  };
}

/**
 * The payment terms as printed: what stands after their label, or the sentence that says when to pay, joined over
 * the rows it wraps into. They are taken over word for word; when the due date is, is read separately.
 */
export function readPaymentTerms(rows: string[]): string | undefined {
  for (const i of rows.keys()) {
    const terms = termsIn(rows, i);
    if (terms !== undefined) return terms;
  }
  return undefined;
}

/** The payment terms in row `i`: after their label, or as a sentence that starts like them. */
function termsIn(rows: string[], i: number): string | undefined {
  const all = cells(rows[i]!);
  for (const [k, cell] of all.entries()) {
    // "Payment terms   Net 30": the label in one cell, the terms in the next.
    const labelled = TERMS_LABEL.test(cell) ? cell.replace(TERMS_LABEL, '') || all[k + 1] : undefined;
    if (labelled) return labelled;
    // Alone in its row, the sentence may go on into the rows below.
    if (TERMS_START.test(cell)) return all.length === 1 ? wrapped(rows, i, cell) : cell;
  }
  return undefined;
}

/**
 * The sentence `first` that stands alone in row `i`, joined with the rows it goes on into while it has not ended:
 * where the next row starts in lower case, or where this one stops in the middle ("… netto bis 04.12.2026, 3%").
 */
function wrapped(rows: string[], i: number, first: string): string {
  const terms = [first];
  for (let j = i + 1; j < rows.length && terms.length <= MAX_WRAPPED; j++) {
    const next = rows[j]!;
    if (!goesOnInto(terms.at(-1)!, next)) break;
    terms.push(next);
  }
  return terms.join(' ');
}

/** Whether the sentence goes on from `last` into the row `next`: not past its end, and not into a row of its own. */
function goesOnInto(last: string, next: string): boolean {
  if (/[.!?]$/.test(last) || isRowOfItsOwn(next)) return false;
  return /^\p{Ll}/u.test(next) || /[,;%]$/.test(last);
}

/** A row with cells, with a label and its value, or with a label alone. */
function isRowOfItsOwn(row: string): boolean {
  return cells(row).length > 1 || KEY_VALUE.test(row) || row.endsWith(':');
}

// What the page is searched for. The functions above use these patterns only when a page is read, so they may stand
// below them; `TITLE` is used by the other readers as well.

/** The words that title an invoice, also as the end of a longer one ("Teilrechnung"). */
const TITLE_WORD = [
  '\\p{L}*rechnung',
  'rechnungskorrektur',
  'gutschrift',
  '(?:partial|prepayment|advance|corrected)\\s+invoice',
  'invoice',
  'facture',
  'avoir',
  'credit\\s+note',
].join('|');
/** The title of the document, alone or at the end of a cell ("Ihre Rechnung"). */
export const TITLE = new RegExp(`(?:^|\\s)(?:${TITLE_WORD})$`, 'iu');
/** The title with its number: "Rechnung 2301". */
const NAMED = new RegExp(`^(${TITLE_WORD})[ \\t]+([A-Z]{0,3}[-/]?\\d{2,}[\\w/-]*)$`, 'iu');
/** The kinds of invoice a title names. A "Gutschrift" may be a credit note or an invoice the buyer issued, and stays open. */
const TYPES: [RegExp, InvoiceType][] = [
  [/^(?:teilrechnung|partial\s+invoice)$/i, '326'],
  [/^(?:(?:abschlags|anzahlungs|vorauszahlungs)rechnung|(?:prepayment|advance)\s+invoice)$/i, '386'],
  [/^(?:(?:storno|korrektur)rechnung|rechnungskorrektur|corrected\s+invoice)$/i, '384'],
  [/^(?:credit\s+note|avoir)$/i, '381'],
];

const NUMBER_LABEL = new RegExp(
  [
    'rechnungs?-?\\s?(?:nummer|nr\\.?)',
    'invoice\\s*(?:number|no\\.?|#)',
    'facture\\s*(?:n°|no\\.?|numéro)',
    '(?:n°|numéro)\\s*(?:de\\s+)?facture',
    // A bare "Nr.:" counts only at the start of a cell: "IBAN Nr.: DE02 …" is not an invoice number.
    '(?<=^|\\n|\\s{3})(?:nr|no)\\.?\\s*:',
    // "Rechnungskorrektur Nr. …", "Gutschrift (…) Nr. …": the title of the document, then its number. A title that
    // goes on to name another document ("Rechnung zu Bestellung Nr. …") would give that one's number.
    '(?<=^|\\n)[a-zäöüß]*(?:rechnung|gutschrift|invoice|facture|avoir)' +
      '(?:(?!bestell|auftrag|order|liefer|angebot|vertrag|kunde|customer)[^\\n\\d])*?' +
      '\\s(?:nr\\.?|no\\.?|n°|#|nummer|number)(?=[\\s:])',
  ].join('|'),
);
/** Digits in groups ("100 200 300") are one number. */
const NUMBER = new RegExp(`${SEPARATOR}(\\d{2,4}(?: \\d{2,4})+(?=\\s{3}|$)|[A-Za-z0-9][\\w/.-]*\\d[\\w/-]*)`);

const LEITWEG_LABEL = /leitweg\w*[-\s]?(?:id|nr\.?|nummer)/;
/** Coarse address, fine address and check digits, as a Leitweg-ID is built. */
const LEITWEG = new RegExp(`${SEPARATOR}(\\d{2,12}(?:-[A-Za-z0-9]{1,30})?-\\d{2})(?![\\w-])`);
/** What EN 16931 calls the field (BT-10). "Ihr Zeichen" or "Your reference" may be anything, often the number of an order. */
const REFERENCE_LABEL =
  /referenz\s+des\s+käufers|käuferreferenz(?:-?\s?(?:nr\.?|nummer))?|buyer(?:['’]?s)?\s+reference/;
/** What stands in the cell after a label: three spaces start the next column. */
const REST_OF_CELL = new RegExp(`${SEPARATOR}(\\S+(?: {1,2}\\S+)*)`);

const PERIOD_LABEL = new RegExp(
  anyOf(
    /(?:leistungs|abrechnungs|liefer)?zeitraum/,
    /leistungsmonat/,
    /leistungsdatum/,
    /lieferdatum/,
    /(?:service|billing|delivery)\s+(?:period|month)/,
    /period/,
  ),
);
const PERIOD = new RegExp(
  `${SEPARATOR}(?:${[
    // A quarter: "Q3 2026", "3. Quartal 2026".
    'Q(?<quarter>[1-4])[ /]?(?<quarterYear>\\d{4})',
    '(?<quartal>[1-4])\\.\\s?Quartal\\s+(?<quartalYear>\\d{4})',
    // Two dates: "01.10.2026 - 31.10.2026".
    `${dotted('from')}\\s*(?:-|–|bis|to)\\s*${dotted('to')}`,
    // A month: "Oktober 2026", "10/2026", "2026-10".
    `${monthAs('month')}\\s+(?<monthYear>\\d{4})`,
    '(?<numberedMonth>\\d{1,2})[./-](?<numberedYear>\\d{4})(?!\\d)',
    '(?<isoYear>\\d{4})-(?<isoMonth>\\d{2})(?![-\\d])',
  ].join('|')})`,
  'i',
);
/**
 * A date written with dots, "01.10.2026", its parts in the groups `${end}Day`, `${end}Month` and `${end}Year`. `PERIOD`
 * is built with it when the module loads; it is a function declaration, so it may stand below.
 */
function dotted(end: 'from' | 'to'): string {
  return `(?<${end}Day>\\d{1,2})\\.(?<${end}Month>\\d{1,2})\\.(?<${end}Year>\\d{4})`;
}
const UNTIL = '(?:-|–|bis|to|until)';
const MONTH_RANGE = new RegExp(
  `${SEPARATOR}${monthAs('fromMonth')}\\s+(?<fromYear>\\d{4})\\s*${UNTIL}\\s*${monthAs('toMonth')}\\s+(?<toYear>\\d{4})`,
  'i',
);
const MONTH_ROW = new RegExp(`^${monthAs('month')}\\s+(?<year>\\d{4})$`, 'i');
/** "im September 2026", "für Oktober 2026", "for March 2026". */
const MONTH_NAMED = new RegExp(`\\b(?:im|für|for|in)\\s+${monthAs('month')}\\s+(?<year>\\d{4})\\b`, 'i');

/** The label of payment terms: what follows it is the terms, whatever words they use. */
const TERMS_LABEL = new RegExp(
  `^(?:${anyOf(
    /zahlungs(?:bedingung(?:en)?|ziel|frist|konditionen)/,
    /payment\s+terms?/,
    /terms\s+of\s+payment/,
    /conditions\s+de\s+(?:paiement|règlement)/,
  )})\\s*:?\\s*`,
  'i',
);
/** How a sentence starts that says when to pay. "Zahlbetrag" and "Zahlungsart" say something else. */
const TERMS_START = new RegExp(
  `^(?:${anyOf(
    // German
    /zahlbar\b/,
    /(?:die\s+)?zahlung\s+(?:ist\s+)?(?:innerhalb|bis|sofort|ohne|erfolgt|fällig|\d)/,
    /bitte\s+(?:überweisen|zahlen|begleichen)/,
    /der\s+(?:rechnungs|gesamt)betrag\s+ist/,
    /sofort\s+(?:fällig|zahlbar)/,
    // English
    /payable\b/,
    /payment\s+(?:is\s+)?(?:due|within|upon)/,
    /please\s+(?:pay|remit|transfer)/,
    /net\s+\d+/,
    /due\s+(?:on|upon)\s+receipt/,
    // French
    /paiement\s+(?:à|sous|dans|comptant)/,
  )})`,
  'i',
);
