import { cents } from '../domain/money.js';
import { BIC } from '../domain/formats.js';
import type { InvoiceDraft, Line, Party, VatCategory } from '../domain/model.js';
import { readContact } from './guess/contact.js';
import { readBuyerReference, readNumber, readPaymentTerms, readPeriod, readType } from './guess/head.js';
import { NOTE_CATEGORIES, readItems, readVatNote } from './guess/items.js';
import { believed, countryOfVatId, EU, type Found, ISSUER_OR_BANK, readParties } from './guess/parties.js';
import { findCurrency, readTotals, type ReadTotals } from './guess/totals.js';
import { after, anyOf, DATE, findIban, SEPARATOR, toIsoDate, vatIdsIn } from './guess/values.js';
import { cells, rowOf } from '../util/rows.js';

// Known limit: patterns for German, English and French invoices, no model. A value is believed for what it fits to, not
// for where it stands: the totals are three printed amounts with net + VAT = gross, the items are rows that add up to
// them, quantity and price are two numbers that multiply to the row total, the seller is the party under a seller
// label, in a sender line or beside its register entry, and the buyer is the address that is left. What does not fit
// stays unread: less, never something invented. Ceiling: labels are still words, and a name is believed as printed;
// add words here before reaching for anything smarter.

export interface GuessOptions {
  /** The blocks of the page as extractLayout() returns them. With them, an address is read even where rows mix it with the column beside it. */
  blocks?: string[][];
}

/**
 * Reads an invoice from its text without any model: values that fit together, wherever the layout puts them. A
 * starting point for review, not a result: check every value.
 */
export function guessFromText(text: string, options: GuessOptions = {}): InvoiceDraft {
  const rows = text.split('\n');
  // Labels are looked up in the rows first, then in the blocks, where a value stands below its label.
  const searched = [text, ...(options.blocks ?? []).map((block) => block.join('\n'))].join('\n\n');

  const found = readParties(rows, options.blocks ?? [rows.map((row) => cells(row)[0]!)]);
  const totals = readTotals(searched, text);
  const items = readItems(rows, totals, options.blocks);
  const { seller, buyer } = partiesOf({ rows, searched, blocks: options.blocks }, found, items);
  const { lines, reason } = withVatTreatment(rows, totals, items, { seller: seller.country, buyer: buyer.country });

  const { number, dated, beside } = readNumber(searched, rows);
  const iban = findIban(text);
  const contact = readContact(searched, options.blocks !== undefined, found);
  return prune({
    number,
    typeCode: readType(rows),
    buyerReference: readBuyerReference(searched),
    issueDate: dateAfter(searched, ISSUE_DATE_LABEL) ?? dated ?? dateAfter(searched, ANY_DATE_LABEL) ?? beside,
    deliveryDate: dateAfter(searched, DELIVERY_DATE_LABEL),
    ...readPeriod(searched, rows),
    dueDate: dateAfter(searched, DUE_DATE_LABEL),
    paymentTerms: readPaymentTerms(rows),
    currency: findCurrency(text),
    iban,
    // A BIC belongs to an IBAN; with another kind of account it has no place in the invoice data.
    bic: iban ? firstAfter(searched, BIC_LABEL, BIC_VALUE) : undefined,
    vatExemptionReason: reason,
    seller: sellerWith(seller, searched, contact.seller),
    buyer: { ...buyer, ...contact.buyer },
    lines,
    totals,
  });
}

/** The text of the page: its rows, what labels are looked up in, and its blocks where the layout gives them. */
interface Page {
  rows: string[];
  searched: string;
  blocks?: string[][];
}

