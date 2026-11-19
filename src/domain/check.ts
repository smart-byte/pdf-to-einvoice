import { isNumber } from '../util/numbers.js';
import { valueAt } from '../util/objects.js';
import {
  cents,
  checkAdjustments,
  lineAgrees,
  lineBase,
  percentAgrees,
  percentOf,
  slackOf,
  tryCalculate,
  type Totals,
} from './calculate.js';
import { error, warning, type Finding } from './finding.js';
import { isCountryCode, isCurrencyCode, isDate, isEmail, isIban } from './formats.js';
import type { MessageKey, MessageParams } from './messages.js';
import { amountSpellings, dateSpellings, percentSpellings } from './spellings.js';
import {
  isInvoiceType,
  isVatCategory,
  type DocumentAllowance,
  type Invoice,
  type InvoiceDraft,
  type Line,
  type Party,
  type Unchecked,
  type VatCategory,
} from './model.js';
import { vatRateError } from './vat.js';

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

/** Unchecked data with its defaults: both parties are objects, the lines a list of objects, the type a string. */
type Prepared = Unchecked & {
  typeCode: string;
  seller: Unchecked<Party>;
  buyer: Unchecked<Party>;
  lines: Unchecked<Line>[];
};

function withDefaults(input: InvoiceDraft): Prepared {
  const draft = clean(input) as Unchecked;
  const party = (given: Unchecked<Party> | undefined): Unchecked<Party> => ({
    ...given,
    country: upper(given?.country),
    vatId: compact(given?.vatId),
  });
  return {
    ...draft,
    typeCode: String(draft.typeCode ?? '380'),
    currency: upper(draft.currency ?? 'EUR'),
    iban: compact(draft.iban),
    bic: compact(draft.bic),
    deliveryCountry: upper(draft.deliveryCountry),
    seller: party(draft.seller),
    buyer: party(draft.buyer),
    lines: (Array.isArray(draft.lines) ? draft.lines : []).map((given: Unchecked<Line>) => {
      const line: Unchecked<Line> = { unit: 'C62', vatCategory: 'S', ...given };
      // A discount whose fields were all left empty is none.
      if (line.discount && typeof line.discount === 'object' && Object.keys(line.discount).length === 0)
        delete line.discount;
      return line;
    }),
  };
}

const NEEDS_REASON: VatCategory[] = ['E', 'AE', 'K', 'G', 'O'];

/** Each discount and charge on the whole invoice with its path, `discounts.0`; none where the data holds no list. */
const adjustmentsOf = (draft: Unchecked): (readonly [path: string, entry: Unchecked<DocumentAllowance>])[] =>
  (['discounts', 'charges'] as const).flatMap((list) => {
    const entries: unknown = draft[list];
    return (Array.isArray(entries) ? entries : []).map(
      (entry: Unchecked<DocumentAllowance>, i: number) => [`${list}.${i}`, entry] as const,
    );
  });

/** What may have a VAT category, with its path: each line, then each discount and charge on the whole invoice. */
const taxedOf = (draft: Prepared) => [
  ...draft.lines.map((line, i) => [`lines.${i}`, line] as const),
  ...adjustmentsOf(draft),
];
const DATE_FIELDS = [
  'issueDate',
  'dueDate',
  'deliveryDate',
  'periodStart',
  'periodEnd',
  'precedingInvoiceDate',
] as const;

/**
 * Checks invoice data against the rules an EN 16931 invoice has to meet and
 * the particulars German VAT law asks for, and optionally against the text of
 * the PDF it was read from and against what XRechnung asks for on top. Never
 * throws on incomplete data.
 */
export function check(input: InvoiceDraft, options: CheckOptions = {}): CheckResult {
  const draft = withDefaults(input);
  const lines = checkLines(draft);
  // The totals, with the discounts and charges on the whole invoice put into the VAT groups of the lines.
  const { totals, problems } = lines.calculable
    ? tryCalculate(draft as Invoice)
    : { totals: undefined, problems: checkAdjustments(draft as Invoice) };

  const findings = [
    ...checkHeader(draft),
    ...lines.findings,
    ...problems,
    ...checkVatTreatment(draft, options),
    ...checkSupply(draft),
    ...(totals ? checkTotals(draft, totals, options) : []),
    ...(options.rules === 'xrechnung' ? xrechnungFindings(draft) : []),
    ...(options.pdfText !== undefined ? compareWithPdf(draft, totals, options.pdfText, options.percentages) : []),
  ];
  const ok = !findings.some((f) => f.severity === 'error');
  return { findings, totals, invoice: ok ? (draft as Invoice) : undefined };
}

