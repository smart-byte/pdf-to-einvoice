import { isMalformedNumber, isNegative, isNumber } from '../util/numbers.js';
import { valueAt } from '../util/objects.js';
import { checkAdjustments } from './adjustments.js';
import { tryCalculate, type Totals } from './calculate.js';
import type { Finding } from './finding.js';
import { isCountryCode, isCurrencyCode, isDate, isEmail, isIban } from './formats.js';
import { error, warning, type MessageKey, type MessageParams } from './messages.js';
import { cents, lineAgrees, lineBase, percentAgrees, percentOf, slackOf } from './money.js';
import { pageTextOf, showsAmount, showsPercent, showsSpelling, showsWords, type PageText } from './shown.js';
import { dateSpellings } from './spellings.js';
import {
  invoiceJsonSchema,
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
   * it, and none at all for these lines. Giving them, even none, also says where the data comes from: a total that
   * contradicts the lines is then worded as what the XML states, not as what a PDF prints.
   */
  adjustedLines?: number[];
  /**
   * For data read from an existing e-invoice (`readInvoiceXml`): the percentages its XML states for discounts and
   * charges on the whole invoice that the data holds as an amount only, by the path of the entry (`discounts.0`). The
   * page is searched for the percentage rather than for the amount derived from it.
   */
  percentages?: Record<string, number>;
}

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
    ...checkTexts(draft),
    ...lines.findings,
    ...problems,
    ...checkVatTreatment(draft, options),
    ...checkSupply(draft),
    ...(totals ? checkTotals(draft, totals, options) : []),
    ...(options.rules === 'xrechnung' ? xrechnungFindings(draft) : []),
    ...(options.pdfText !== undefined ? compareWithPdf(draft, totals, options.pdfText, options.percentages) : []),
  ];
  const ok = !findings.some((finding) => finding.severity === 'error');
  return { findings, totals, invoice: ok ? (draft as Invoice) : undefined };
}

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
    lines: (Array.isArray(draft.lines) ? draft.lines : []).map(lineWithDefaults),
  };
}

function lineWithDefaults(given: Unchecked<Line>): Unchecked<Line> {
  const line: Unchecked<Line> = { unit: 'C62', vatCategory: 'S', ...given };
  // A discount whose fields were all left empty is none.
  if (isEmptyObject(line.discount)) delete line.discount;
  return line;
}

function isEmptyObject(value: unknown): boolean {
  return typeof value === 'object' && value !== null && Object.keys(value).length === 0;
}

/** Drops null, undefined and blank strings; trims the rest. */
function clean(value: unknown): unknown {
  if (typeof value === 'string') return value.trim() || undefined;
  if (Array.isArray(value)) return value.map((item) => clean(item) ?? {});
  if (value && typeof value === 'object') {
    const entries = Object.entries(value)
      .map(([key, item]) => [key, clean(item)] as const)
      .filter(([, item]) => item !== undefined);
    return Object.fromEntries(entries);
  }
  return value ?? undefined;
}

function upper(value: unknown): unknown {
  return typeof value === 'string' ? value.toUpperCase() : value;
}

function compact(value: unknown): unknown {
  return typeof value === 'string' ? value.replace(/\s+/g, '').toUpperCase() : value;
}

/** The head of the invoice: its number and date, both parties, the formats of dates and codes, the seller's tax ID. */
function checkHeader(draft: Prepared): Finding[] {
  const required = (path: string, label: string) =>
    valueAt(draft, path) === undefined ? [error(path, 'required', { what: label })] : [];
  return [
    ...required('number', 'The invoice number'),
    ...required('issueDate', 'The invoice date'),
    ...(['seller', 'buyer'] as const).flatMap((who) => [
      ...required(`${who}.name`, `The name of the ${who}`),
      ...required(`${who}.country`, `The country of the ${who}`),
      ...checkAddress(draft[who], who),
    ]),
    ...checkFormats(draft),
    ...(draft.seller.vatId === undefined && draft.seller.taxNumber === undefined
      ? [error('seller.vatId', 'seller-tax-id')]
      : []),
  ];
}

/** The country code of a party, and the parts of its address German VAT law asks for (§ 14 UStG). */
function checkAddress(party: Unchecked<Party>, who: 'seller' | 'buyer'): Finding[] {
  const findings: Finding[] = [];
  if (party.country !== undefined && !isCountryCode(party.country)) {
    findings.push(error(`${who}.country`, 'format.country'));
  }
  for (const [field, name] of ADDRESS_PARTS) {
    if (party[field] === undefined) {
      findings.push(warning(`${who}.${field}`, 'address', { part: name, who }));
    }
  }
  return findings;
}