/** Seller and buyer as their addresses give them, with their VAT IDs, and their countries where those tell them. */
function partiesOf(
  { rows, searched, blocks }: Page,
  found: { seller?: Found; buyer?: Found },
  lines: Partial<Line>[] | undefined,
): { seller: Partial<Party>; buyer: Partial<Party> } {
  const units = [...rows, ...(blocks ?? []).map(rowOf)];
  const vatIds = vatIdsOf(searched, units, found);
  const buyer: Partial<Party> = { ...believed(found.buyer), vatId: vatIds.buyer };
  const seller: Partial<Party> = { ...believed(found.seller), vatId: vatIds.seller };
  seller.country ??= countryOfVatId(seller.vatId);
  // An address without a country is at home when VAT is charged: that is the ordinary domestic invoice.
  buyer.country ??=
    countryOfVatId(buyer.vatId) ??
    (buyer.postalCode && lines?.some((line) => (line.vatRate ?? 0) > 0) ? seller.country : undefined);
  return { seller, buyer };
}

/**
 * The VAT IDs of seller and buyer. One that stands in the address of a party is that party's. Otherwise the customer's
 * is labelled as such, and of the rest, one that stands beside the issuer's numbers or bank account, as in a footer,
 * is the seller's.
 */
function vatIdsOf(searched: string, units: string[], found: { seller?: Found; buyer?: Found }) {
  const vatIds = vatIdsIn(searched);
  const inAddress = (party: Found | undefined) => (party ? vatIdsIn(party.tail)[0]?.id : undefined);
  const buyer = inAddress(found.buyer) ?? vatIds.find(({ customer }) => customer)?.id;
  const others = vatIds.filter(({ id, customer }) => !customer && id !== buyer);
  const besideIssuer = others.find(({ id }) =>
    units.some((unit) => unit.replace(/ /g, '').includes(id) && ISSUER_OR_BANK.test(unit)),
  );
  return { seller: inAddress(found.seller) ?? (besideIssuer ?? others[0])?.id, buyer };
}

/**
 * The lines as they were read, unless the invoice shows no VAT at all. Then it charges none: its lines are given with
 * the category `withoutVat` names and a rate of 0, beside the reason printed for it.
 */
function withVatTreatment(
  rows: string[],
  totals: ReadTotals,
  lines: Partial<Line>[] | undefined,
  countries: { seller?: string; buyer?: string },
): { lines?: Partial<Line>[]; reason?: string } {
  if (!lines) return {};
  const { vatCategory, reason } = withoutVat(rows, totals, lines, countries);
  if (!vatCategory) return { lines };
  return { lines: lines.map((line) => ({ ...line, vatCategory, vatRate: 0 })), reason };
}

/**
 * The VAT category of an invoice that shows no VAT at all, and the reason printed for it. Why, the printed reason says,
 * or else the country of the buyer: outside the EU the sale is not subject to VAT, elsewhere in the EU the buyer owes
 * it, at home the seller is exempt. A person confirms this.
 */
function withoutVat(
  rows: string[],
  totals: ReadTotals,
  lines: Partial<Line>[],
  countries: { seller?: string; buyer?: string },
): { vatCategory?: VatCategory; reason?: string } {
  const showsNoVat =
    totals.vat === undefined &&
    lines.every((line) => line.vatRate === undefined) &&
    (totals.net === undefined || totals.gross === undefined || cents(totals.net) === cents(totals.gross));
  if (!showsNoVat) return {};
  const reason = readVatNote(rows);
  const printed = NOTE_CATEGORIES.find(([pattern]) => pattern.test(reason ?? ''))?.[1];
  const vatCategory = printed ?? categoryByCountry(countries.seller, countries.buyer);
  return vatCategory ? { vatCategory, reason } : {};
}

function categoryByCountry(seller: string | undefined, buyer: string | undefined): VatCategory | undefined {
  if (!buyer) return undefined;
  if (!EU.has(buyer)) return 'O';
  return buyer === seller ? 'E' : 'AE';
}

/**
 * The seller as its address gives it, with its tax number and the contact data the page labels. A contact named by its
 * label counts before the person an address names in its second line.
 */
function sellerWith(seller: Partial<Party>, searched: string, contact: Partial<Party>): Partial<Party> {
  return {
    ...seller,
    taxNumber: firstAfter(searched, TAX_NUMBER_LABEL, TAX_NUMBER),
    ...contact,
    contactName: contact.contactName ?? seller.contactName,
  };
}