/** The head of the invoice: its number and date, both parties, the formats of dates and codes, the seller's tax ID. */
function checkHeader(draft: Prepared): Finding[] {
  const findings: Finding[] = [];
  const require = (path: string, label: string) => {
    if (valueAt(draft, path) === undefined) findings.push(error(path, 'required', { what: label }));
  };

  require('number', 'The invoice number');
  require('issueDate', 'The invoice date');
  for (const who of ['seller', 'buyer'] as const) {
    require(`${who}.name`, `The name of the ${who}`);
    require(`${who}.country`, `The country of the ${who}`);
    findings.push(...checkAddress(draft[who], who));
  }

  for (const field of DATE_FIELDS) {
    if (draft[field] !== undefined && !isDate(draft[field])) findings.push(error(field, 'format.date'));
  }
  if (isDate(draft.periodStart) && isDate(draft.periodEnd) && draft.periodEnd < draft.periodStart) {
    findings.push(error('periodEnd', 'period-reversed'));
  }
  if (!isInvoiceType(draft.typeCode)) {
    findings.push(error('typeCode', 'format.type'));
  }
  if (!isCurrencyCode(draft.currency)) findings.push(error('currency', 'format.currency'));
  if (draft.iban !== undefined && !(typeof draft.iban === 'string' && isIban(draft.iban)))
    findings.push(error('iban', 'format.iban'));
  if (draft.prepaidAmount !== undefined && !isNumber(draft.prepaidAmount))
    findings.push(error('prepaidAmount', 'format.number'));

  if (draft.seller.vatId === undefined && draft.seller.taxNumber === undefined) {
    findings.push(error('seller.vatId', 'seller-tax-id'));
  }
  return findings;
}

