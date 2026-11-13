import { amountSpellings, dateSpellings, isDate, isIban, MONTHS } from './check.js';
import type { InvoiceDraft } from './model.js';

type Bag = Record<string, any>;
type Rule = (value: any, siblings: Bag) => boolean;

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
const CURRENCY_SIGNS: Record<string, string> = { EUR: '€', USD: '$', GBP: '£' };

/**
 * Returns the draft without every value that the text of the PDF does not show. Made for data read by a small
 * language model, which may translate a name or make up an identifier: what survives is at least printed on the
 * page, in a field of the right kind. Fields that cannot be verified this way (document type, references, notes)
 * are dropped as well, so they stay for a person to fill in.
 */
export function keepWhatThePdfShows(draft: unknown, pdfText: string): InvoiceDraft {
  const lower = pdfText.toLowerCase();
  const compact = lower.replace(/\s+/g, '');
  const shows = (spellings: string[]) => spellings.some((s) => compact.includes(s.replace(/\s+/g, '').toLowerCase()));
  const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  // Whole words only: "Example" is not shown by a PDF that merely contains "info@shop.example".
  const edge = /^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu;
  const words = new Set(lower.split(/[\s,;·|]+/).flatMap((word) => [word, word.replace(edge, '')]));
  const text: Rule = (v) =>
    typeof v === 'string' && v.split(/[\s,;]+/).every((word) => words.has(word.toLowerCase()) || words.has(word.toLowerCase().replace(edge, '')));
  const exact: Rule = (v) => typeof v === 'string' && shows([v]);
  const shaped =
    (pattern: RegExp): Rule =>
    (v) =>
      typeof v === 'string' && pattern.test(v.replace(/\s+/g, '')) && shows([v]);
  // A date that does not exist is dropped even if its digits are printed: "13/01/2026" does not show a 13th month.
  const date: Rule = (v) => typeof v === 'string' && isDate(v) && shows(dateSpellings(v));
  // An amount has to stand on its own: "3.11" inside the date "03.11.2026" is not one.
  const amount: Rule = (v) =>
    typeof v === 'number' &&
    amountSpellings(v).some((spelling) => new RegExp(`(?<![\\d.,])${escape(spelling)}(?![.,]?\\d)`).test(pdfText.replace(/(\d)[ \u00a0](?=\d{3}\b)/g, '$1')));
  // A bare number is only believed where it stands on its own, not inside a longer one. "24.000" shows 24000.
  const count: Rule = (v) => {
    if (typeof v !== 'number') return false;
    const plain = escape(String(v)).replace('\\.', '[.,]');
    const grouped = Number.isInteger(v) ? String(v).replace(/\B(?=(\d{3})+(?!\d))/g, "[.,' ]") : plain;
    return new RegExp(`(?<![\\d.,])(?:${plain}|${grouped})(?![\\d]|[.,]\\d)`).test(pdfText);
  };
  // A period may be printed as its months: "Oktober 2026" shows its first and its last day.
  const month =
    (which: 'first' | 'last'): Rule =>
    (v, siblings) => {
      if (date(v, siblings)) return true;
      if (typeof v !== 'string' || !isDate(v)) return false;
      const [y, m, d] = v.split('-').map(Number) as [number, number, number];
      if (d !== (which === 'first' ? 1 : new Date(Date.UTC(y, m, 0)).getUTCDate())) return false;
      const [mm, names] = [String(m).padStart(2, '0'), (MONTHS[m - 1] ?? []).map(escape).join('|')];
      // The month alone, not a day in it ("15. September 2026", "15.09.2026").
      return new RegExp(`(?<!\\d\\.?\\s*)\\b(?:${names})\\.?\\s*${y}\\b|(?<![\\d./-])${mm}[./]${y}(?!\\d)|(?<![\\d-])${y}-${mm}(?![-\\d])`).test(lower);
    };
  const rate: Rule = (v) => typeof v === 'number' && new RegExp(`(?<![\\d.,])${escape(String(v)).replace('\\.', '[.,]')}(?:[.,]0+)?\\s?%`).test(pdfText);
  const country: Rule = (v, party) =>
    typeof v === 'string' &&
    ((COUNTRY_NAMES[v] ?? []).some((name) => lower.includes(name)) ||
      new RegExp(`\\b${escape(v)}-\\d`).test(pdfText) ||
      (typeof party.vatId === 'string' && party.vatId.startsWith(v) && shows([party.vatId])));
  const currency: Rule = (v) => typeof v === 'string' && (new RegExp(`\\b${escape(v)}\\b`).test(pdfText) || pdfText.includes(CURRENCY_SIGNS[v] ?? '\0'));
  const any: Rule = () => true;

  const party: Record<string, Rule> = {
    name: text,
    street: text,
    city: text,
    contactName: text,
    postalCode: shaped(/^[A-Z0-9-]{3,10}$/i),
    country,
    vatId: shaped(/^[A-Z]{2}[A-Z0-9]{2,12}$/),
    taxNumber: shaped(/^\d[\d/-]{7,}$/),
    email: shaped(/^[^@\s]+@[^@\s]+\.[^@\s]+$/),
    phone: (v) => typeof v === 'string' && v.replace(/\D/g, '').length >= 6 && lower.replace(/\D/g, '').includes(v.replace(/\D/g, '')),
  };
  const line: Record<string, Rule> = {
    name: text,
    description: text,
    quantity: count,
    unit: any,
    unitPrice: amount,
    netAmount: amount,
    vatRate: rate,
    // The category is an interpretation; it is only kept together with a rate the page shows.
    vatCategory: (v, l) => typeof v === 'string' && rate(l.vatRate, l),
  };
  const root: Record<string, Rule> = {
    number: exact,
    issueDate: date,
    dueDate: date,
    deliveryDate: date,
    periodStart: month('first'),
    periodEnd: month('last'),
    currency,
    paymentTerms: text,
    vatExemptionReason: text,
    iban: (v) => typeof v === 'string' && isIban(v.replace(/\s+/g, '').toUpperCase()) && shows([v]),
    bic: shaped(/^[A-Z]{6}[A-Z0-9]{2}([A-Z0-9]{3})?$/),
    prepaidAmount: amount,
  };
  const totals: Record<string, Rule> = { net: amount, vat: amount, gross: amount, due: amount };

  const keep = (object: unknown, rules: Record<string, Rule>): Bag => {
    const bag = object && typeof object === 'object' ? (object as Bag) : {};
    return Object.fromEntries(Object.entries(bag).filter(([key, value]) => value != null && rules[key]?.(value, bag)));
  };
  const d = draft as Bag;
  const result: Bag = keep(d, root);
  for (const [key, rules] of [
    ['seller', party],
    ['buyer', party],
    ['totals', totals],
  ] as const) {
    const kept = keep(d[key], rules);
    if (Object.keys(kept).length) result[key] = kept;
  }
  if (Array.isArray(d.lines) && d.lines.length) result.lines = d.lines.map((l: unknown) => keep(l, line));
  // Two mix-ups no page can reveal: the seller repeated as the buyer, and a reason for charging no VAT although
  // every line charges it.
  if (result.buyer?.name && result.buyer.name === result.seller?.name) delete result.buyer.name;
  if (!result.lines?.some((l: Bag) => l.vatRate === 0)) delete result.vatExemptionReason;
  return result as InvoiceDraft;
}
