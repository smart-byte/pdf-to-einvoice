import { isBic, isDate, isEmail, isIban, isTaxNumber, isVatId } from '../domain/formats.js';
import { amountSpellings, dateSpellings, MONTHS } from '../domain/spellings.js';
import type { InvoiceDraft } from '../domain/model.js';
import { escapeRegExp } from '../util/regexp.js';
import { COUNTRY_NAMES } from './guess/values.js';

// Comparing what a language model read with the text of the PDF: a value stays only where the page shows it, in a
// field of the right kind.

/**
 * Returns the draft without every value that the text of the PDF does not show. Made for data read by a small
 * language model, which may translate a name or make up an identifier: what survives is at least printed on the
 * page, in a field of the right kind. Fields that cannot be verified this way (document type, references, notes)
 * are dropped as well, so they stay for a person to fill in.
 */
export function keepWhatThePdfShows(input: unknown, pdfText: string): InvoiceDraft {
  const page = pageOf(pdfText);
  const draft = fieldsOf(input);
  const result = keep(draft, INVOICE, page);
  const [seller, buyer] = [keep(draft.seller, PARTY, page), keep(draft.buyer, PARTY, page)];
  for (const [key, kept] of Object.entries({ seller, buyer, totals: keep(draft.totals, TOTALS, page) })) {
    if (Object.keys(kept).length) result[key] = kept;
  }
  const lines = Array.isArray(draft.lines) ? draft.lines.map((given) => keep(given, LINE, page)) : [];
  if (lines.length) result.lines = lines;
  // Two mix-ups no page can reveal: the seller repeated as the buyer, and a reason for charging no VAT although
  // every line charges it.
  if (buyer.name && buyer.name === seller.name) delete buyer.name;
  if (!lines.some((kept) => kept.vatRate === 0)) delete result.vatExemptionReason;
  return result as InvoiceDraft;
}

/** The fields of one object of the draft: the invoice, a party, a line or the totals. */
type Fields = Record<string, unknown>;

/** Whether the page shows `value`, a value of the draft beside its `siblings` in the same object. */
type Rule = (value: unknown, page: Page, siblings: Fields) => boolean;

// The rules of each object. A field without one cannot be verified on the page (document type, references, notes).
const PARTY: Record<string, Rule> = {
  name: text,
  street: text,
  city: text,
  contactName: text,
  postalCode: shaped((v) => /^[A-Z0-9-]{3,10}$/i.test(v)),
  country,
  vatId: shaped(isVatId),
  taxNumber: shaped(isTaxNumber),
  email: shaped(isEmail),
  phone,
};
const LINE: Record<string, Rule> = {
  name: text,
  description: text,
  quantity: count,
  unit: always,
  unitPrice: amount,
  netAmount: amount,
  vatRate: rate,
  // The category is an interpretation; it is only kept together with a rate the page shows.
  vatCategory: (v, page, item) => typeof v === 'string' && rate(item.vatRate, page),
};
const INVOICE: Record<string, Rule> = {
  number: exact,
  issueDate: date,
  dueDate: date,
  deliveryDate: date,
  periodStart: month('first'),
  periodEnd: month('last'),
  currency,
  paymentTerms: text,
  vatExemptionReason: text,
  iban,
  bic: shaped(isBic),
  prepaidAmount: amount,
};
const TOTALS: Record<string, Rule> = { net: amount, vat: amount, gross: amount, due: amount };

/** The fields of `object` that have a rule and that the page shows. */
function keep(object: unknown, rules: Record<string, Rule>, page: Page): Fields {
  const fields = fieldsOf(object);
  return Object.fromEntries(
    Object.entries(fields).filter(([key, value]) => value != null && rules[key]?.(value, page, fields)),
  );
}

function fieldsOf(object: unknown): Fields {
  return object && typeof object === 'object' ? (object as Fields) : {};
}

/** The text of the PDF, prepared once in the forms the rules look for a value in. */
interface Page {
  text: string;
  lower: string;
  /** Lower case, without any whitespace. */
  compact: string;
  /** Every word, as printed and without the punctuation at its edges. */
  words: Set<string>;
  /** Digits grouped by a space joined: "1 190,00" is "1190,00". */
  ungrouped: string;
  /** The digits alone. */
  digits: string;
}

function pageOf(pdfText: string): Page {
  const lower = pdfText.toLowerCase();
  return {
    text: pdfText,
    lower,
    compact: lower.replace(/\s+/g, ''),
    words: new Set(lower.split(/[\s,;·|]+/).flatMap((word) => [word, word.replace(EDGE, '')])),
    ungrouped: pdfText.replace(/(\d)[  ](?=\d{3}\b)/g, '$1'),
    digits: lower.replace(/\D/g, ''),
  };
}

// The rules, in the order the tables use them.