/** The first date after a label. A German or French label says the day comes first in "08/10/2026". */
function dateAfter(searched: string, label: RegExp): string | undefined {
  return after(searched, label, DATE)
    .map(({ hit, label: found }) => toIsoDate(hit, DAY_FIRST.test(found)))
    .find(Boolean);
}

/** What the first match of `value` after a label captures. */
function firstAfter(searched: string, label: RegExp, value: RegExp): string | undefined {
  return after(searched, label, value)[0]?.hit[1];
}

/** Removes undefined values and objects that end up empty. */
function prune<T extends object>(object: T): T {
  if (Array.isArray(object)) return object.map((item) => prune(item)) as T;
  const entries = Object.entries(object)
    .map(([k, v]) => [k, v && typeof v === 'object' ? prune(v) : v] as const)
    .filter(
      ([, v]) =>
        v !== undefined && !(typeof v === 'object' && !Array.isArray(v) && Object.keys(v as object).length === 0),
    );
  return Object.fromEntries(entries) as T;
}

/** The language an invoice is written in, judged by the words invoices use. English when nothing tells. */
export function languageOf(text: string): 'de' | 'en' {
  return (text.match(GERMAN_WORDS)?.length ?? 0) > (text.match(ENGLISH_WORDS)?.length ?? 0) ? 'de' : 'en';
}

// What the page is searched for. The functions above use these patterns only when a page is read, so they may stand
// below them.

const ISSUE_DATE_LABEL = new RegExp(
  anyOf(
    /rechnungs-?datum/,
    /belegdatum/,
    /invoice\s+date/,
    /date\s+of\s+issue/,
    /issue\s+date/,
    /date\s+de\s+(?:la\s+)?facture/,
    /date\s+d['’]émission/,
  ),
);
/** Any other date: "Datum", "Date", but not "Lieferdatum", "Due date" or "Update". */
const ANY_DATE_LABEL = /(?<![a-zäöü-])datum|(?<![a-z] ?)date/;
const DELIVERY_DATE_LABEL = new RegExp(
  anyOf(/leistungsdatum/, /lieferdatum/, /date\s+of\s+(?:supply|delivery)/, /delivery\s+date/, /service\s+date/),
);
const DUE_DATE_LABEL = new RegExp(
  anyOf(
    /fällig(?:keit(?:s(?:datum|tag|termin))?|\s+am|\s+bis)?/,
    /zahlbar\s+bis/,
    /due(?:\s+date|\s+by|\s+on)?/,
    /payable\s+by/,
    /date\s+d['’]échéance/,
  ),
);
/** Labels written where the day comes first. */
const DAY_FIRST = /datum|fällig|zahlbar|facture|échéance/i;

const BIC_LABEL = /\b(?:bic|swift)(?:[-/ ]?code)?/;
const BIC_VALUE = new RegExp(`${SEPARATOR}(${BIC.source})\\b`);
const TAX_NUMBER_LABEL = /steuernummer|steuer-?nr\.?|st\.?-?nr\.?|tax\s+(?:number|no\.?)/;
const TAX_NUMBER = new RegExp(`${SEPARATOR}(\\d{2,3}/\\d{3,4}/\\d{4,5}|\\d{10,13})`);

const GERMAN_WORDS = new RegExp(
  `\\b(${[
    'rechnung\\w*',
    'mwst',
    'ust',
    'umsatzsteuer',
    'mehrwertsteuer',
    'netto',
    'brutto',
    'gesamt\\w*',
    'betrag',
    'datum',
    'menge',
    'zahlbar',
    'leistung\\w*',
    'lieferung',
  ].join('|')})\\b`,
  'gi',
);
const ENGLISH_WORDS = /\b(invoice|vat|tax|subtotal|total|amount|date|quantity|payable|payment|due|delivery)\b/gi;
