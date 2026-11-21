import { isBic, isDate, isEmail, isIban, isTaxNumber, isVatId } from '../domain/formats.js';
import {
  pageTextOf,
  showsAmount,
  showsCount,
  showsPercent,
  showsSpelling,
  showsWords,
  type PageText,
} from '../domain/shown.js';
import { dateSpellings, MONTHS } from '../domain/spellings.js';
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
  const page = pageTextOf(pdfText);
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
type Rule = (value: unknown, page: PageText, siblings: Fields) => boolean;

// The rules of each object. A field without one cannot be verified on the page (document type, references, notes).
const PARTY: Record<string, Rule> = {
  name: text,
  street: text,
  city: text,
  contactName: text,
  postalCode: shaped((value) => /^[A-Z0-9-]{3,10}$/i.test(value)),
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
  vatCategory: (value, page, item) => typeof value === 'string' && rate(item.vatRate, page),
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
function keep(object: unknown, rules: Record<string, Rule>, page: PageText): Fields {
  const fields = fieldsOf(object);
  return Object.fromEntries(
    Object.entries(fields).filter(([key, value]) => value != null && rules[key]?.(value, page, fields)),
  );
}

function fieldsOf(object: unknown): Fields {
  return object && typeof object === 'object' ? (object as Fields) : {};
}

// The rules, in the order the tables use them. What it takes for a page to show a value, domain/shown.ts says.

function text(value: unknown, page: PageText): boolean {
  return typeof value === 'string' && showsWords(page, value);
}

/** A value of its kind, spaces aside, that the page shows. */
function shaped(fits: (compact: string) => boolean): Rule {
  return (value, page) => typeof value === 'string' && fits(value.replace(/\s+/g, '')) && showsSpelling(page, [value]);
}

// A country is shown by its name, by its code before a postal code ("DE-12345"), or by a VAT ID of the party.
function country(value: unknown, page: PageText, party: Fields): boolean {
  return (
    typeof value === 'string' &&
    ((COUNTRY_NAMES[value] ?? []).some((name) => page.lower.includes(name)) ||
      new RegExp(`\\b${escapeRegExp(value)}-\\d`).test(page.text) ||
      (typeof party.vatId === 'string' && party.vatId.startsWith(value) && showsSpelling(page, [party.vatId])))
  );
}

function phone(value: unknown, page: PageText): boolean {
  return (
    typeof value === 'string' && value.replace(/\D/g, '').length >= 6 && page.digits.includes(value.replace(/\D/g, ''))
  );
}

function count(value: unknown, page: PageText): boolean {
  return typeof value === 'number' && showsCount(page, value);
}

function always(): boolean {
  return true;
}

function amount(value: unknown, page: PageText): boolean {
  return typeof value === 'number' && showsAmount(page, value);
}

function rate(value: unknown, page: PageText): boolean {
  return typeof value === 'number' && showsPercent(page, value);
}

function exact(value: unknown, page: PageText): boolean {
  return typeof value === 'string' && showsSpelling(page, [value]);
}

// A date that does not exist is dropped even if its digits are printed: "13/01/2026" does not show a 13th month.
function date(value: unknown, page: PageText): boolean {
  return typeof value === 'string' && isDate(value) && showsSpelling(page, dateSpellings(value));
}

// A period may be printed as its months: "Oktober 2026" shows its first and its last day.
function month(which: 'first' | 'last'): Rule {
  return (value, page) => {
    if (date(value, page)) return true;
    if (typeof value !== 'string' || !isDate(value)) return false;
    const [y, m, d] = value.split('-').map(Number) as [number, number, number];
    if (d !== (which === 'first' ? 1 : new Date(Date.UTC(y, m, 0)).getUTCDate())) return false;
    const [mm, names] = [String(m).padStart(2, '0'), (MONTHS[m - 1] ?? []).map(escapeRegExp).join('|')];
    // The month alone, not a day in it ("15. September 2026", "15.09.2026").
    return new RegExp(
      `(?<!\\d\\.?\\s*)\\b(?:${names})\\.?\\s*${y}\\b|(?<![\\d./-])${mm}[./]${y}(?!\\d)|(?<![\\d-])${y}-${mm}(?![-\\d])`,
    ).test(page.lower);
  };
}

function currency(value: unknown, page: PageText): boolean {
  return (
    typeof value === 'string' &&
    (new RegExp(`\\b${escapeRegExp(value)}\\b`).test(page.text) || page.text.includes(CURRENCY_SIGNS[value] ?? '\0'))
  );
}

function iban(value: unknown, page: PageText): boolean {
  return typeof value === 'string' && isIban(value.replace(/\s+/g, '').toUpperCase()) && showsSpelling(page, [value]);
}

const CURRENCY_SIGNS: Record<string, string> = { EUR: '€', USD: '$', GBP: '£' };