/** Every word of the value stands on the page as a whole word. */
function text(v: unknown, page: Page): boolean {
  return (
    typeof v === 'string' &&
    v
      .split(/[\s,;]+/)
      .every((word) => page.words.has(word.toLowerCase()) || page.words.has(word.toLowerCase().replace(EDGE, '')))
  );
}

/** A value of its kind, spaces aside, that the page shows. */
function shaped(fits: (compact: string) => boolean): Rule {
  return (v, page) => typeof v === 'string' && fits(v.replace(/\s+/g, '')) && shows(page, [v]);
}

// A country is shown by its name, by its code before a postal code ("DE-12345"), or by a VAT ID of the party.
function country(v: unknown, page: Page, party: Fields): boolean {
  return (
    typeof v === 'string' &&
    ((COUNTRY_NAMES[v] ?? []).some((name) => page.lower.includes(name)) ||
      new RegExp(`\\b${escapeRegExp(v)}-\\d`).test(page.text) ||
      (typeof party.vatId === 'string' && party.vatId.startsWith(v) && shows(page, [party.vatId])))
  );
}

function phone(v: unknown, page: Page): boolean {
  return typeof v === 'string' && v.replace(/\D/g, '').length >= 6 && page.digits.includes(v.replace(/\D/g, ''));
}

// A bare number is only believed where it stands on its own, not inside a longer one. "24.000" shows 24000.
function count(v: unknown, page: Page): boolean {
  if (typeof v !== 'number') return false;
  const plain = escapeRegExp(String(v)).replace('\\.', '[.,]');
  const grouped = Number.isInteger(v) ? String(v).replace(/\B(?=(\d{3})+(?!\d))/g, "[.,' ]") : plain;
  return new RegExp(`(?<![\\d.,])(?:${plain}|${grouped})(?![\\d]|[.,]\\d)`).test(page.text);
}

function always(): boolean {
  return true;
}

// An amount has to stand on its own: "3.11" inside the date "03.11.2026" is not one.
function amount(v: unknown, page: Page): boolean {
  return (
    typeof v === 'number' &&
    amountSpellings(v).some((spelling) =>
      new RegExp(`(?<![\\d.,])${escapeRegExp(spelling)}(?![.,]?\\d)`).test(page.ungrouped),
    )
  );
}

function rate(v: unknown, page: Page): boolean {
  return (
    typeof v === 'number' &&
    new RegExp(`(?<![\\d.,])${escapeRegExp(String(v)).replace('\\.', '[.,]')}(?:[.,]0+)?\\s?%`).test(page.text)
  );
}

function exact(v: unknown, page: Page): boolean {
  return typeof v === 'string' && shows(page, [v]);
}

// A date that does not exist is dropped even if its digits are printed: "13/01/2026" does not show a 13th month.
function date(v: unknown, page: Page): boolean {
  return typeof v === 'string' && isDate(v) && shows(page, dateSpellings(v));
}

// A period may be printed as its months: "Oktober 2026" shows its first and its last day.
function month(which: 'first' | 'last'): Rule {
  return (v, page) => {
    if (date(v, page)) return true;
    if (typeof v !== 'string' || !isDate(v)) return false;
    const [y, m, d] = v.split('-').map(Number) as [number, number, number];
    if (d !== (which === 'first' ? 1 : new Date(Date.UTC(y, m, 0)).getUTCDate())) return false;
    const [mm, names] = [String(m).padStart(2, '0'), (MONTHS[m - 1] ?? []).map(escapeRegExp).join('|')];
    // The month alone, not a day in it ("15. September 2026", "15.09.2026").
    return new RegExp(
      `(?<!\\d\\.?\\s*)\\b(?:${names})\\.?\\s*${y}\\b|(?<![\\d./-])${mm}[./]${y}(?!\\d)|(?<![\\d-])${y}-${mm}(?![-\\d])`,
    ).test(page.lower);
  };
}

function currency(v: unknown, page: Page): boolean {
  return (
    typeof v === 'string' &&
    (new RegExp(`\\b${escapeRegExp(v)}\\b`).test(page.text) || page.text.includes(CURRENCY_SIGNS[v] ?? '\0'))
  );
}

function iban(v: unknown, page: Page): boolean {
  return typeof v === 'string' && isIban(v.replace(/\s+/g, '').toUpperCase()) && shows(page, [v]);
}

/** Whether one of the spellings stands on the page, whitespace and case aside. */
function shows(page: Page, spellings: string[]): boolean {
  return spellings.some((s) => page.compact.includes(s.replace(/\s+/g, '').toLowerCase()));
}

// Whole words only: "Example" is not shown by a PDF that merely contains "info@shop.example".
const EDGE = /^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu;

const CURRENCY_SIGNS: Record<string, string> = { EUR: '€', USD: '$', GBP: '£' };
