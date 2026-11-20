import { isIban } from '../../domain/formats.js';
import { MONTHS } from '../../domain/spellings.js';

// How values are recognised in the text: a value after its label, dates, amounts, IBANs and VAT IDs, by subject; each
// with its functions first and its patterns below them. Last, small helpers the readers share.

// A value after its label.

interface Hit {
  hit: RegExpExecArray;
  label: string;
  /** Where the label starts. */
  at: number;
}

/**
 * Applies `value` to what follows each occurrence of `label`: in the same line, or in the line below when the label
 * ends a line of one column. Below a label that ends a row of several columns stands the next row, not its value.
 */
export function after(text: string, label: RegExp, value: RegExp): Hit[] {
  const hits: Hit[] = [];
  for (const match of text.matchAll(new RegExp(label.source, 'gi'))) {
    const [rest = '', below = ''] = text.slice(match.index + match[0].length).split('\n', 2);
    const before = text.slice(text.lastIndexOf('\n', match.index) + 1, match.index);
    const hit = value.exec((/^[\s:]*$/.test(rest) && !/\s{3}/.test(before) ? below : rest).slice(0, 60));
    if (hit) hits.push({ hit, label: match[0], at: match.index });
  }
  return hits;
}

/** What may stand between a label and its value: a colon, a hash or a full stop, and spaces. */
export const SEPARATOR = '^\\s*[:#.]?\\s*';

// Dates.

/** The day a match of `DATE` names, as YYYY-MM-DD. */
export function toIsoDate(m: RegExpExecArray, dayFirst: boolean): string | undefined {
  const g = m.groups ?? {};
  if (g.isoYear) return `${g.isoYear}-${g.isoMonth}-${g.isoDay}`;
  if (g.dotDay && g.dotMonth && g.dotYear) return `${century(g.dotYear)}-${pad(g.dotMonth)}-${pad(g.dotDay)}`;
  if (g.textDay && g.textMonth) return `${g.textYear}-${pad(monthNumber(g.textMonth))}-${pad(g.textDay)}`;
  if (g.usMonth && g.usDay) return `${g.usYear}-${pad(monthNumber(g.usMonth))}-${pad(g.usDay)}`;
  if (!g.slashYear) return undefined;
  // With slashes, day and month can be told apart when one is above 12, or when a German or French label says who wrote it.
  const [a, b] = [Number(g.slashFirst), Number(g.slashSecond)];
  if (b > 12 && a <= 12) return `${century(g.slashYear)}-${pad(a)}-${pad(b)}`;
  if ((a > 12 || dayFirst) && b <= 12) return `${century(g.slashYear)}-${pad(b)}-${pad(a)}`;
  return undefined;
}

/** The number of a month whose name `monthAs` matched, 1 to 12. */
export function monthNumber(name: string): number {
  const lower = name.toLowerCase();
  return MONTHS.findIndex((names) => names.some((known) => lower.startsWith(known))) + 1;
}

/**
 * A month by any of its names in `MONTHS`, and what an invoice adds to it: "Okt.", "Sept", "Mars". The name goes into
 * the group `name`, for `monthNumber`.
 */
export function monthAs(name: string): string {
  return `(?<${name}>${MONTHS.flat().join('|')})[a-zä]*\\.?`;
}

export function pad(n: string | number): string {
  return String(n).padStart(2, '0');
}

function century(year: string): string {
  return year.length === 2 ? `20${year}` : year;
}

/** ISO, 3.11.2026, 3.11.26, 3 November 2026, November 3, 2026, and 08/10/2026 where it can be read in one way only. */
export const DATE = new RegExp(
  `${SEPARATOR}(?:${[
    '(?<isoYear>\\d{4})-(?<isoMonth>\\d{2})-(?<isoDay>\\d{2})', // 2026-11-03
    '(?<dotDay>\\d{1,2})\\.\\s?(?<dotMonth>\\d{1,2})\\.\\s?(?<dotYear>\\d{4}|\\d{2})(?!\\d)', // 3.11.2026, 3.11.26
    `(?<textDay>\\d{1,2})\\.?\\s+${monthAs('textMonth')}\\s+(?<textYear>\\d{4})`, // 3 November 2026
    `${monthAs('usMonth')}\\s+(?<usDay>\\d{1,2}),?\\s+(?<usYear>\\d{4})`, // November 3, 2026
    '(?<slashFirst>\\d{1,2})/(?<slashSecond>\\d{1,2})/(?<slashYear>\\d{4}|\\d{2})(?!\\d)', // 08/10/2026
  ].join('|')})`,
  'i',
);

// Amounts.

/**
 * "1.499,00" and "1,499.00" both mean 1499: the last separator is the decimal one. Three digits behind the only
 * separator are thousands ("1.000 Stk"), unless a zero stands in front ("0.025").
 */
export function toNumber(printed: string): number {
  const digits = printed.replace(/[^\d.,-]/g, '');
  const last = Math.max(digits.lastIndexOf(','), digits.lastIndexOf('.'));
  if (last < 0) return Number(digits);
  const [whole, fraction] = [digits.slice(0, last).replace(/[.,]/g, ''), digits.slice(last + 1)];
  return Number(fraction.length === 3 && Number(whole) !== 0 ? whole + fraction : `${whole}.${fraction}`);
}

