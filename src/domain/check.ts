import { calculate, lineBase, micro, percentAgrees, percentOf, resolveAdjustments, slackOf, type Totals } from './calculate.js';
import { error, warning, type Finding } from './finding.js';
import type { MessageKey, MessageParams } from './messages.js';
import { INVOICE_TYPES, VAT_CATEGORIES, type Invoice, type InvoiceDraft, type VatCategory } from './model.js';

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
   * explains by what the data does not hold: more than one discount, a surcharge or a price for several units. A line
   * total that is not quantity times price less the discount is then a warning, since the standard does not forbid
   * it, and none at all for these lines.
   */
  adjustedLines?: number[];
  /**
   * For data read from an existing e-invoice (`readInvoiceXml`): the percentages its XML states for discounts and
   * charges on the whole invoice that the data holds as an amount only, by the path of the entry (`discounts.0`). The
   * page is searched for the percentage rather than for the amount derived from it.
   */
  percentages?: Record<string, number>;
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
  d.lines = (Array.isArray(d.lines) ? d.lines : []).map((l: Bag) => {
    const line: Bag = { unit: 'C62', vatCategory: 'S', ...l };
    // A discount whose fields were all left empty is none.
    if (line.discount && typeof line.discount === 'object' && Object.keys(line.discount).length === 0) delete line.discount;
    return line;
  });
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

const valueAt = (d: Bag, path: string) => path.split('.').reduce((o, k) => o?.[k], d as any);

/**
 * Checks invoice data against the rules an EN 16931 invoice has to meet and
 * the particulars German VAT law asks for, and optionally against the text of
 * the PDF it was read from and against what XRechnung asks for on top. Never
 * throws on incomplete data.
 */
export function check(draft: InvoiceDraft, options: CheckOptions = {}): CheckResult {
  const d = withDefaults(draft);
  const lines = checkLines(d);
  // The discounts and charges on the whole invoice, put into the VAT groups of the lines.
  const adjustments = resolveAdjustments(d as Invoice, lines.calculable);
  const totals = adjustments.resolved ? calculate(d as Invoice) : undefined;

  const findings = [
    ...checkHeader(d),
    ...lines.findings,
    ...adjustments.problems,
    ...checkVatTreatment(d, options),
    ...checkSupply(d),
    ...(totals ? checkTotals(d, totals, options) : []),
    ...(options.rules === 'xrechnung' ? xrechnungFindings(d) : []),
    ...(options.pdfText !== undefined ? compareWithPdf(d, totals, options.pdfText, options.percentages) : []),
  ];
  const ok = !findings.some((f) => f.severity === 'error');
  return { findings, totals, invoice: ok ? (d as Invoice) : undefined };
}

/** The head of the invoice: its number and date, both parties, the formats of dates and codes, the seller's tax ID. */
function checkHeader(d: Bag): Finding[] {
  const findings: Finding[] = [];
  const require = (path: string, label: string) => {
    if (valueAt(d, path) === undefined) findings.push(error(path, 'required', { what: label }));
  };

  require('number', 'The invoice number');
  require('issueDate', 'The invoice date');
  for (const who of ['seller', 'buyer'] as const) {
    require(`${who}.name`, `The name of the ${who}`);
    require(`${who}.country`, `The country of the ${who}`);
    findings.push(...checkAddress(d[who], who));
  }

  for (const field of DATE_FIELDS) {
    if (d[field] !== undefined && !isDate(d[field])) findings.push(error(field, 'format.date'));
  }
  if (isDate(d.periodStart) && isDate(d.periodEnd) && d.periodEnd < d.periodStart) {
    findings.push(error('periodEnd', 'period-reversed'));
  }
  if (!(d.typeCode in INVOICE_TYPES)) {
    findings.push(error('typeCode', 'format.type'));
  }
  if (!/^[A-Z]{3}$/.test(d.currency)) findings.push(error('currency', 'format.currency'));
  if (d.iban !== undefined && !isIban(d.iban)) findings.push(error('iban', 'format.iban'));
  if (d.prepaidAmount !== undefined && !isNumber(d.prepaidAmount)) findings.push(error('prepaidAmount', 'format.number'));

  if (d.seller.vatId === undefined && d.seller.taxNumber === undefined) {
    findings.push(error('seller.vatId', 'seller-tax-id'));
  }
  return findings;
}

