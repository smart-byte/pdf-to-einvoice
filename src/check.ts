import { calculate, micro, type Totals } from './calculate.js';
import { INVOICE_TYPES, VAT_CATEGORIES, type Invoice, type InvoiceDraft, type VatCategory } from './model.js';

export interface Finding {
  /** Dotted path of the field, e.g. `seller.vatId` or `lines.0.unitPrice`. */
  path: string;
  /** An error blocks the e-invoice; a warning asks for a second look. */
  severity: 'error' | 'warning';
  code: string;
  message: string;
}

export interface CheckResult {
  findings: Finding[];
  /** The cleaned invoice with defaults applied. Present only without errors. */
  invoice?: Invoice;
  /** Present whenever every line could be calculated. */
  totals?: Totals;
}

export interface CheckOptions {
  /** Text of the PDF. Values that do not occur in it are reported. */
  pdfText?: string;
  /** `xrechnung` adds what XRechnung 3.0 asks for beyond EN 16931: an error where it demands, a warning where it recommends. */
  rules?: 'xrechnung';
  /**
   * For data read from an existing e-invoice (`readInvoiceXml`): the lines, counted from 0, whose total its XML
   * explains by a discount, a surcharge or a price for several units. A line total that is not quantity times price
   * is then a warning, since the standard does not forbid it, and none at all for these lines.
   */
  adjustedLines?: number[];
}

type Bag = Record<string, any>;

/** Drops null, undefined and blank strings; trims the rest. */
function clean(value: unknown): unknown {
  if (typeof value === 'string') return value.trim() || undefined;
  if (Array.isArray(value)) return value.map((v) => clean(v) ?? {});
  if (value && typeof value === 'object') {
    const entries = Object.entries(value)
      .map(([k, v]) => [k, clean(v)] as const)
      .filter(([, v]) => v !== undefined);
    return Object.fromEntries(entries);
  }
  return value ?? undefined;
}

const upper = (v: unknown) => (typeof v === 'string' ? v.toUpperCase() : v);
const compact = (v: unknown) => (typeof v === 'string' ? v.replace(/\s+/g, '').toUpperCase() : v);

function withDefaults(draft: InvoiceDraft): Bag {
  const d = clean(draft) as Bag;
  d.typeCode = String(d.typeCode ?? '380');
  d.currency = upper(d.currency ?? 'EUR');
  d.iban = compact(d.iban);
  d.bic = compact(d.bic);
  d.deliveryCountry = upper(d.deliveryCountry);
  for (const who of ['seller', 'buyer']) {
    d[who] = { ...d[who] };
    d[who].country = upper(d[who].country);
    d[who].vatId = compact(d[who].vatId);
  }
  d.lines = (Array.isArray(d.lines) ? d.lines : []).map((l: Bag) => ({ unit: 'C62', vatCategory: 'S', ...l }));
  return d;
}

/** Whether a value is a day of the calendar written as `YYYY-MM-DD`; `2026-02-31` is not. */
export function isDate(v: unknown): boolean {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().startsWith(v);
}

/** ISO 13616 mod-97 check. */
export function isIban(v: string): boolean {
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(v)) return false;
  const digits = (v.slice(4) + v.slice(0, 4)).replace(/[A-Z]/g, (c) => String(c.charCodeAt(0) - 55));
  return BigInt(digits) % 97n === 1n;
}

const isNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const NEEDS_REASON: VatCategory[] = ['E', 'AE', 'K', 'G', 'O'];
const DATE_FIELDS = ['issueDate', 'dueDate', 'deliveryDate', 'periodStart', 'periodEnd', 'precedingInvoiceDate'];

/**
 * Checks invoice data against the rules an EN 16931 invoice has to meet and
 * the particulars German VAT law asks for, and optionally against the text of
 * the PDF it was read from and against what XRechnung asks for on top. Never
 * throws on incomplete data.
 */