export const MONEY = "(-?\\d{1,3}(?:[.,' ]\\d{3})*[.,]\\d{2}|-?\\d+[.,]\\d{2})";
export const CURRENCY = '(?:€|EUR|US\\$|\\$|USD|£|GBP|CHF)';
// A label may go on with a word in brackets: "Zwischensumme (netto)". A code such as the category in "USt (S)" is no word.
const WORD_IN_BRACKETS = '(?:\\([A-Za-zÄÖÜäöüß]{3,}[^)\\d]*\\)\\s*)?';
/** A rate before the amount: "19 % 190,00". */
const RATE_BEFORE = '(?:\\d{1,2}(?:[.,]\\d+)?\\s*%\\s*)?';
export const AMOUNT = new RegExp(
  `${SEPARATOR}${WORD_IN_BRACKETS}${RATE_BEFORE}(?:in\\s+)?${CURRENCY}?\\s*${MONEY}(?![.,]?\\d)`,
);

// IBANs.

export function findIban(text: string): string | undefined {
  for (const match of text.matchAll(IBAN_LIKE)) {
    const candidate = match[0].replace(/ /g, '');
    // The pattern may swallow a following word; the length of the country tells where the IBAN ends.
    const iban = candidate.slice(0, IBAN_LENGTH.get(candidate.slice(0, 2)) ?? candidate.length);
    if (iban.length === (IBAN_LENGTH.get(iban.slice(0, 2)) ?? iban.length) && isIban(iban)) return iban;
  }
  return undefined;
}

const IBAN_LIKE = /\b[A-Z]{2}\d{2}(?: ?[A-Z0-9]{4}){2,7}(?: ?[A-Z0-9]{1,3})?/g;
// ISO 13616 gives every country one IBAN length. Without it, a cut-off part of a wrong IBAN passes the check now and then.
const IBAN_LENGTH = new Map(
  'AD24 AT20 BE16 BG22 CH21 CY28 CZ24 DE22 DK18 EE20 ES24 FI18 FR27 GB22 GR27 HR21 HU28 IE22 IS26 IT27 LI21 LT20 LU20 LV21 MC27 MT31 NL18 NO15 PL28 PT25 RO24 SE24 SI19 SK24 SM27'
    .split(' ')
    .map((entry) => [entry.slice(0, 2), Number(entry.slice(2))]),
);

// VAT IDs.

/** The VAT IDs of a text in the order they are printed, each once: after a label ("DE123456789", "DE 123 456 789") or by the German shape. */
export function vatIdsIn(text: string): { id: string; customer: boolean }[] {
  const labelled = after(text, VAT_ID_LABEL, VAT_ID).map(({ hit, label, at }) => ({
    id: hit[1]!.replace(/ /g, ''),
    at,
    customer: CUSTOMER.test(text.slice(Math.max(0, at - 20), at)) || CUSTOMER.test(label),
  }));
  const shaped = [...text.matchAll(GERMAN_VAT_ID)].map((match) => ({
    id: match[0].replace(/ /g, ''),
    at: match.index,
    customer: false,
  }));
  const found = [...labelled, ...shaped].sort((a, b) => a.at - b.at);
  return found.filter((entry, i) => found.findIndex((other) => other.id === entry.id) === i);
}

export const VAT_ID_LABEL = new RegExp(
  anyOf(
    /ust\.?-?\s?id\.?-?\s?(?:nr\.?)?/,
    /umsatzsteuer-?\s?id(?:entifikationsnummer)?/,
    /uid(?:-nr\.?)?/,
    /vat[\s-]*(?:id|reg(?:istration)?\.?)?\s*(?:no\.?|number)?/,
    /(?:n°\s*)?tva(?:\s+intracom\w*)?(?:\s+client)?/,
  ),
);
/** A line that starts with the label of a VAT ID, with or without a colon: "USt-IdNr. ATU12345678". */
export const VAT_ID_LINE = new RegExp(`^(?:${VAT_ID_LABEL.source})\\s*:?\\s*[A-Z]{2}`, 'i');
const VAT_ID = new RegExp(`${SEPARATOR}([A-Z]{2}(?: ?[A-Z0-9]){8,12})\\b`);
/** A German VAT ID has a shape of its own, DE and nine digits. An IBAN goes on with digits, a SEPA creditor ID with letters. */
const GERMAN_VAT_ID = /(?<![A-Z0-9])DE(?: ?\d){9}(?! ?\d)/g;
/** What stands before the label of a VAT ID that is the customer's ("Ihre USt-IdNr."), or ends it ("N° TVA client"). */
export const CUSTOMER = /(?:customer|client|kunden?-?|käufers?|buyer(?:'s)?|ihre|your)\s*$/i;

// Shared by the readers.

/**
 * One pattern from several: any of them matches. Each is a regular expression of its own, so that a long list of
 * alternatives stands one to a line; only their text is used, the flags belong to the pattern they go into.
 */
export function anyOf(...alternatives: RegExp[]): string {
  return alternatives.map((pattern) => pattern.source).join('|');
}

/** The index of the last item that passes the test, or -1. */
export function lastIndex<T>(items: T[], test: (item: T) => unknown): number {
  return items.reduce((last, item, i) => (test(item) ? i : last), -1);
}

/** How a country is written on a page, in lower case. */
export const COUNTRY_NAMES: Record<string, string[]> = {
  DE: ['deutschland', 'germany'],
  AT: ['österreich', 'austria'],
  CH: ['schweiz', 'switzerland', 'suisse'],
  FR: ['frankreich', 'france'],
  IT: ['italien', 'italy', 'italia'],
  NL: ['niederlande', 'netherlands', 'nederland'],
  BE: ['belgien', 'belgium', 'belgique'],
  LU: ['luxemburg', 'luxembourg'],
  PL: ['polen', 'poland', 'polska'],
  ES: ['spanien', 'spain', 'españa'],
  IE: ['irland', 'ireland'],
  GB: ['großbritannien', 'vereinigtes königreich', 'united kingdom', 'great britain'],
  US: ['usa', 'united states', 'vereinigte staaten'],
};
