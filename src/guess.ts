import { isIban } from './check.js';
import type { InvoiceDraft } from './model.js';

// ponytail: label-anchored patterns for German and English invoices. They find the values that carry a label
// (number, dates, bank details, tax IDs, totals) and nothing else: names, addresses and line items are left to a
// person or a language model. Add labels here before reaching for anything smarter.

const MONTHS = ['jan', 'feb', 'm[aä]r', 'apr', 'ma[iy]', 'jun', 'jul', 'aug', 'sep', 'o[ck]t', 'nov', 'de[cz]'];
const MONTH = `(${MONTHS.join('|')})[a-zä]*\\.?`;
const SEPARATOR = '^\\s*[:#.]?\\s*';

/** Dates that can be read in one way only: ISO, 3.11.2026, 3 November 2026, November 3, 2026, and 25/10/2026 (but not 08/10/2026). */
const DATE = new RegExp(
  `${SEPARATOR}(?:(\\d{4})-(\\d{2})-(\\d{2})|(\\d{1,2})\\.\\s?(\\d{1,2})\\.\\s?(\\d{4})|(\\d{1,2})\\.?\\s+${MONTH}\\s+(\\d{4})|${MONTH}\\s+(\\d{1,2}),?\\s+(\\d{4})|(\\d{1,2})/(\\d{1,2})/(\\d{4}))`,
  'i',
);
const AMOUNT = new RegExp(`${SEPARATOR}(?:\\d{1,2}(?:[.,]\\d+)?\\s*%\\s*)?[€$£]?\\s*(-?\\d{1,3}(?:[.,' ]\\d{3})*[.,]\\d{2}|-?\\d+[.,]\\d{2})(?!\\d)`);

const pad = (n: string | number) => String(n).padStart(2, '0');
const monthNumber = (name: string) => MONTHS.findIndex((m) => new RegExp(`^${m}`, 'i').test(name)) + 1;

function toIsoDate(m: RegExpExecArray): string | undefined {
  if (m[1]) return `${m[1]}-${m[2]}-${m[3]}`;
  if (m[4]) return `${m[6]}-${pad(m[5]!)}-${pad(m[4])}`;
  if (m[7]) return `${m[9]}-${pad(monthNumber(m[8]!))}-${pad(m[7])}`;
  if (m[10]) return `${m[12]}-${pad(monthNumber(m[10]))}-${pad(m[11]!)}`;
  // With slashes, day and month can only be told apart when one of them is above 12.
  const [a, b] = [Number(m[13]), Number(m[14])];
  if (a > 12 && b <= 12) return `${m[15]}-${pad(b)}-${pad(a)}`;
  if (b > 12 && a <= 12) return `${m[15]}-${pad(a)}-${pad(b)}`;
  return undefined;
}

/** "1.499,00" and "1,499.00" both mean 1499: the last separator is the decimal one. */
function toNumber(printed: string): number {
  const digits = printed.replace(/[^\d-]/g, '');
  return Number(digits) / 100;
}

/** Applies `value` to what follows each occurrence of `label` on the same line; returns every hit. */
function after(text: string, label: RegExp, value: RegExp): RegExpExecArray[] {
  const hits: RegExpExecArray[] = [];
  for (const match of text.matchAll(new RegExp(label.source, 'gi'))) {
    const hit = value.exec(
      text
        .slice(match.index + match[0].length)
        .split('\n', 1)[0]!
        .slice(0, 60),
    );
    if (hit) hits.push(hit);
  }
  return hits;
}

function findIban(text: string): string | undefined {
  for (const match of text.matchAll(/\b[A-Z]{2}\d{2}(?: ?[A-Z0-9]{4}){2,7}(?: ?[A-Z0-9]{1,3})?/g)) {
    const candidate = match[0].replace(/ /g, '');
    // The pattern may swallow a following word; the check digits tell where the IBAN ends.
    for (let length = candidate.length; length >= 15; length--) {
      if (isIban(candidate.slice(0, length))) return candidate.slice(0, length);
    }
  }
  return undefined;
}