export function check(draft: InvoiceDraft, options: CheckOptions = {}): CheckResult {
  const d = withDefaults(draft);
  const findings: Finding[] = [];
  const add = (severity: Finding['severity'], path: string, code: string, message: string) => findings.push({ path, severity, code, message });
  const error = (path: string, code: string, message: string) => add('error', path, code, message);
  const warn = (path: string, code: string, message: string) => add('warning', path, code, message);
  const get = (path: string) => path.split('.').reduce((o, k) => o?.[k], d as any);
  const require = (path: string, label: string) => {
    if (get(path) === undefined) error(path, 'required', `${label} is missing.`);
  };

  require('number', 'The invoice number');
  require('issueDate', 'The invoice date');
  for (const [who, label] of [
    ['seller', 'seller'],
    ['buyer', 'buyer'],
  ] as const) {
    require(`${who}.name`, `The name of the ${label}`);
    require(`${who}.country`, `The country of the ${label}`);
    if (d[who].country !== undefined && !/^[A-Z]{2}$/.test(d[who].country)) {
      error(`${who}.country`, 'format', 'Use the two-letter country code, e.g. DE.');
    }
    for (const [field, name] of [
      ['street', 'street'],
      ['postalCode', 'postal code'],
      ['city', 'city'],
    ] as const) {
      if (d[who][field] === undefined) {
        warn(`${who}.${field}`, 'address', `The ${name} of the ${label} is missing. German VAT law (§ 14 UStG) asks for the full address.`);
      }
    }
  }

  for (const field of DATE_FIELDS) {
    if (d[field] !== undefined && !isDate(d[field])) error(field, 'format', 'Not a valid date. Use YYYY-MM-DD.');
  }
  if (isDate(d.periodStart) && isDate(d.periodEnd) && d.periodEnd < d.periodStart) {
    error('periodEnd', 'period-reversed', 'The service period ends before it starts.');
  }
  if (!(d.typeCode in INVOICE_TYPES)) error('typeCode', 'format', `Unknown invoice type. Use one of ${Object.keys(INVOICE_TYPES).join(', ')}.`);
  if (!/^[A-Z]{3}$/.test(d.currency)) error('currency', 'format', 'Use the three-letter currency code, e.g. EUR.');
  if (d.iban !== undefined && !isIban(d.iban)) error('iban', 'format', 'The IBAN is not valid (check digits do not match).');
  if (d.prepaidAmount !== undefined && !isNumber(d.prepaidAmount)) error('prepaidAmount', 'format', 'Not a number.');

  if (d.seller.vatId === undefined && d.seller.taxNumber === undefined) {
    error('seller.vatId', 'seller-tax-id', 'The seller needs a VAT ID or a tax number.');
  }

  if (d.lines.length === 0) error('lines', 'required', 'The invoice needs at least one line.');
  // An amount that is not a number was reported above; nothing can be calculated with it.
  let calculable = d.lines.length > 0 && (d.prepaidAmount === undefined || isNumber(d.prepaidAmount));
  d.lines.forEach((line: Bag, i: number) => {
    const at = (field: string) => `lines.${i}.${field}`;
    if (line.name === undefined) error(at('name'), 'required', 'The line needs a description.');
    for (const field of ['quantity', 'unitPrice', 'vatRate']) {
      if (line[field] === undefined)
        error(at(field), 'required', `The line needs a ${field === 'unitPrice' ? 'unit price' : field === 'vatRate' ? 'VAT rate' : field}.`);
      else if (!isNumber(line[field])) error(at(field), 'format', 'Not a number.');
      calculable &&= isNumber(line[field]);
    }
    if (line.netAmount !== undefined && !isNumber(line.netAmount)) {
      error(at('netAmount'), 'format', 'Not a number.');
      calculable = false;
    }
    if (isNumber(line.unitPrice) && line.unitPrice < 0) {
      error(at('unitPrice'), 'negative-price', 'The unit price must not be negative. Use a negative quantity for credits.');
    }
    if (!(line.vatCategory in VAT_CATEGORIES)) {
      error(at('vatCategory'), 'format', `Unknown VAT category. Use one of ${Object.keys(VAT_CATEGORIES).join(', ')}.`);
    } else if (isNumber(line.vatRate)) {
      if (line.vatCategory === 'S' && line.vatRate <= 0) error(at('vatRate'), 'vat-rate', 'With VAT charged (category S), the rate must be above 0.');
      if (line.vatCategory !== 'S' && line.vatRate !== 0) error(at('vatRate'), 'vat-rate', `Category ${line.vatCategory} carries no VAT: the rate must be 0.`);
    }
  });

  const categories = new Set<VatCategory>(d.lines.map((l: Bag) => l.vatCategory));
  if (NEEDS_REASON.some((c) => categories.has(c)) && d.vatExemptionReason === undefined) {
    error('vatExemptionReason', 'exemption-reason', 'State why no VAT is charged, as printed on the invoice.');
  }
  if ((categories.has('AE') || categories.has('K')) && d.buyer.vatId === undefined) {
    error('buyer.vatId', 'buyer-vat-id', 'Reverse charge and intra-community supplies need the VAT ID of the buyer.');
  }
  if (d.deliveryCountry !== undefined && !/^[A-Z]{2}$/.test(d.deliveryCountry)) {
    error('deliveryCountry', 'format', 'Use the two-letter country code, e.g. DE.');
  }
  // BR-IC-12 wants the country an intra-community supply went to. As an XRechnung it is refused anyway.
  if (categories.has('K') && d.deliveryCountry === undefined && d.buyer.country !== undefined && options.rules !== 'xrechnung') {
    warn(
      'deliveryCountry',
      'delivery-country',
      `An intra-community supply names the country the goods went to. The country of the buyer (${d.buyer.country}) is written; state the country of delivery if they went elsewhere.`,
    );
  }
  if ((categories.has('K') || categories.has('G')) && d.seller.vatId === undefined && d.seller.taxNumber !== undefined) {
    error('seller.vatId', 'seller-tax-id', 'Intra-community supplies and exports need the VAT ID of the seller.');
  }

  if (d.deliveryDate === undefined && d.periodStart === undefined && d.periodEnd === undefined) {
    warn('deliveryDate', 'delivery-date', 'The date of supply is missing. German invoices must state it, even if it equals the invoice date.');
  }
  if (['381', '384'].includes(d.typeCode) && d.precedingInvoiceNumber === undefined) {
    warn('precedingInvoiceNumber', 'preceding-invoice', 'A correction or credit note should name the invoice it refers to.');
  }

  const totals = calculable ? calculate(d as Invoice) : undefined;
  if (totals) {
    if (totals.due > 0 && d.dueDate === undefined && d.paymentTerms === undefined) {
      error('dueDate', 'payment-terms', 'An invoice with an amount due needs a due date or payment terms.');
    }
    // The data has no discount on a line that could explain a difference between its total and quantity times price.
    // Two cents are allowed for rounding, half a forint where a currency has no cents (PEPPOL-EN16931-R120).
    const slack = d.currency === 'HUF' ? 0.5 : 0.02;
    d.lines.forEach((line: Bag, i: number) => {
      if (!isNumber(line.netAmount)) return;
      const apart = micro(line.quantity) * micro(line.unitPrice) - micro(totals.lineNet[i]!) * 10n ** 6n;
      if ((apart < 0n ? -apart : apart) <= micro(slack) * 10n ** 6n) return;
      const [product, stated] = [(line.quantity * line.unitPrice).toFixed(2), totals.lineNet[i]!.toFixed(2)];
      if (!options.adjustedLines) {
        error(
          `lines.${i}.netAmount`,
          'line-net',
          `Quantity times unit price is ${product}, but the line states ${stated}. Correct the quantity or the price; if the line carries a discount, enter the unit price after the discount.`,
        );
      } else if (!options.adjustedLines.includes(i)) {
        warn(
          `lines.${i}.netAmount`,
          'line-net',
          `The XML states ${stated} as the total of this line, but its quantity times its price is ${product}, and it names no discount or surcharge on the line that explains the difference.`,
        );
      }
    });
    for (const key of ['net', 'vat', 'gross', 'due'] as const) {
      const printed = d.totals?.[key];
      if (printed === undefined) continue;
      if (!isNumber(printed)) error(`totals.${key}`, 'format', 'Not a number.');
      else if (Math.round(printed * 100) !== Math.round(totals[key] * 100)) {
        error(
          `totals.${key}`,
          'totals-mismatch',
          `The PDF says ${printed.toFixed(2)}, the lines add up to ${totals[key].toFixed(2)}. The e-invoice must not contradict the PDF.`,
        );
      }
    }
  }

  if (options.rules === 'xrechnung') findings.push(...xrechnungFindings(d));
  if (options.pdfText !== undefined) findings.push(...compareWithPdf(d, totals, options.pdfText));

  const ok = !findings.some((f) => f.severity === 'error');
  return { findings, totals, invoice: ok ? (d as Invoice) : undefined };
}