/** The country code of a party, and the parts of its address German VAT law asks for (§ 14 UStG). */
function checkAddress(party: Bag, who: 'seller' | 'buyer'): Finding[] {
  const findings: Finding[] = [];
  if (party.country !== undefined && !/^[A-Z]{2}$/.test(party.country)) {
    findings.push(error(`${who}.country`, 'format.country'));
  }
  for (const [field, name] of [
    ['street', 'street'],
    ['postalCode', 'postal code'],
    ['city', 'city'],
  ] as const) {
    if (party[field] === undefined) {
      findings.push(warning(`${who}.${field}`, 'address', { part: name, who }));
    }
  }
  return findings;
}

/**
 * Each line by itself. `calculable` tells whether the totals can be calculated: there is a line, and every number they
 * need is one. An amount that is not a number is reported here; nothing can be calculated with it.
 */
function checkLines(d: Bag): { findings: Finding[]; calculable: boolean } {
  const findings: Finding[] = [];
  if (d.lines.length === 0) findings.push(error('lines', 'required.lines'));
  let calculable = d.lines.length > 0 && (d.prepaidAmount === undefined || isNumber(d.prepaidAmount));
  for (const [i, line] of (d.lines as Bag[]).entries()) {
    const checked = checkLine(line, i);
    findings.push(...checked.findings);
    calculable &&= checked.calculable;
  }
  return { findings, calculable };
}

function checkLine(line: Bag, i: number): { findings: Finding[]; calculable: boolean } {
  const findings: Finding[] = [];
  const at = (field: string) => `lines.${i}.${field}`;
  const NAMES: Record<string, string> = { quantity: 'quantity', unitPrice: 'unit price', vatRate: 'VAT rate' };

  if (line.name === undefined) findings.push(error(at('name'), 'required.line-name'));
  for (const field of ['quantity', 'unitPrice', 'vatRate']) {
    if (line[field] === undefined) findings.push(error(at(field), 'required.line-value', { what: NAMES[field]! }));
    else if (!isNumber(line[field])) findings.push(error(at(field), 'format.number'));
  }
  let calculable = ['quantity', 'unitPrice', 'vatRate'].every((field) => isNumber(line[field]));
  if (line.netAmount !== undefined && !isNumber(line.netAmount)) {
    findings.push(error(at('netAmount'), 'format.number'));
    calculable = false;
  }
  const discount = line.discount;
  if (discount !== undefined) {
    if (discount.percent === undefined && discount.amount === undefined) {
      findings.push(error(at('discount'), 'discount'));
    }
    for (const field of ['percent', 'amount']) {
      if (discount[field] !== undefined && !isNumber(discount[field])) {
        findings.push(error(at(`discount.${field}`), 'format.number'));
        calculable = false;
      }
    }
    if (isNumber(discount.percent) && discount.percent < 0) {
      findings.push(error(at('discount.percent'), 'discount.negative'));
    }
  }
  if (isNumber(line.unitPrice) && line.unitPrice < 0) {
    findings.push(error(at('unitPrice'), 'negative-price'));
  }
  if (!(line.vatCategory in VAT_CATEGORIES)) {
    findings.push(error(at('vatCategory'), 'format.category'));
  } else if (isNumber(line.vatRate)) {
    if (line.vatCategory === 'S' && line.vatRate <= 0) {
      findings.push(error(at('vatRate'), 'vat-rate.standard'));
    }
    if (line.vatCategory !== 'S' && line.vatRate !== 0) {
      findings.push(error(at('vatRate'), 'vat-rate.zero', { category: line.vatCategory }));
    }
  }
  return { findings, calculable };
}