function findCurrency(text: string): string | undefined {
  const signs: [RegExp, string][] = [
    [/€|\bEUR\b/, 'EUR'],
    [/\$|\bUSD\b/, 'USD'],
    [/£|\bGBP\b/, 'GBP'],
    [/\bCHF\b/, 'CHF'],
  ];
  return signs.find(([pattern]) => pattern.test(text))?.[1];
}

/** Removes undefined values and objects that end up empty. */
function prune<T extends object>(object: T): T {
  const entries = Object.entries(object)
    .map(([k, v]) => [k, v && typeof v === 'object' ? prune(v) : v] as const)
    .filter(([, v]) => v !== undefined && !(typeof v === 'object' && Object.keys(v as object).length === 0));
  return Object.fromEntries(entries) as T;
}

/**
 * Reads labelled values out of the text of an invoice, without any model.
 * A starting point for review, not a result: check every value.
 */
export function guessFromText(text: string): InvoiceDraft {
  const date = (label: RegExp) => after(text, label, DATE).map(toIsoDate).find(Boolean);
  const amount = (label: RegExp) => after(text, label, AMOUNT).map((m) => toNumber(m[1]!))[0];
  const first = (label: RegExp, value: RegExp) => after(text, label, value)[0]?.[1];

  const vatIds = [
    ...new Set(
      after(
        text,
        /ust\.?-?\s?id\.?-?\s?(?:nr\.?)?|umsatzsteuer-?\s?id(?:entifikationsnummer)?|uid(?:-nr\.?)?|vat\s*(?:id|reg(?:istration)?\.?)?\s*(?:no\.?|number)?/,
        new RegExp(`${SEPARATOR}([A-Z]{2} ?[A-Z0-9]{8,12})\\b`),
      ).map((m) => m[1]!.replace(/ /g, '')),
    ),
  ];

  return prune({
    number: first(
      /rechnungs?-?\s?(?:nummer|nr\.?)|invoice\s*(?:number|no\.?|#)|(?<![\wäöü.-])nr\.?\s*:/,
      new RegExp(`${SEPARATOR}([A-Za-z0-9][\\w/.-]*\\d[\\w/-]*)`),
    ),
    issueDate: date(/rechnungsdatum|invoice\s+date|date\s+of\s+issue|issue\s+date/) ?? date(/(?<![a-zäöü])datum|(?<![a-z] ?)date/),
    deliveryDate: date(/leistungsdatum|lieferdatum|date\s+of\s+(?:supply|delivery)|delivery\s+date|service\s+date/),
    dueDate: date(/fällig(?:keitsdatum|\s+am|\s+bis)?|zahlbar\s+bis|due(?:\s+date|\s+by|\s+on)?|payable\s+by/),
    currency: findCurrency(text),
    iban: findIban(text),
    bic: first(/\b(?:bic|swift)(?:[-/ ]?code)?/, new RegExp(`${SEPARATOR}([A-Z]{6}[A-Z0-9]{2}(?:[A-Z0-9]{3})?)\\b`)),
    seller: {
      vatId: vatIds[0],
      taxNumber: first(/steuernummer|steuer-?nr\.?|st\.?-?nr\.?|tax\s+(?:number|no\.?)/, new RegExp(`${SEPARATOR}(\\d{2,3}/\\d{3,4}/\\d{4,5}|\\d{10,13})`)),
    },
    buyer: { vatId: vatIds[1] },
    totals: {
      net: amount(/nettobetrag|nettosumme|summe\s+netto|zwischensumme|netto|subtotal|net\s+(?:amount|total)/),
      vat: amount(/umsatzsteuer|mehrwertsteuer|mwst\.?|ust\.?|\bvat\b|sales\s+tax/),
      gross: amount(/gesamt(?:betrag|summe)?|rechnungsbetrag|bruttobetrag|endbetrag|brutto|grand\s+total|amount\s+due|total(?:\s+amount)?(?:\s+due)?/),
    },
  });
}