/** A cash discount as XRechnung wants it written into the payment terms, one to a line. */
const SKONTO = /^#SKONTO#TAGE=\d+#PROZENT=\d+\.\d{2}(#BASISBETRAG=-?\d+\.\d{2})?#$/;

/**
 * What XRechnung 3.0 asks for beyond EN 16931. Each check stands for the rule named behind it, taken from the
 * specification (XRechnung 3.0.2, chapters 12.5 and 12.6) and confirmed with the Schematron rules KoSIT publishes
 * for it: an error where the rule says "must" and the validator rejects the file, a warning where it says "should".
 * What the rules ask of the XML alone (payment instructions, a VAT rate in every breakdown) is the job of `toUbl`.
 */
function xrechnungFindings(d: Bag): Finding[] {
  const findings: Finding[] = [];
  const add = (severity: Finding['severity'], path: string, code: string, message: string) =>
    findings.push({ path, severity, code: `xrechnung-${code}`, message });
  const need = (path: string, code: string, message: string) => {
    if (path.split('.').reduce((o, k) => o?.[k], d as any) === undefined) add('error', path, code, message);
  };

  // BR-DE-15
  need(
    'buyerReference',
    'buyer-reference',
    'XRechnung needs the buyer reference: for a German public body its Leitweg-ID, which the buyer names, usually with the order.',
  );
  // BR-DE-2, BR-DE-5
  need('seller.contactName', 'seller-contact', 'XRechnung needs a contact at the seller: the person or department the buyer can ask about the invoice.');
  // BR-DE-6
  need('seller.phone', 'seller-phone', 'XRechnung needs the phone number of the contact at the seller.');
  // BR-DE-7 for the contact, PEPPOL-EN16931-R020 for the electronic address: both are this one e-mail address.
  need(
    'seller.email',
    'seller-email',
    'XRechnung needs the e-mail address of the seller. It is written as the address of the contact and as the electronic address of the seller.',
  );
  // PEPPOL-EN16931-R010
  need(
    'buyer.email',
    'buyer-email',
    'XRechnung needs an electronic address of the buyer, and this tool writes the e-mail address there. Ask the buyer where invoices are to be sent.',
  );
  // BR-DE-3, BR-DE-4, BR-DE-8, BR-DE-9
  for (const who of ['seller', 'buyer']) {
    need(`${who}.city`, 'address', `XRechnung needs the city of the ${who}.`);
    need(`${who}.postalCode`, 'address', `XRechnung needs the postal code of the ${who}.`);
  }

  // BR-DE-18. The validator also wants a line break right after the last "#...#" of the text; `toUbl` ends the text with one.
  if (typeof d.paymentTerms === 'string') {
    const marked = d.paymentTerms.split(/\r?\n/).filter((line: string) => line.trim().startsWith('#'));
    if (marked.some((line: string) => !SKONTO.test(line.trim())) || (marked.length > 0 && !/^\s*\n/.test(`${d.paymentTerms}\n`.split(/#.+#/).at(-1)!))) {
      add(
        'error',
        'paymentTerms',
        'payment-terms',
        'XRechnung reads a line of the payment terms that starts with # as a cash discount, which has to be written exactly like #SKONTO#TAGE=14#PROZENT=2.00# on a line of its own (days, then percent with two decimals). Write the line that way, or do not start it with #.',
      );
    }
  }

  // A place of delivery needs its city and postal code in an XRechnung (BR-DE-10, BR-DE-11), which the data cannot hold.
  // A country alone would be left out of the XML without a word, so it is refused.
  if (d.deliveryCountry !== undefined) {
    add(
      'error',
      'deliveryCountry',
      'delivery-address',
      'XRechnung takes a place of delivery with its city and postal code only, which this tool cannot state yet. Leave the country of delivery empty.',
    );
  }

  // BR-IC-12 asks for the country of delivery of an intra-community supply, and BR-DE-10 and BR-DE-11 then for its city and postal code.
  // Known limit: the data model has no delivery address, so such an invoice is refused instead of naming the buyer's address as the place of delivery.
  const intraCommunity = d.lines.findIndex((line: Bag) => line.vatCategory === 'K');
  if (intraCommunity >= 0) {
    add(
      'error',
      `lines.${intraCommunity}.vatCategory`,
      'delivery-address',
      'An intra-community supply cannot be written as XRechnung yet: XRechnung then asks for the city and postal code of the place of delivery, and the invoice data has no field for them.',
    );
  }

  // BR-DE-17: of the types this tool knows, the prepayment invoice is the one XRechnung does not list.
  if (d.typeCode === '386') {
    add(
      'warning',
      'typeCode',
      'type-code',
      'XRechnung does not list the prepayment invoice (type 386) among its invoice types. A recipient may not accept it.',
    );
  }
  // BR-DE-27
  if (typeof d.seller.phone === 'string' && (d.seller.phone.match(/\d/g) ?? []).length < 3) {
    add('warning', 'seller.phone', 'phone', 'XRechnung expects a phone number here, with three digits at least.');
  }
  // BR-DE-28
  if (typeof d.seller.email === 'string' && !/^[^@\s]+@([^@.\s]+\.)+[^@.\s]+$/.test(d.seller.email)) {
    add('warning', 'seller.email', 'email', 'XRechnung expects an e-mail address of the form name@example.org here.');
  }
  return findings;
}

const MONTHS = [
  ['januar', 'january', 'jan'],
  ['februar', 'february', 'feb'],
  ['märz', 'march', 'mar', 'mär'],
  ['april', 'apr'],
  ['mai', 'may'],
  ['juni', 'june', 'jun'],
  ['juli', 'july', 'jul'],
  ['august', 'aug'],
  ['september', 'sep'],
  ['oktober', 'october', 'oct', 'okt'],
  ['november', 'nov'],
  ['dezember', 'december', 'dec', 'dez'],
];

/** The ways a date is commonly printed, without whitespace, lower case. */
export function dateSpellings(iso: string): string[] {
  const [y, m, d] = iso.split('-') as [string, string, string];
  const day = String(Number(d));
  const month = String(Number(m));
  const yy = y.slice(2);
  const numeric = [
    iso,
    `${d}.${m}.${y}`,
    `${day}.${month}.${y}`,
    `${d}.${m}.${yy}`,
    `${day}.${month}.${yy}`,
    `${d}/${m}/${y}`,
    `${m}/${d}/${y}`,
    `${d}/${m}/${yy}`,
    `${m}/${d}/${yy}`,
    `${d}-${m}-${y}`,
  ];
  // A month that does not exist has no name: such a date is only looked for in digits.
  const named = (MONTHS[Number(m) - 1] ?? []).flatMap((name) => [
    `${day}.${name}${y}`,
    `${d}.${name}${y}`,
    `${day}${name}${y}`,
    `${name}${day},${y}`,
    `${name}${day}${y}`,
  ]);
  return [...numeric, ...named];
}

/** The ways an amount is commonly printed, without whitespace. */
export function amountSpellings(n: number): string[] {
  const [int, frac] = Math.abs(n).toFixed(2).split('.') as [string, string];
  const grouped = (sep: string) => int.replace(/\B(?=(\d{3})+(?!\d))/g, sep);
  const spellings = [`${int},${frac}`, `${int}.${frac}`, `${grouped('.')},${frac}`, `${grouped(',')}.${frac}`, `${grouped("'")}.${frac}`];
  // Known limit: a whole number matches any occurrence of its digits ("100" in "1000"); tighten with word boundaries if that hides real mismatches.
  return frac === '00' ? [...spellings, int, grouped('.'), grouped(',')] : spellings;
}

/**
 * Reports values that the text of the PDF does not contain. Known limit: it tells whether a value stands in the text,
 * not where. An address entered for the wrong party passes, because each of its words stands somewhere on the page.
 */
function compareWithPdf(d: Bag, totals: Totals | undefined, pdfText: string): Finding[] {
  const haystack = pdfText.replace(/\s+/g, '').toLowerCase();
  if (!haystack) {
    return [
      {
        path: '',
        severity: 'warning',
        code: 'no-pdf-text',
        message: 'The PDF contains no text (it may be a scan), so the data could not be compared with it. Check every value by eye.',
      },
    ];
  }
  const findings: Finding[] = [];
  const expect = (path: string, spellings: string[], shown: unknown) => {
    if (!spellings.some((s) => haystack.includes(s.replace(/\s+/g, '').toLowerCase()))) {
      findings.push({ path, severity: 'warning', code: 'not-in-pdf', message: `"${shown}" does not appear in the PDF. Please check it.` });
    }
  };
  const get = (path: string) => path.split('.').reduce((o, k) => o?.[k], d as any);

  for (const path of ['number', 'seller.vatId', 'seller.taxNumber', 'buyer.vatId', 'iban']) {
    const value = get(path);
    if (typeof value === 'string') expect(path, [value], value);
  }
  // A name may wrap, and in a table its rows mix with other columns: every word has to be there, in any order.
  const expectWords = (path: string, value: unknown) => {
    if (typeof value === 'string' && !value.split(/\s+/).every((word) => haystack.includes(word.toLowerCase()))) expect(path, [value], value);
  };
  for (const who of ['seller', 'buyer']) {
    for (const part of ['name', 'street', 'postalCode', 'city']) expectWords(`${who}.${part}`, get(`${who}.${part}`));
  }
  for (const path of ['issueDate', 'dueDate', 'deliveryDate']) {
    const value = get(path);
    if (isDate(value)) expect(path, dateSpellings(value), value);
  }
  d.lines.forEach((line: Bag, i: number) => {
    expectWords(`lines.${i}.name`, line.name);
    if (isNumber(line.unitPrice)) expect(`lines.${i}.unitPrice`, amountSpellings(line.unitPrice), line.unitPrice);
  });
  if (totals) {
    for (const key of ['net', 'vat', 'gross'] as const) {
      if (totals[key] !== 0) expect(`totals.${key}`, amountSpellings(totals[key]), totals[key].toFixed(2));
    }
  }
  return findings;
}