/** The formats of the dates, the type, the currency, the IBAN and the prepaid amount, and a period that runs backwards. */
function checkFormats(draft: Prepared): Finding[] {
  return [...checkDates(draft), ...checkCodes(draft)];
}

function checkDates(draft: Prepared): Finding[] {
  const findings = DATE_FIELDS.filter((field) => draft[field] !== undefined && !isDate(draft[field])).map((field) =>
    error(field, 'format.date'),
  );
  if (runsBackwards(draft)) findings.push(error('periodEnd', 'period-reversed'));
  return findings;
}

function runsBackwards({ periodStart, periodEnd }: Prepared): boolean {
  return isDate(periodStart) && isDate(periodEnd) && periodEnd < periodStart;
}

function checkCodes(draft: Prepared): Finding[] {
  const findings: Finding[] = [];
  if (!isInvoiceType(draft.typeCode)) findings.push(error('typeCode', 'format.type'));
  if (!isCurrencyCode(draft.currency)) findings.push(error('currency', 'format.currency'));
  if (typeof draft.iban === 'string' && !isIban(draft.iban)) findings.push(error('iban', 'format.iban'));
  if (isMalformedNumber(draft.prepaidAmount)) findings.push(error('prepaidAmount', 'format.number'));
  return findings;
}

/**
 * Every value the schema holds as free text is one. A number, a list or an object in its place would go into the XML
 * as it is, and a postal code given as the number 1234 has lost its leading zero. A text with a form of its own, a
 * date or a code, is reported where that form is checked.
 */
function checkTexts(draft: Prepared): Finding[] {
  return notTexts(invoiceJsonSchema, draft, '').map((path) => error(path, 'format.text'));
}

/** A part of the JSON Schema of the invoice, as far as it is walked here. */
interface SchemaPart {
  type?: string;
  pattern?: string;
  enum?: readonly string[];
  properties?: Record<string, SchemaPart>;
  items?: SchemaPart;
}

/** The paths below `path` where the schema holds free text and `value` holds something else. */
function notTexts(part: SchemaPart, value: unknown, path: string): string[] {
  if (value === undefined || value === null) return [];
  if (part.type === 'string') return isTextOrHasForm(part, value) ? [] : [path];
  if (part.items) {
    const items = part.items;
    return Array.isArray(value) ? value.flatMap((item, i) => notTexts(items, item, pathBelow(path, i))) : [];
  }
  return Object.entries(part.properties ?? {}).flatMap(([key, child]) =>
    notTexts(child, (value as Record<string, unknown>)[key], pathBelow(path, key)),
  );
}

/** A value with a form of its own, a pattern or a list of codes, has that form checked elsewhere. */
function isTextOrHasForm(part: SchemaPart, value: unknown): boolean {
  return Boolean(part.pattern || part.enum) || typeof value === 'string';
}

