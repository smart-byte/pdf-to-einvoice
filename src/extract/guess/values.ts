import { isIban } from '../../domain/check.js';

// How values are recognised in the text: dates, amounts, currencies, IBANs, VAT IDs, and a value after its label.

const MONTHS = ['jan', 'feb', 'm[aä]r', 'apr', 'ma[iy]', 'jun', 'jul', 'aug', 'sep', 'o[ck]t', 'nov', 'de[cz]'];
export const MONTH = `(${MONTHS.join('|')})[a-zä]*\\.?`;
export const SEPARATOR = '^\\s*[:#.]?\\s*';

/** ISO, 3.11.2026, 3.11.26, 3 November 2026, November 3, 2026, and 08/10/2026 where it can be read in one way only. */
export const DATE = new RegExp(
  `${SEPARATOR}(?:${[
    '(\\d{4})-(\\d{2})-(\\d{2})', // 2026-11-03
    '(\\d{1,2})\\.\\s?(\\d{1,2})\\.\\s?(\\d{4}|\\d{2})(?!\\d)', // 3.11.2026, 3.11.26
    `(\\d{1,2})\\.?\\s+${MONTH}\\s+(\\d{4})`, // 3 November 2026
    `${MONTH}\\s+(\\d{1,2}),?\\s+(\\d{4})`, // November 3, 2026
    '(\\d{1,2})/(\\d{1,2})/(\\d{4}|\\d{2})(?!\\d)', // 08/10/2026
  ].join('|')})`,
  'i',
);
export const MONEY = "(-?\\d{1,3}(?:[.,' ]\\d{3})*[.,]\\d{2}|-?\\d+[.,]\\d{2})";
export const CURRENCY = '(?:€|EUR|US\\$|\\$|USD|£|GBP|CHF)';
// A label may go on with a word in brackets: "Zwischensumme (netto)". A code such as the category in "USt (S)" is no word.
const WORD_IN_BRACKETS = '(?:\\([A-Za-zÄÖÜäöüß]{3,}[^)\\d]*\\)\\s*)?';
/** A rate before the amount: "19 % 190,00". */
const RATE_BEFORE = '(?:\\d{1,2}(?:[.,]\\d+)?\\s*%\\s*)?';
export const AMOUNT = new RegExp(
  `${SEPARATOR}${WORD_IN_BRACKETS}${RATE_BEFORE}(?:in\\s+)?${CURRENCY}?\\s*${MONEY}(?![.,]?\\d)`,
);

/**
 * One pattern from several: any of them matches. Each is a regular expression of its own, so that a long list of
 * alternatives stands one to a line; only their text is used, the flags belong to the pattern they go into.
 */
export const anyOf = (...alternatives: RegExp[]): string => alternatives.map((pattern) => pattern.source).join('|');

export const pad = (n: string | number) => String(n).padStart(2, '0');
const century = (year: string) => (year.length === 2 ? `20${year}` : year);
export const monthNumber = (name: string) => MONTHS.findIndex((m) => new RegExp(`^${m}`, 'i').test(name)) + 1;
export const cents = (n: number) => Math.round(n * 100);
export const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** The index of the last item that passes the test, or -1. */
export const lastIndex = <T>(items: T[], test: (item: T) => unknown) =>
  items.reduce((last, item, i) => (test(item) ? i : last), -1);

export function toIsoDate(m: RegExpExecArray, dayFirst: boolean): string | undefined {
  if (m[1]) return `${m[1]}-${m[2]}-${m[3]}`;
  if (m[4]) return `${century(m[6]!)}-${pad(m[5]!)}-${pad(m[4])}`;
  if (m[7]) return `${m[9]}-${pad(monthNumber(m[8]!))}-${pad(m[7])}`;
  if (m[10]) return `${m[12]}-${pad(monthNumber(m[10]))}-${pad(m[11]!)}`;
  // With slashes, day and month can be told apart when one is above 12, or when a German or French label says who wrote it.
  const [a, b] = [Number(m[13]), Number(m[14])];
  if (b > 12 && a <= 12) return `${century(m[15]!)}-${pad(a)}-${pad(b)}`;
  if ((a > 12 || dayFirst) && b <= 12) return `${century(m[15]!)}-${pad(b)}-${pad(a)}`;
  return undefined;
}

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

// ISO 13616 gives every country one IBAN length. Without it, a cut-off part of a wrong IBAN passes the check now and then.
const IBAN_LENGTH = new Map(
  'AD24 AT20 BE16 BG22 CH21 CY28 CZ24 DE22 DK18 EE20 ES24 FI18 FR27 GB22 GR27 HR21 HU28 IE22 IS26 IT27 LI21 LT20 LU20 LV21 MC27 MT31 NL18 NO15 PL28 PT25 RO24 SE24 SI19 SK24 SM27'
    .split(' ')
    .map((entry) => [entry.slice(0, 2), Number(entry.slice(2))]),
);

export function findIban(text: string): string | undefined {
  for (const match of text.matchAll(/\b[A-Z]{2}\d{2}(?: ?[A-Z0-9]{4}){2,7}(?: ?[A-Z0-9]{1,3})?/g)) {
    const candidate = match[0].replace(/ /g, '');
    // The pattern may swallow a following word; the length of the country tells where the IBAN ends.
    const iban = candidate.slice(0, IBAN_LENGTH.get(candidate.slice(0, 2)) ?? candidate.length);
    if (iban.length === (IBAN_LENGTH.get(iban.slice(0, 2)) ?? iban.length) && isIban(iban)) return iban;
  }
  return undefined;
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
/** A German VAT ID has a shape of its own, DE and nine digits. An IBAN goes on with digits, a SEPA creditor ID with letters. */
const GERMAN_VAT_ID = /(?<![A-Z0-9])DE(?: ?\d){9}(?! ?\d)/g;
/** What stands before the label of a VAT ID that is the customer's ("Ihre USt-IdNr."), or ends it ("N° TVA client"). */
export const CUSTOMER = /(?:customer|client|kunden?-?|käufers?|buyer(?:'s)?|ihre|your)\s*$/i;

/** The VAT IDs of a text in the order they are printed, each once: after a label ("DE123456789", "DE 123 456 789") or by the German shape. */
export function vatIdsIn(text: string): { id: string; customer: boolean }[] {
  const found = [
    ...after(text, VAT_ID_LABEL, new RegExp(`${SEPARATOR}([A-Z]{2}(?: ?[A-Z0-9]){8,12})\\b`)).map(
      ({ hit, label, at }) => ({
        id: hit[1]!.replace(/ /g, ''),
        at,
        customer: CUSTOMER.test(text.slice(Math.max(0, at - 20), at)) || CUSTOMER.test(label),
      }),
    ),
    ...[...text.matchAll(GERMAN_VAT_ID)].map((match) => ({
      id: match[0].replace(/ /g, ''),
      at: match.index,
      customer: false,
    })),
  ].sort((a, b) => a.at - b.at);
  return found.filter((entry, i) => found.findIndex((other) => other.id === entry.id) === i);
}