/** The country code of a party, and the parts of its address German VAT law asks for (§ 14 UStG). */
function checkAddress(party: Unchecked<Party>, who: 'seller' | 'buyer'): Finding[] {
  const findings: Finding[] = [];
  if (party.country !== undefined && !isCountryCode(party.country)) {
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
function checkLines(draft: Prepared): { findings: Finding[]; calculable: boolean } {
  const findings: Finding[] = [];
  if (draft.lines.length === 0) findings.push(error('lines', 'required.lines'));
  let calculable = draft.lines.length > 0 && (draft.prepaidAmount === undefined || isNumber(draft.prepaidAmount));
  for (const [i, line] of draft.lines.entries()) {
    const checked = checkLine(line, i);
    findings.push(...checked.findings);
    calculable &&= checked.calculable;
  }
  return { findings, calculable };
}

function checkLine(line: Unchecked<Line>, i: number): { findings: Finding[]; calculable: boolean } {
  const findings: Finding[] = [];
  const at = (field: string) => `lines.${i}.${field}`;
  const NUMBERS = { quantity: 'quantity', unitPrice: 'unit price', vatRate: 'VAT rate' } as const;

  if (line.name === undefined) findings.push(error(at('name'), 'required.line-name'));
  for (const [field, what] of Object.entries(NUMBERS) as [keyof typeof NUMBERS, string][]) {
    if (line[field] === undefined) findings.push(error(at(field), 'required.line-value', { what }));
    else if (!isNumber(line[field])) findings.push(error(at(field), 'format.number'));
  }
  let calculable = isNumber(line.quantity) && isNumber(line.unitPrice) && isNumber(line.vatRate);
  if (line.netAmount !== undefined && !isNumber(line.netAmount)) {
    findings.push(error(at('netAmount'), 'format.number'));
    calculable = false;
  }
  const discount = line.discount;
  if (discount !== undefined) {
    if (discount.percent === undefined && discount.amount === undefined) {
      findings.push(error(at('discount'), 'discount'));
    }
    for (const field of ['percent', 'amount'] as const) {
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
  if (!isVatCategory(line.vatCategory)) {
    findings.push(error(at('vatCategory'), 'format.category'));
  } else if (isNumber(line.vatRate)) {
    const rateError = vatRateError(at('vatRate'), line.vatCategory, line.vatRate);
    if (rateError) findings.push(rateError);
  }
  return { findings, calculable };
}

/** What the VAT categories of the invoice ask for: a reason for charging none, VAT IDs, the country of delivery. */
function checkVatTreatment(draft: Prepared, options: CheckOptions): Finding[] {
  const findings: Finding[] = [];
  // What has a VAT category: each line, and each discount or charge that states one (a rate above 0 alone means S).
  const taxed = taxedOf(draft).flatMap(([path, item]) => {
    const category = item?.vatCategory ?? (isNumber(item?.vatRate) && item.vatRate > 0 ? 'S' : undefined);
    return isVatCategory(category) ? [{ path: `${path}.vatCategory`, category }] : [];
  });
  const categories = new Set<VatCategory>(taxed.map((item) => item.category));

  // BR-O-11: what is not subject to VAT stands alone on its invoice.
  const odd = taxed.find((item) => (item.category === 'O') !== (taxed[0]?.category === 'O'));
  if (categories.has('O') && odd) {
    findings.push(error(odd.path, 'category-o'));
  }
  if (NEEDS_REASON.some((c) => categories.has(c)) && draft.vatExemptionReason === undefined) {
    findings.push(error('vatExemptionReason', 'exemption-reason'));
  }
  if ((categories.has('AE') || categories.has('K')) && draft.buyer.vatId === undefined) {
    findings.push(error('buyer.vatId', 'buyer-vat-id'));
  }
  if (draft.deliveryCountry !== undefined && !isCountryCode(draft.deliveryCountry)) {
    findings.push(error('deliveryCountry', 'format.country'));
  }
  // BR-IC-12 wants the country an intra-community supply went to. As an XRechnung it is refused anyway.
  if (
    categories.has('K') &&
    draft.deliveryCountry === undefined &&
    typeof draft.buyer.country === 'string' &&
    options.rules !== 'xrechnung'
  ) {
    findings.push(warning('deliveryCountry', 'delivery-country', { country: draft.buyer.country }));
  }
  if (
    (categories.has('K') || categories.has('G')) &&
    draft.seller.vatId === undefined &&
    draft.seller.taxNumber !== undefined
  ) {
    findings.push(error('seller.vatId', 'seller-tax-id.export'));
  }
  return findings;
}

/** The date of supply, and the invoice a correction refers to. */
function checkSupply(draft: Prepared): Finding[] {
  const findings: Finding[] = [];
  if (draft.deliveryDate === undefined && draft.periodStart === undefined && draft.periodEnd === undefined) {
    findings.push(warning('deliveryDate', 'delivery-date'));
  }
  if (['381', '384'].includes(draft.typeCode) && draft.precedingInvoiceNumber === undefined) {
    findings.push(warning('precedingInvoiceNumber', 'preceding-invoice'));
  }
  return findings;
}

/** The calculated totals against what the data states: payment terms for an amount due, line totals, printed totals. */
function checkTotals(draft: Prepared, totals: Totals, options: CheckOptions): Finding[] {
  const findings: Finding[] = [];
  if (totals.due > 0 && draft.dueDate === undefined && draft.paymentTerms === undefined) {
    findings.push(error('dueDate', 'payment-terms'));
  }
  for (const [i, line] of draft.lines.entries())
    findings.push(...checkLineTotal(line, i, String(draft.currency), totals, options));
  findings.push(...checkPrintedTotals(draft, totals));
  return findings;
}

/**
 * A line total is quantity times price less the discount, and a discount with both a percentage and an amount has to
 * agree with itself. Two cents are allowed for rounding, half a forint where a currency has no cents.
 */
function checkLineTotal(
  line: Unchecked<Line>,
  i: number,
  currency: string,
  totals: Totals,
  options: CheckOptions,
): Finding[] {
  const findings: Finding[] = [];
  const slack = slackOf(currency);
  const discount = totals.lineDiscounts[i];
  if (discount && line.discount?.amount !== undefined) {
    // The amount as the XML gets it, in cents: a stated 9.995 is written as 10.00.
    const { percent } = line.discount;
    const { amount } = discount;
    if (isNumber(percent) && !percentAgrees(discount.base, percent, amount, slack)) {
      findings.push(
        error(`lines.${i}.discount.amount`, 'discount-mismatch', {
          percent,
          base: discount.base.toFixed(2),
          expected: percentOf(discount.base, percent).toFixed(2),
          stated: amount.toFixed(2),
        }),
      );
    } else if (
      percent === undefined &&
      discount.base !== 0 &&
      amount !== 0 &&
      Math.sign(discount.base) !== Math.sign(amount)
    ) {
      findings.push(warning(`lines.${i}.discount.amount`, 'discount-sign'));
    }
  }

  // With totals every line has its numbers; a line without a total of its own has nothing to compare.
  if (!isNumber(line.netAmount) || !isNumber(line.quantity) || !isNumber(line.unitPrice)) return findings;
  if (lineAgrees(line.quantity, line.unitPrice, discount?.amount ?? 0, totals.lineNet[i]!, slack)) return findings;
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
function checkPrintedTotals(draft: Prepared, totals: Totals): Finding[] {
  const findings: Finding[] = [];
  for (const key of ['net', 'vat', 'gross', 'due'] as const) {
    const printed = draft.totals?.[key];
    if (printed === undefined) continue;
    if (!isNumber(printed)) findings.push(error(`totals.${key}`, 'format.number'));
    else if (cents(printed) !== cents(totals[key])) {
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
function xrechnungFindings(draft: Prepared): Finding[] {
  const findings: Finding[] = [];
  const need = <K extends MessageKey>(path: string, key: K, ...params: MessageParams<K>) => {
    if (valueAt(draft, path) === undefined) findings.push(error(path, key, ...params));
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
  if (typeof draft.paymentTerms === 'string') {
    const marked = draft.paymentTerms.split(/\r?\n/).filter((line: string) => line.trim().startsWith('#'));
    if (
      marked.some((line: string) => !SKONTO.test(line.trim())) ||
      (marked.length > 0 && !/^\s*\n/.test(`${draft.paymentTerms}\n`.split(/#.+#/).at(-1)!))
    ) {
      findings.push(error('paymentTerms', 'xrechnung-payment-terms'));
    }
  }

  // A place of delivery needs its city and postal code in an XRechnung (BR-DE-10, BR-DE-11), which the data cannot hold.
  // A country alone would be left out of the XML without a word, so it is refused.
  if (draft.deliveryCountry !== undefined) {
    findings.push(error('deliveryCountry', 'xrechnung-delivery-address'));
  }

  // BR-IC-12 asks for the country of delivery of an intra-community supply, and BR-DE-10 and BR-DE-11 then for its city and postal code.
  // Known limit: the data model has no delivery address, so such an invoice is refused instead of naming the buyer's address as the place of delivery.
  const intraCommunity = taxedOf(draft).find(([, item]) => item?.vatCategory === 'K');
  if (intraCommunity) {
    findings.push(error(`${intraCommunity[0]}.vatCategory`, 'xrechnung-delivery-address.intra-community'));
  }

  // BR-DE-17: of the types this tool knows, the prepayment invoice is the one XRechnung does not list.
  if (draft.typeCode === '386') {
    findings.push(warning('typeCode', 'xrechnung-type-code'));
  }
  // BR-DE-27
  if (typeof draft.seller.phone === 'string' && (draft.seller.phone.match(/\d/g) ?? []).length < 3) {
    findings.push(warning('seller.phone', 'xrechnung-phone'));
  }
  // BR-DE-28
  if (typeof draft.seller.email === 'string' && !isEmail(draft.seller.email)) {
    findings.push(warning('seller.email', 'xrechnung-email'));
  }
  return findings;
}

/**
 * Reports values that the text of the PDF does not contain. Known limit: it tells whether a value stands in the text,
 * not where. An address entered for the wrong party passes, because each of its words stands somewhere on the page.
 */
function compareWithPdf(
  draft: Prepared,
  totals: Totals | undefined,
  pdfText: string,
  percentages: Record<string, number> = {},
): Finding[] {
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
  const get = (path: string) => valueAt(draft, path);

  for (const path of ['number', 'seller.vatId', 'seller.taxNumber', 'buyer.vatId', 'iban']) {
    const value = get(path);
    if (typeof value === 'string') expect(path, [value], value);
  }
  // A name may wrap, and in a table its rows mix with other columns: every word has to be there, in any order.
  const expectWords = (path: string, value: unknown) => {
    if (typeof value === 'string' && !value.split(/\s+/).every((word) => haystack.includes(word.toLowerCase())))
      expect(path, [value], value);
  };
  for (const who of ['seller', 'buyer']) {
    for (const part of ['name', 'street', 'postalCode', 'city']) expectWords(`${who}.${part}`, get(`${who}.${part}`));
  }
  for (const path of ['issueDate', 'dueDate', 'deliveryDate']) {
    const value = get(path);
    if (isDate(value)) expect(path, dateSpellings(value), value);
  }
  draft.lines.forEach((line, i) => {
    expectWords(`lines.${i}.name`, line.name);
    if (isNumber(line.unitPrice)) expect(`lines.${i}.unitPrice`, amountSpellings(line.unitPrice), line.unitPrice);
    // What a page prints of a discount: its percentage, from which the amount follows, or else its amount.
    const discount = line.discount;
    if (isNumber(discount?.percent))
      expect(`lines.${i}.discount.percent`, percentSpellings(discount.percent), `${discount.percent} %`);
    else if (isNumber(discount?.amount))
      expect(`lines.${i}.discount.amount`, amountSpellings(discount.amount), discount.amount);
  });
  // Of a discount or charge on the whole invoice, too: never what is derived from it, such as its amount in each VAT group.
  for (const [path, entry] of adjustmentsOf(draft)) {
    const percent = isNumber(entry?.percent) ? entry.percent : percentages[path];
    if (percent !== undefined) expect(`${path}.percent`, percentSpellings(percent), `${percent} %`);
    else if (isNumber(entry?.amount)) expect(`${path}.amount`, amountSpellings(entry.amount), entry.amount);
  }
  if (totals) {
    for (const key of ['net', 'vat', 'gross'] as const) {
      if (totals[key] !== 0) expect(`totals.${key}`, amountSpellings(totals[key]), totals[key].toFixed(2));
    }
  }
  return findings;
}