function pathBelow(path: string, key: string | number): string {
  return path ? `${path}.${key}` : String(key);
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

/** The path of a field of a line. */
type At = (field: string) => string;

function checkLine(line: Unchecked<Line>, i: number): { findings: Finding[]; calculable: boolean } {
  const at: At = (field) => `lines.${i}.${field}`;
  const discount = line.discount === undefined ? NO_DISCOUNT : checkDiscountFields(line.discount, at);
  const findings = [
    ...checkLineValues(line, at),
    ...(isMalformedNumber(line.netAmount) ? [error(at('netAmount'), 'format.number')] : []),
    ...discount.findings,
    ...(isNegative(line.unitPrice) ? [error(at('unitPrice'), 'negative-price')] : []),
    ...checkLineVat(line, at),
  ];
  return { findings, calculable: isLineCalculable(line) && discount.calculable };
}

/** What a line without a discount adds: nothing to report, nothing that keeps the totals from being calculated. */
const NO_DISCOUNT = { findings: [], calculable: true } as const;

/** The quantity, the unit price and the VAT rate are numbers, and so is a line total the line states. */
function isLineCalculable(line: Unchecked<Line>): boolean {
  return [line.quantity, line.unitPrice, line.vatRate].every(isNumber) && !isMalformedNumber(line.netAmount);
}

/** A line has a name, and a quantity, a unit price and a VAT rate that are numbers. */
function checkLineValues(line: Unchecked<Line>, at: At): Finding[] {
  const findings: Finding[] = [];
  if (line.name === undefined) findings.push(error(at('name'), 'required.line-name'));
  for (const [field, what] of LINE_NUMBERS) {
    if (line[field] === undefined) findings.push(error(at(field), 'required.line-value', { what }));
    else if (!isNumber(line[field])) findings.push(error(at(field), 'format.number'));
  }
  return findings;
}

/** A discount on a line states a percentage or an amount, both numbers, the percentage not below 0. */
function checkDiscountFields(
  discount: NonNullable<Unchecked<Line>['discount']>,
  at: At,
): { findings: Finding[]; calculable: boolean } {
  const findings: Finding[] = [];
  let calculable = true;
  if (discount.percent === undefined && discount.amount === undefined) {
    findings.push(error(at('discount'), 'discount'));
  }
  for (const field of ['percent', 'amount'] as const) {
    if (isMalformedNumber(discount[field])) {
      findings.push(error(at(`discount.${field}`), 'format.number'));
      calculable = false;
    }
  }
  if (isNegative(discount.percent)) {
    findings.push(error(at('discount.percent'), 'discount.negative'));
  }
  return { findings, calculable };
}

/** The VAT category of a line, and a rate that fits it. */
function checkLineVat(line: Unchecked<Line>, at: At): Finding[] {
  if (!isVatCategory(line.vatCategory)) return [error(at('vatCategory'), 'format.category')];
  if (!isNumber(line.vatRate)) return [];
  const rateError = vatRateError(at('vatRate'), line.vatCategory, line.vatRate);
  return rateError ? [rateError] : [];
}

/** What the VAT categories of the invoice ask for: a reason for charging none, VAT IDs, the country of delivery. */
function checkVatTreatment(draft: Prepared, options: CheckOptions): Finding[] {
  const findings: Finding[] = [];
  const taxed = categoriesOf(draft);
  const categories = new Set<VatCategory>(taxed.map((item) => item.category));

  // BR-O-11: what is not subject to VAT stands alone on its invoice.
  const odd = taxed.find((item) => (item.category === 'O') !== (taxed[0]?.category === 'O'));
  if (categories.has('O') && odd) {
    findings.push(error(odd.path, 'category-o'));
  }
  if (hasAny(categories, NEEDS_REASON) && draft.vatExemptionReason === undefined) {
    findings.push(error('vatExemptionReason', 'exemption-reason'));
  }
  if (hasAny(categories, ['AE', 'K']) && draft.buyer.vatId === undefined) {
    findings.push(error('buyer.vatId', 'buyer-vat-id'));
  }
  return [...findings, ...checkSupplyAbroad(draft, categories, options)];
}

function hasAny(categories: Set<VatCategory>, wanted: readonly VatCategory[]): boolean {
  return wanted.some((category) => categories.has(category));
}

/** What has a VAT category: each line, and each discount or charge that states one (a rate above 0 alone means S). */
function categoriesOf(draft: Prepared): { path: string; category: VatCategory }[] {
  return taxedOf(draft).flatMap(([path, item]) => {
    const category = item?.vatCategory ?? (isNumber(item?.vatRate) && item.vatRate > 0 ? 'S' : undefined);
    return isVatCategory(category) ? [{ path: `${path}.vatCategory`, category }] : [];
  });
}

/** The country of delivery, and what a supply to another country asks of it and of the seller's identification. */
function checkSupplyAbroad(draft: Prepared, categories: Set<VatCategory>, options: CheckOptions): Finding[] {
  const findings: Finding[] = [];
  if (draft.deliveryCountry !== undefined && !isCountryCode(draft.deliveryCountry)) {
    findings.push(error('deliveryCountry', 'format.country'));
  }
  // BR-IC-12 wants the country an intra-community supply went to. As an XRechnung it is refused anyway.
  const country = options.rules === 'xrechnung' ? undefined : likelyDeliveryCountry(draft, categories);
  if (country !== undefined) {
    findings.push(warning('deliveryCountry', 'delivery-country', { country }));
  }
  if (hasAny(categories, ['K', 'G']) && hasTaxNumberOnly(draft.seller)) {
    findings.push(error('seller.vatId', 'seller-tax-id.export'));
  }
  return findings;
}

/** The buyer's country, for an intra-community supply that does not name the country the goods went to. */
function likelyDeliveryCountry(draft: Prepared, categories: Set<VatCategory>): string | undefined {
  if (!categories.has('K') || draft.deliveryCountry !== undefined) return undefined;
  return typeof draft.buyer.country === 'string' ? draft.buyer.country : undefined;
}

function hasTaxNumberOnly(party: Unchecked<Party>): boolean {
  return party.vatId === undefined && party.taxNumber !== undefined;
}

/** The date of supply, and the invoice a correction refers to. */
function checkSupply(draft: Prepared): Finding[] {
  const findings: Finding[] = [];
  if ([draft.deliveryDate, draft.periodStart, draft.periodEnd].every((date) => date === undefined)) {
    findings.push(warning('deliveryDate', 'delivery-date'));
  }
  if (['381', '384'].includes(draft.typeCode) && draft.precedingInvoiceNumber === undefined) {
    findings.push(warning('precedingInvoiceNumber', 'preceding-invoice'));
  }
  return findings;
}

/** What a line total is checked against: the calculated totals, the rounding allowed, and the lines the XML explains. */
interface LineContext {
  totals: Totals;
  /** Two cents for rounding, half a forint where a currency has no cents. */
  slack: number;
  adjustedLines?: number[];
}

/** The calculated totals against what the data states: payment terms for an amount due, line totals, printed totals. */
function checkTotals(draft: Prepared, totals: Totals, options: CheckOptions): Finding[] {
  const findings: Finding[] = [];
  if (totals.due > 0 && !saysWhenDue(draft)) {
    findings.push(error('dueDate', 'payment-terms'));
  }
  const context = { totals, slack: slackOf(String(draft.currency)), adjustedLines: options.adjustedLines };
  for (const [i, line] of draft.lines.entries())
    findings.push(...checkDiscountAmount(line, i, context), ...checkLineNet(line, i, context));
  findings.push(...checkStatedTotals(draft, totals, options.adjustedLines !== undefined));
  return findings;
}

function saysWhenDue(draft: Prepared): boolean {
  return draft.dueDate !== undefined || draft.paymentTerms !== undefined;
}

/** A discount with both a percentage and an amount has to agree with itself; one with an amount alone keeps its sign. */
function checkDiscountAmount(line: Unchecked<Line>, i: number, { totals, slack }: LineContext): Finding[] {
  const discount = totals.lineDiscounts[i];
  if (!discount || line.discount?.amount === undefined) return [];
  // The amount as the XML gets it, in cents: a stated 9.995 is written as 10.00.
  const { percent } = line.discount;
  const { base, amount } = discount;
  if (isNumber(percent)) {
    return percentAgrees(base, percent, amount, slack) ? [] : [discountMismatch(i, { base, amount }, percent)];
  }
  // A 0 has no sign; two that differ multiply to a negative number.
  const signsDiffer = Math.sign(base) * Math.sign(amount) < 0;
  return percent === undefined && signsDiffer ? [warning(`lines.${i}.discount.amount`, 'discount-sign')] : [];
}

function discountMismatch(i: number, { base, amount }: { base: number; amount: number }, percent: number): Finding {
  return error(`lines.${i}.discount.amount`, 'discount-mismatch', {
    percent,
    base: base.toFixed(2),
    expected: percentOf(base, percent).toFixed(2),
    stated: amount.toFixed(2),
  });
}

/** A line total is quantity times price less the discount, within the rounding allowed. */
function checkLineNet(line: Unchecked<Line>, i: number, { totals, slack, adjustedLines }: LineContext): Finding[] {
  // With totals every line has its numbers; a line without a total of its own has nothing to compare.
  const priced = pricedWithTotal(line);
  if (!priced) return [];
  const discount = totals.lineDiscounts[i];
  if (lineAgrees(priced, discount?.amount ?? 0, totals.lineNet[i]!, slack)) return [];
  // In cents, as the XML has it: 1 x 1.005 is 1.01, not 1.005.
  const expected = (lineBase(priced.quantity, priced.unitPrice) - (discount?.amount ?? 0)).toFixed(2);
  const stated = totals.lineNet[i]!.toFixed(2);
  const params = { discounted: Boolean(discount), expected, stated };
  if (!adjustedLines) return [error(`lines.${i}.netAmount`, 'line-net', params)];
  return adjustedLines.includes(i) ? [] : [warning(`lines.${i}.netAmount`, 'line-net.xml', params)];
}

/** The quantity and the unit price of a line that states a total of its own, where all three are numbers. */
function pricedWithTotal({ netAmount, quantity, unitPrice }: Unchecked<Line>) {
  if (!isNumber(netAmount)) return undefined;
  return isNumber(quantity) && isNumber(unitPrice) ? { quantity, unitPrice } : undefined;
}

/**
 * The totals the data states against the calculated ones, to the cent. For data typed in from a PDF they are what the
 * page prints; with `fromXml` both sides of a contradiction are in the XML of an existing e-invoice, and it is worded
 * so.
 */
function checkStatedTotals(draft: Prepared, totals: Totals, fromXml: boolean): Finding[] {
  const findings: Finding[] = [];
  for (const key of ['net', 'vat', 'gross', 'due'] as const) {
    const stated = draft.totals?.[key];
    if (stated === undefined) continue;
    if (!isNumber(stated)) findings.push(error(`totals.${key}`, 'format.number'));
    else if (cents(stated) !== cents(totals[key])) {
      const [calculated, adjusted] = [totals[key].toFixed(2), totals.adjustments.length > 0];
      findings.push(
        fromXml
          ? error(`totals.${key}`, 'totals-mismatch.xml', { stated: stated.toFixed(2), calculated, adjusted })
          : error(`totals.${key}`, 'totals-mismatch', { printed: stated.toFixed(2), calculated, adjusted }),
      );
    }
  }
  return findings;
}

/**
 * What XRechnung 3.0 asks for beyond EN 16931. Each check stands for the rule named behind it, taken from the
 * specification (XRechnung 3.0.2, chapters 12.5 and 12.6) and confirmed with the Schematron rules KoSIT publishes
 * for it: an error where the rule says "must" and the validator rejects the file, a warning where it says "should".
 * What the rules ask of the XML alone (payment instructions, a VAT rate in every breakdown) is the job of `toUbl`.
 */
function xrechnungFindings(draft: Prepared): Finding[] {
  return [
    ...xrechnungRequired(draft),
    ...xrechnungPaymentTerms(draft.paymentTerms),
    ...xrechnungDelivery(draft),
    ...xrechnungRecommended(draft),
  ];
}

/** The fields XRechnung requires. */
function xrechnungRequired(draft: Prepared): Finding[] {
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
  return findings;
}

/** BR-DE-18. The validator also wants a line break right after the last "#...#" of the text; `toUbl` ends the text with one. */
function xrechnungPaymentTerms(terms: unknown): Finding[] {
  if (typeof terms !== 'string') return [];
  const marked = terms.split(/\r?\n/).filter((line: string) => line.trim().startsWith('#'));
  const wrong =
    marked.some((line: string) => !SKONTO.test(line.trim())) ||
    (marked.length > 0 && !/^\s*\n/.test(`${terms}\n`.split(/#.+#/).at(-1)!));
  return wrong ? [error('paymentTerms', 'xrechnung-payment-terms')] : [];
}

/** A place of delivery, which an XRechnung needs with its city and postal code. */
function xrechnungDelivery(draft: Prepared): Finding[] {
  const findings: Finding[] = [];
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
  return findings;
}

/** What XRechnung recommends. */
function xrechnungRecommended(draft: Prepared): Finding[] {
  const findings: Finding[] = [];
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

/** A value the page should show: `on` tells whether a page does, in the way a value of its kind is printed. */
interface Expected {
  path: string;
  shown: unknown;
  on: (page: PageText) => boolean;
}

/**
 * Reports values that the text of the PDF does not show (see shown.ts). Known limit: it tells whether a value stands
 * in the text, not where. An address entered for the wrong party passes, because each of its words stands somewhere
 * on the page.
 */
function compareWithPdf(
  draft: Prepared,
  totals: Totals | undefined,
  pdfText: string,
  percentages: Record<string, number> = {},
): Finding[] {
  if (!pdfText.trim()) {
    return [warning('', 'no-pdf-text')];
  }
  const page = pageTextOf(pdfText);
  return [
    ...expectedInHead(draft),
    ...expectedInLines(draft),
    ...expectedInAdjustments(draft, percentages),
    ...expectedInTotals(totals),
  ]
    .filter((expected) => !expected.on(page))
    .map(({ path, shown }) => warning(path, 'not-in-pdf', { value: String(shown) }));
}

/** The identifiers, the parties and the dates of the invoice. */
function expectedInHead(draft: Prepared): Expected[] {
  const ids = ['number', 'seller.vatId', 'seller.taxNumber', 'buyer.vatId', 'iban'].flatMap((path): Expected[] => {
    const value = valueAt(draft, path);
    return typeof value === 'string' ? [{ path, shown: value, on: (page) => showsSpelling(page, [value]) }] : [];
  });
  const parties = ['seller', 'buyer'].flatMap((who) =>
    ['name', 'street', 'postalCode', 'city'].flatMap((part) =>
      wordsOf(`${who}.${part}`, valueAt(draft, `${who}.${part}`)),
    ),
  );
  const dates = ['issueDate', 'dueDate', 'deliveryDate'].flatMap((path): Expected[] => {
    const value = valueAt(draft, path);
    return isDate(value) ? [{ path, shown: value, on: (page) => showsSpelling(page, dateSpellings(value)) }] : [];
  });
  return [...ids, ...parties, ...dates];
}

/** The name and price of each line, and what a page prints of its discount: its percentage, or else its amount. */
function expectedInLines(draft: Prepared): Expected[] {
  return draft.lines.flatMap((line, i) => [
    ...wordsOf(`lines.${i}.name`, line.name),
    ...(isNumber(line.unitPrice) ? [amountOf(`lines.${i}.unitPrice`, line.unitPrice)] : []),
    ...percentOrAmount(`lines.${i}.discount`, line.discount?.percent, line.discount?.amount),
  ]);
}

/** Of a discount or charge on the whole invoice, too: never what is derived from it, such as its amount in each VAT group. */
function expectedInAdjustments(draft: Prepared, percentages: Record<string, number>): Expected[] {
  return adjustmentsOf(draft).flatMap(([path, entry]) =>
    percentOrAmount(path, isNumber(entry?.percent) ? entry.percent : percentages[path], entry?.amount),
  );
}

function expectedInTotals(totals: Totals | undefined): Expected[] {
  if (!totals) return [];
  return (['net', 'vat', 'gross'] as const)
    .filter((key) => totals[key] !== 0)
    .map((key) => ({ ...amountOf(`totals.${key}`, totals[key]), shown: totals[key].toFixed(2) }));
}

/** What a page prints of a discount or charge at `path`: its percentage, or else its amount. */
function percentOrAmount(path: string, percent: unknown, amount: unknown): Expected[] {
  if (isNumber(percent))
    return [{ path: `${path}.percent`, shown: `${percent} %`, on: (page) => showsPercent(page, percent) }];
  return isNumber(amount) ? [amountOf(`${path}.amount`, amount)] : [];
}

function amountOf(path: string, amount: number): Expected {
  return { path, shown: amount, on: (page) => showsAmount(page, amount) };
}

/**
 * A name may wrap, and in a table its rows mix with other columns: every word has to be there, in any order. A PDF
 * may also hold the words of a name without the spaces between them: then the name as a whole counts.
 */
function wordsOf(path: string, value: unknown): Expected[] {
  if (typeof value !== 'string') return [];
  const joined = (page: PageText) => /\s/.test(value) && showsSpelling(page, [value]);
  return [{ path, shown: value, on: (page) => showsWords(page, value) || joined(page) }];
}

/** What may have a VAT category, with its path: each line, then each discount and charge on the whole invoice. */
function taxedOf(draft: Prepared) {
  return [...draft.lines.map((line, i) => [`lines.${i}`, line] as const), ...adjustmentsOf(draft)];
}

/** Each discount and charge on the whole invoice with its path, `discounts.0`; none where the data holds no list. */
function adjustmentsOf(draft: Unchecked): (readonly [path: string, entry: Unchecked<DocumentAllowance>])[] {
  return (['discounts', 'charges'] as const).flatMap((list) => {
    const entries: unknown = draft[list];
    return (Array.isArray(entries) ? entries : []).map(
      (entry: Unchecked<DocumentAllowance>, i: number) => [`${list}.${i}`, entry] as const,
    );
  });
}

const NEEDS_REASON: VatCategory[] = ['E', 'AE', 'K', 'G', 'O'];
const DATE_FIELDS = [
  'issueDate',
  'dueDate',
  'deliveryDate',
  'periodStart',
  'periodEnd',
  'precedingInvoiceDate',
] as const;
const ADDRESS_PARTS = [
  ['street', 'street'],
  ['postalCode', 'postal code'],
  ['city', 'city'],
] as const;
const LINE_NUMBERS = [
  ['quantity', 'quantity'],
  ['unitPrice', 'unit price'],
  ['vatRate', 'VAT rate'],
] as const;
/** A cash discount as XRechnung wants it written into the payment terms, one to a line. */
const SKONTO = /^#SKONTO#TAGE=\d+#PROZENT=\d+\.\d{2}(#BASISBETRAG=-?\d+\.\d{2})?#$/;