/** What the VAT categories of the invoice ask for: a reason for charging none, VAT IDs, the country of delivery. */
function checkVatTreatment(d: Bag, options: CheckOptions): Finding[] {
  const findings: Finding[] = [];
  // What has a VAT category: each line, and each discount or charge that states one (a rate above 0 alone means S).
  const taxed: { path: string; category: VatCategory }[] = [
    ...d.lines.map((l: Bag, i: number) => ({ path: `lines.${i}.vatCategory`, category: l.vatCategory })),
    ...(['discounts', 'charges'] as const).flatMap((list) =>
      (Array.isArray(d[list]) ? d[list] : []).map((e: Bag, i: number) => ({
        path: `${list}.${i}.vatCategory`,
        category: e?.vatCategory ?? (isNumber(e?.vatRate) && e.vatRate > 0 ? 'S' : undefined),
      })),
    ),
  ].filter((item) => item.category in VAT_CATEGORIES);
  const categories = new Set<VatCategory>(taxed.map((item) => item.category));

  // BR-O-11: what is not subject to VAT stands alone on its invoice.
  const odd = taxed.find((item) => (item.category === 'O') !== (taxed[0]?.category === 'O'));
  if (categories.has('O') && odd) {
    findings.push(error(odd.path, 'category-o'));
  }
  if (NEEDS_REASON.some((c) => categories.has(c)) && d.vatExemptionReason === undefined) {
    findings.push(error('vatExemptionReason', 'exemption-reason'));
  }
  if ((categories.has('AE') || categories.has('K')) && d.buyer.vatId === undefined) {
    findings.push(error('buyer.vatId', 'buyer-vat-id'));
  }
  if (d.deliveryCountry !== undefined && !/^[A-Z]{2}$/.test(d.deliveryCountry)) {
    findings.push(error('deliveryCountry', 'format.country'));
  }
  // BR-IC-12 wants the country an intra-community supply went to. As an XRechnung it is refused anyway.
  if (categories.has('K') && d.deliveryCountry === undefined && d.buyer.country !== undefined && options.rules !== 'xrechnung') {
    findings.push(warning('deliveryCountry', 'delivery-country', { country: d.buyer.country }));
  }
  if ((categories.has('K') || categories.has('G')) && d.seller.vatId === undefined && d.seller.taxNumber !== undefined) {
    findings.push(error('seller.vatId', 'seller-tax-id.export'));
  }
  return findings;
}

/** The date of supply, and the invoice a correction refers to. */
function checkSupply(d: Bag): Finding[] {
  const findings: Finding[] = [];
  if (d.deliveryDate === undefined && d.periodStart === undefined && d.periodEnd === undefined) {
    findings.push(warning('deliveryDate', 'delivery-date'));
  }
  if (['381', '384'].includes(d.typeCode) && d.precedingInvoiceNumber === undefined) {
    findings.push(warning('precedingInvoiceNumber', 'preceding-invoice'));
  }
  return findings;
}

/** The calculated totals against what the data states: payment terms for an amount due, line totals, printed totals. */
function checkTotals(d: Bag, totals: Totals, options: CheckOptions): Finding[] {
  const findings: Finding[] = [];
  if (totals.due > 0 && d.dueDate === undefined && d.paymentTerms === undefined) {
    findings.push(error('dueDate', 'payment-terms'));
  }
  for (const [i, line] of (d.lines as Bag[]).entries()) findings.push(...checkLineTotal(line, i, d.currency, totals, options));
  findings.push(...checkPrintedTotals(d, totals));
  return findings;
}

/**
 * A line total is quantity times price less the discount, and a discount with both a percentage and an amount has to
 * agree with itself. Two cents are allowed for rounding, half a forint where a currency has no cents.
 */
function checkLineTotal(line: Bag, i: number, currency: string, totals: Totals, options: CheckOptions): Finding[] {
  const findings: Finding[] = [];
  const slack = slackOf(currency);
  const discount = totals.lineDiscounts[i];
  if (discount && line.discount.amount !== undefined) {
    // The amount as the XML gets it, in cents: a stated 9.995 is written as 10.00.
    const { percent } = line.discount;
    const { amount } = discount;
    if (percent !== undefined && !percentAgrees(discount.base, percent, amount, slack)) {
      findings.push(
        error(`lines.${i}.discount.amount`, 'discount-mismatch', {
          percent,
          base: discount.base.toFixed(2),
          expected: percentOf(discount.base, percent).toFixed(2),
          stated: amount.toFixed(2),
        }),
      );
    } else if (percent === undefined && discount.base !== 0 && amount !== 0 && Math.sign(discount.base) !== Math.sign(amount)) {
      findings.push(warning(`lines.${i}.discount.amount`, 'discount-sign'));
    }
  }

  if (!isNumber(line.netAmount)) return findings;
  const apart = micro(line.quantity) * micro(line.unitPrice) - (micro(discount?.amount ?? 0) + micro(totals.lineNet[i]!)) * 10n ** 6n;
  if ((apart < 0n ? -apart : apart) <= micro(slack) * 10n ** 6n) return findings;
  // In cents, as the XML has it: 1 x 1.005 is 1.01, not 1.005.
  const expected = (lineBase(line.quantity, line.unitPrice) - (discount?.amount ?? 0)).toFixed(2);
  const stated = totals.lineNet[i]!.toFixed(2);
  if (!options.adjustedLines) {
    findings.push(error(`lines.${i}.netAmount`, 'line-net', { discounted: Boolean(discount), expected, stated }));
  } else if (!options.adjustedLines.includes(i)) {
    findings.push(warning(`lines.${i}.netAmount`, 'line-net.xml', { discounted: Boolean(discount), expected, stated }));
  }
  return findings;
}

