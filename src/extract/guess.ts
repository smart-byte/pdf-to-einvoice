import { cents } from '../domain/calculate.js';
import type { InvoiceDraft, Party } from '../domain/model.js';
import { readContact } from './guess/contact.js';
import { readBuyerReference, readNumber, readPaymentTerms, readPeriod, readType } from './guess/head.js';
import { NOTE_CATEGORIES, readItems, readVatNote } from './guess/items.js';
import { believed, cells, countryOfVatId, EU, type Found, ISSUER_OR_BANK, readParties } from './guess/parties.js';
import { findCurrency, readTotals } from './guess/totals.js';
import { after, anyOf, DATE, findIban, SEPARATOR, toIsoDate, vatIdsIn } from './guess/values.js';

// Known limit: patterns for German, English and French invoices, no model. A value is believed for what it fits to, not
// for where it stands: the totals are three printed amounts with net + VAT = gross, the items are rows that add up to
// them, quantity and price are two numbers that multiply to the row total, the seller is the party under a seller
// label, in a sender line or beside its register entry, and the buyer is the address that is left. What does not fit
// stays unread: less, never something invented. Ceiling: labels are still words, and a name is believed as printed;
// add words here before reaching for anything smarter.

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

/** The language an invoice is written in, judged by the words invoices use. English when nothing tells. */
export function languageOf(text: string): 'de' | 'en' {
  return (text.match(GERMAN_WORDS)?.length ?? 0) > (text.match(ENGLISH_WORDS)?.length ?? 0) ? 'de' : 'en';
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
  const date = (label: RegExp) =>
    after(searched, label, DATE)
      .map(({ hit, label: found }) => toIsoDate(hit, /datum|fällig|zahlbar|facture|échéance/i.test(found)))
      .find(Boolean);
  const first = (label: RegExp, value: RegExp) => after(searched, label, value)[0]?.hit[1];

  const found = readParties(rows, options.blocks ?? [rows.map((row) => cells(row)[0]!)]);
  const totals = readTotals(searched, text);
  const lines = readItems(rows, totals, options.blocks);

  // A VAT ID belongs to the party in whose address it stands. Otherwise the customer's is labelled as such.
  const vatIds = vatIdsIn(searched);
  const inAddress = (party: Found | undefined) => (party ? vatIdsIn(party.tail)[0]?.id : undefined);
  const buyer: Partial<Party> = {
    ...believed(found.buyer),
    vatId: inAddress(found.buyer) ?? vatIds.find(({ customer }) => customer)?.id,
  };
  // Of the rest, one that stands beside the issuer's numbers or bank account, as in a footer, is the seller's.
  const others = vatIds.filter(({ id, customer }) => !customer && id !== buyer.vatId);
  const units = [...rows, ...(options.blocks ?? []).map((block) => block.join('   '))];
  const besideIssuer = others.find(({ id }) =>
    units.some((unit) => unit.replace(/ /g, '').includes(id) && ISSUER_OR_BANK.test(unit)),
  );
  const seller: Partial<Party> = {
    ...believed(found.seller),
    vatId: inAddress(found.seller) ?? (besideIssuer ?? others[0])?.id,
  };
  seller.country ??= countryOfVatId(seller.vatId);
  // An address without a country is at home when VAT is charged: that is the ordinary domestic invoice.
  buyer.country ??=
    countryOfVatId(buyer.vatId) ??
    (buyer.postalCode && lines?.some((line) => (line.vatRate ?? 0) > 0) ? seller.country : undefined);

  // An invoice that shows no VAT at all charges none.
  const showsNoVat =
    totals.vat === undefined &&
    lines?.every((line) => line.vatRate === undefined) &&
    (totals.net === undefined || totals.gross === undefined || cents(totals.net) === cents(totals.gross));
  // Why, the printed reason says, or else the country of the buyer: outside the EU the sale is not subject to VAT,
  // elsewhere in the EU the buyer owes it, at home the seller is exempt. A person confirms this.
  const note = lines && showsNoVat ? readVatNote(rows) : undefined;
  const byCountry = buyer.country && (!EU.has(buyer.country) ? 'O' : buyer.country !== seller.country ? 'AE' : 'E');
  const vatCategory =
    lines && showsNoVat ? (NOTE_CATEGORIES.find(([pattern]) => pattern.test(note ?? ''))?.[1] ?? byCountry) : undefined;
  if (lines && vatCategory) for (const line of lines) Object.assign(line, { vatCategory, vatRate: 0 });
  const vatExemptionReason = vatCategory ? note : undefined;

  const { number, dated, beside } = readNumber(searched, rows);
  const iban = findIban(text);
  const contact = readContact(searched, options.blocks !== undefined, found);
  return prune({
    number,
    typeCode: readType(rows),
    buyerReference: readBuyerReference(searched),
    issueDate: date(ISSUE_DATE_LABEL) ?? dated ?? date(/(?<![a-zäöü-])datum|(?<![a-z] ?)date/) ?? beside,
    deliveryDate: date(DELIVERY_DATE_LABEL),
    ...readPeriod(searched, rows),
    dueDate: date(DUE_DATE_LABEL),
    paymentTerms: readPaymentTerms(rows),
    currency: findCurrency(text),
    iban,
    // A BIC belongs to an IBAN; with another kind of account it has no place in the invoice data.
    bic: iban
      ? first(/\b(?:bic|swift)(?:[-/ ]?code)?/, new RegExp(`${SEPARATOR}([A-Z]{6}[A-Z0-9]{2}(?:[A-Z0-9]{3})?)\\b`))
      : undefined,
    vatExemptionReason,
    seller: {
      ...seller,
      taxNumber: first(
        /steuernummer|steuer-?nr\.?|st\.?-?nr\.?|tax\s+(?:number|no\.?)/,
        new RegExp(`${SEPARATOR}(\\d{2,3}/\\d{3,4}/\\d{4,5}|\\d{10,13})`),
      ),
      ...contact.seller,
      // A contact named by its label counts before the person an address names in its second line.
      contactName: contact.seller.contactName ?? seller.contactName,
    },
    buyer: { ...buyer, ...contact.buyer },
    lines,
    totals,
  });
}
