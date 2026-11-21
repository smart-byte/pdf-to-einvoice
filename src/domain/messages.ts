// The English text of every finding of this layer: what `check` and `calculate` say about invoice data. A key is the
// code of the finding and, where one code has several texts, a variant after a dot: `format.date` is a finding with
// the code `format`. Amounts and lists come formatted; the texts only put them in place. The layers that read and
// write files have catalogs of their own (generate/messages.ts, inspect/messages.ts). The web app has a German text
// for every code (site/shared/i18n.ts, `e.<code>`), and test/site/i18n.test.ts compares the tables.
import { catalog } from './finding.js';
import { INVOICE_TYPES, VAT_CATEGORIES } from './model.js';

const oneOf = (codes: object) => Object.keys(codes).join(', ');

export const MESSAGES = {
  // What the data needs, and in which form (check)
  required: ({ what }: { what: string }) => `${what} is missing.`,
  'required.lines': () => 'The invoice needs at least one line.',
  'required.line-name': () => 'The line needs a description.',
  'required.line-value': ({ what }: { what: string }) => `The line needs a ${what}.`,
  'format.number': () => 'Not a number.',
  'format.text': () => 'Not a text. Write it in quotes.',
  'format.date': () => 'Not a valid date. Use YYYY-MM-DD.',
  'format.country': () => 'Use the two-letter country code, e.g. DE.',
  'format.currency': () => 'Use the three-letter currency code, e.g. EUR.',
  'format.iban': () => 'The IBAN is not valid (check digits do not match).',
  'format.type': () => `Unknown invoice type. Use one of ${oneOf(INVOICE_TYPES)}.`,
  'format.category': () => `Unknown VAT category. Use one of ${oneOf(VAT_CATEGORIES)}.`,
  'format.list': ({ what }: { what: string }) => `Not a list of ${what}s.`,
  'period-reversed': () => 'The service period ends before it starts.',
  'seller-tax-id': () => 'The seller needs a VAT ID or a tax number.',
  'seller-tax-id.export': () => 'Intra-community supplies and exports need the VAT ID of the seller.',
  address: ({ part, who }: { part: string; who: string }) =>
    `The ${part} of the ${who} is missing. German VAT law (§ 14 UStG) asks for the full address.`,
  discount: () => 'A discount needs a percentage or an amount.',
  'discount.negative': () => 'A percentage is never negative; the sign comes from the line.',
  'negative-price': () => 'The unit price must not be negative. Use a negative quantity for credits.',
  'vat-rate.standard': () => 'With VAT charged (category S), the rate must be above 0.',
  'vat-rate.zero': ({ category }: { category: string }) => `Category ${category} carries no VAT: the rate must be 0.`,
  'vat-rate.negative': () => 'A VAT rate is never negative.',

  // What the VAT treatment asks for
  'category-o': () =>
    'An invoice with something not subject to VAT (category O) cannot also have anything in another VAT category. Issue a separate invoice for one of them, or correct the category.',
  'exemption-reason': () => 'State why no VAT is charged, as printed on the invoice.',
  'buyer-vat-id': () => 'Reverse charge and intra-community supplies need the VAT ID of the buyer.',
  'delivery-country': ({ country }: { country: string }) =>
    `An intra-community supply names the country the goods went to. The country of the buyer (${country}) is written; state the country of delivery if they went elsewhere.`,
  'delivery-date': () =>
    'The date of supply is missing. German invoices must state it, even if it equals the invoice date.',
  'preceding-invoice': () => 'A correction or credit note should name the invoice it refers to.',
  'payment-terms': () => 'An invoice with an amount due needs a due date or payment terms.',

  // The arithmetic of lines and totals
  'discount-mismatch': ({
    percent,
    base,
    expected,
    stated,
  }: {
    percent: number;
    base: string;
    expected: string;
    stated: string;
  }) =>
    `${percent} % of ${base} is ${expected}, but the discount states ${stated}. Correct the percentage or the amount.`,
  'discount-sign': () =>
    'The discount and its line have different signs. On a line with a negative amount the discount is negative too: -10 for 10 off.',
  'line-net': ({ discounted, expected, stated }: { discounted: boolean; expected: string; stated: string }) =>
    `Quantity times unit price${discounted ? ' less the discount' : ''} is ${expected}, but the line states ${stated}. Correct the quantity, the price or the discount.`,
  'line-net.xml': ({ discounted, expected, stated }: { discounted: boolean; expected: string; stated: string }) =>
    `The XML states ${stated} as the total of this line, but its quantity times its price${discounted ? ' less its discount' : ''} is ${expected}, and it names nothing else on the line that explains the difference.`,
  'totals-mismatch': ({ printed, calculated, adjusted }: { printed: string; calculated: string; adjusted: boolean }) =>
    `The PDF says ${printed}, the lines${adjusted ? ' with the discounts and charges' : ''} add up to ${calculated}. The e-invoice must not contradict the PDF: check quantities and prices, and enter any discounts or charges on the whole invoice the PDF states.`,
  'totals-mismatch.xml': ({
    stated,
    calculated,
    adjusted,
  }: {
    stated: string;
    calculated: string;
    adjusted: boolean;
  }) =>
    `The XML states a total of ${stated}, but ${adjusted ? 'its lines, discounts and charges' : 'its lines'} add up to ${calculated}. The XML contradicts itself: ask the issuer for a corrected e-invoice.`,

  // The data against the text of the PDF
  'no-pdf-text': () =>
    'The PDF contains no text (it may be a scan), so the data could not be compared with it. Check every value by eye.',
  'not-in-pdf': ({ value }: { value: string }) => `"${value}" does not appear in the PDF. Please check it.`,

  // Discounts and charges on the whole invoice (calculate)
  adjustment: ({ what }: { what: string }) => `A ${what} needs a percentage or an amount.`,
  'adjustment.negative': () => 'A percentage is never negative; the sign comes from the lines.',
  'charge-reason': () => 'A charge needs its reason as printed, e.g. freight.',
  'adjustment-group.percent': ({ group }: { group: string }) =>
    `No line is in the VAT group ${group}, so the percentage has nothing to be taken of. Correct the VAT category or rate, or leave both out to take it of all lines.`,
  'adjustment-group.several': ({ groups, what }: { groups: string; what: string }) =>
    `The lines are in several VAT groups (${groups}). State the VAT category and rate this ${what} belongs to; an amount is not split between them.`,
  'adjustment-group.none': ({ group, what }: { group: string; what: string }) =>
    `No line is in the VAT group ${group}. State the VAT category and rate this ${what} belongs to.`,
  'adjustment-mismatch': ({
    percent,
    base,
    expected,
    what,
    stated,
  }: {
    percent: number;
    base: string;
    expected: string;
    what: string;
    stated: string;
  }) =>
    `${percent} % of ${base} is ${expected}, but the ${what} states ${stated}. Correct the percentage or the amount.`,
  'adjustment-mismatch.split': ({
    percent,
    parts,
    sum,
    what,
    stated,
  }: {
    percent: number;
    parts: string;
    sum: string;
    what: string;
    stated: string;
  }) =>
    `${percent} % of the lines comes to ${parts} = ${sum} by VAT rate, but the ${what} states ${stated}. Correct the percentage or the amount; an amount is not split between VAT rates.`,
  'adjustment-sign': ({ what }: { what: string }) =>
    `The ${what} and its lines have different signs. Where the lines add up to a negative amount, the ${what} is negative too: -10 for 10.`,

  // What XRechnung 3.0 asks for beyond EN 16931
  'xrechnung-buyer-reference': () =>
    'XRechnung needs the buyer reference: for a German public body its Leitweg-ID, which the buyer names, usually with the order.',
  'xrechnung-seller-contact': () =>
    'XRechnung needs a contact at the seller: the person or department the buyer can ask about the invoice.',
  'xrechnung-seller-phone': () => 'XRechnung needs the phone number of the contact at the seller.',
  'xrechnung-seller-email': () =>
    'XRechnung needs the e-mail address of the seller. It is written as the address of the contact and as the electronic address of the seller.',
  'xrechnung-buyer-email': () =>
    'XRechnung needs an electronic address of the buyer, and this tool writes the e-mail address there. Ask the buyer where invoices are to be sent.',
  'xrechnung-address.city': ({ who }: { who: string }) => `XRechnung needs the city of the ${who}.`,
  'xrechnung-address.postal-code': ({ who }: { who: string }) => `XRechnung needs the postal code of the ${who}.`,
  'xrechnung-payment-terms': () =>
    'XRechnung reads a line of the payment terms that starts with # as a cash discount, which has to be written exactly like #SKONTO#TAGE=14#PROZENT=2.00# on a line of its own (days, then percent with two decimals). Write the line that way, or do not start it with #.',
  'xrechnung-delivery-address': () =>
    'XRechnung takes a place of delivery with its city and postal code only, which this tool cannot state yet. Leave the country of delivery empty.',
  'xrechnung-delivery-address.intra-community': () =>
    'An intra-community supply cannot be written as XRechnung yet: XRechnung then asks for the city and postal code of the place of delivery, and the invoice data has no field for them.',
  'xrechnung-type-code': () =>
    'XRechnung does not list the prepayment invoice (type 386) among its invoice types. A recipient may not accept it.',
  'xrechnung-phone': () => 'XRechnung expects a phone number here, with three digits at least.',
  'xrechnung-email': () => 'XRechnung expects an e-mail address of the form name@example.org here.',
};

export type MessageKey = keyof typeof MESSAGES;
/** What the text of a key needs filled in: nothing, or one object. */
export type MessageParams<K extends MessageKey> = Parameters<(typeof MESSAGES)[K]>;

/** A finding of this layer at a path, with the code and the text of its key, and the text of a key alone. */
export const { error, warning, message } = catalog(MESSAGES);