/** The totals as printed against the calculated ones, to the cent. */
function checkPrintedTotals(d: Bag, totals: Totals): Finding[] {
  const findings: Finding[] = [];
  for (const key of ['net', 'vat', 'gross', 'due'] as const) {
    const printed = d.totals?.[key];
    if (printed === undefined) continue;
    if (!isNumber(printed)) findings.push(error(`totals.${key}`, 'format.number'));
    else if (Math.round(printed * 100) !== Math.round(totals[key] * 100)) {
      findings.push(
        error(`totals.${key}`, 'totals-mismatch', {
          printed: printed.toFixed(2),
          calculated: totals[key].toFixed(2),
          adjusted: totals.adjustments.length > 0,
        }),
      );
    }
  }
  return findings;
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
  const need = <K extends MessageKey>(path: string, key: K, ...params: MessageParams<K>) => {
    if (valueAt(d, path) === undefined) findings.push(error(path, key, ...params));
  };

  // BR-DE-15
  need('buyerReference', 'xrechnung-buyer-reference');
  // BR-DE-2, BR-DE-5
  need('seller.contactName', 'xrechnung-seller-contact');
  // BR-DE-6
  need('seller.phone', 'xrechnung-seller-phone');
  // BR-DE-7 for the contact, PEPPOL-EN16931-R020 for the electronic address: both are this one e-mail address.
  need('seller.email', 'xrechnung-seller-email');
  // PEPPOL-EN16931-R010
  need('buyer.email', 'xrechnung-buyer-email');
  // BR-DE-3, BR-DE-4, BR-DE-8, BR-DE-9
  for (const who of ['seller', 'buyer']) {
    need(`${who}.city`, 'xrechnung-address.city', { who });
    need(`${who}.postalCode`, 'xrechnung-address.postal-code', { who });
  }

  // BR-DE-18. The validator also wants a line break right after the last "#...#" of the text; `toUbl` ends the text with one.
  if (typeof d.paymentTerms === 'string') {
    const marked = d.paymentTerms.split(/\r?\n/).filter((line: string) => line.trim().startsWith('#'));
    if (marked.some((line: string) => !SKONTO.test(line.trim())) || (marked.length > 0 && !/^\s*\n/.test(`${d.paymentTerms}\n`.split(/#.+#/).at(-1)!))) {
      findings.push(error('paymentTerms', 'xrechnung-payment-terms'));
    }
  }

  // A place of delivery needs its city and postal code in an XRechnung (BR-DE-10, BR-DE-11), which the data cannot hold.
  // A country alone would be left out of the XML without a word, so it is refused.
  if (d.deliveryCountry !== undefined) {
    findings.push(error('deliveryCountry', 'xrechnung-delivery-address'));
  }

  // BR-IC-12 asks for the country of delivery of an intra-community supply, and BR-DE-10 and BR-DE-11 then for its city and postal code.
  // Known limit: the data model has no delivery address, so such an invoice is refused instead of naming the buyer's address as the place of delivery.
  const intraCommunity = [
    ...d.lines.map((line: Bag, i: number) => [`lines.${i}`, line] as const),
    ...(['discounts', 'charges'] as const).flatMap((list) => (Array.isArray(d[list]) ? d[list] : []).map((e: Bag, i: number) => [`${list}.${i}`, e] as const)),
  ].find(([, item]) => item?.vatCategory === 'K');
  if (intraCommunity) {
    findings.push(error(`${intraCommunity[0]}.vatCategory`, 'xrechnung-delivery-address.intra-community'));
  }

  // BR-DE-17: of the types this tool knows, the prepayment invoice is the one XRechnung does not list.
  if (d.typeCode === '386') {
    findings.push(warning('typeCode', 'xrechnung-type-code'));
  }
  // BR-DE-27
  if (typeof d.seller.phone === 'string' && (d.seller.phone.match(/\d/g) ?? []).length < 3) {
    findings.push(warning('seller.phone', 'xrechnung-phone'));
  }
  // BR-DE-28
  if (typeof d.seller.email === 'string' && !/^[^@\s]+@([^@.\s]+\.)+[^@.\s]+$/.test(d.seller.email)) {
    findings.push(warning('seller.email', 'xrechnung-email'));
  }
  return findings;
}

/** The names of the months, as German and English invoices print them, in lower case. */
export const MONTHS = [
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
  // A price may be finer than a cent ("0,4995 €"): it keeps its decimals, two at least.
  const decimals = Math.min(Math.max(2, String(n).split('.')[1]?.length ?? 0), 6);
  const [int, frac] = Math.abs(n).toFixed(decimals).split('.') as [string, string];
  const grouped = (sep: string) => int.replace(/\B(?=(\d{3})+(?!\d))/g, sep);
  const spellings = [`${int},${frac}`, `${int}.${frac}`, `${grouped('.')},${frac}`, `${grouped(',')}.${frac}`, `${grouped("'")}.${frac}`];
  // Known limit: a whole number matches any occurrence of its digits ("100" in "1000"); tighten with word boundaries if that hides real mismatches.
  return frac === '00' ? [...spellings, int, grouped('.'), grouped(',')] : spellings;
}

/** The ways a percentage is commonly printed, without whitespace: "10%", "10,0%", "10.00%", "12,345%". */
export function percentSpellings(p: number): string[] {
  const own = String(p).split('.')[1]?.length ?? 0;
  const forms = [own, 1, 2].filter((decimals) => decimals >= own).map((decimals) => p.toFixed(decimals));
  return [...new Set(forms.flatMap((form) => [`${form}%`, `${form.replace('.', ',')}%`]))];
}

/**
 * Reports values that the text of the PDF does not contain. Known limit: it tells whether a value stands in the text,
 * not where. An address entered for the wrong party passes, because each of its words stands somewhere on the page.
 */
function compareWithPdf(d: Bag, totals: Totals | undefined, pdfText: string, percentages: Record<string, number> = {}): Finding[] {
  const haystack = pdfText.replace(/\s+/g, '').toLowerCase();
  if (!haystack) {
    return [warning('', 'no-pdf-text')];
  }
  const findings: Finding[] = [];
  const expect = (path: string, spellings: string[], shown: unknown) => {
    if (!spellings.some((s) => haystack.includes(s.replace(/\s+/g, '').toLowerCase()))) {
      findings.push(warning(path, 'not-in-pdf', { value: String(shown) }));
    }
  };
  const get = (path: string) => valueAt(d, path);

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
    // What a page prints of a discount: its percentage, from which the amount follows, or else its amount.
    const discount = line.discount;
    if (isNumber(discount?.percent)) expect(`lines.${i}.discount.percent`, percentSpellings(discount.percent), `${discount.percent} %`);
    else if (isNumber(discount?.amount)) expect(`lines.${i}.discount.amount`, amountSpellings(discount.amount), discount.amount);
  });
  // Of a discount or charge on the whole invoice, too: never what is derived from it, such as its amount in each VAT group.
  for (const list of ['discounts', 'charges']) {
    (Array.isArray(d[list]) ? d[list] : []).forEach((e: Bag, i: number) => {
      const percent = isNumber(e?.percent) ? e.percent : percentages[`${list}.${i}`];
      if (percent !== undefined) expect(`${list}.${i}.percent`, percentSpellings(percent), `${percent} %`);
      else if (isNumber(e?.amount)) expect(`${list}.${i}.amount`, amountSpellings(e.amount), e.amount);
    });
  }
  if (totals) {
    for (const key of ['net', 'vat', 'gross'] as const) {
      if (totals[key] !== 0) expect(`totals.${key}`, amountSpellings(totals[key]), totals[key].toFixed(2));
    }
  }
  return findings;
}
