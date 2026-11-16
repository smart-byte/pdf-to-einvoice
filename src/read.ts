import { XMLParser } from 'fast-xml-parser';
import { lineBase, micro, percentAgrees, slackOf } from './calculate.js';
import type { Allowance, DocumentAllowance, InvoiceDraft, InvoiceType, VatCategory } from './model.js';

type Node = Record<string, any> | string | undefined;

// Every value stays a string, so "0042" or a postal code is not turned into a number; amounts are converted where
// they are read. Character references such as &#228; are decoded only with htmlEntities.
const parser = new XMLParser({ ignoreAttributes: false, removeNSPrefix: true, parseTagValue: false, htmlEntities: true });

/**
 * The percentage of a discount or charge, without its sign. Some generators repeat the minus of a credit note there:
 * 10 % off -100.00 is written as -10 % of -100.00 = -10.00. `signed` keeps whether it had one.
 */
function percentageOf(entry: Node): { percent?: number; signed: boolean } {
  const given = number(entry, 'CalculationPercent');
  return { percent: given === undefined ? undefined : Math.abs(given), signed: given !== undefined && given < 0 };
}

/** Every occurrence of a child element; the parser gives one as a value and several as an array. */
function all(node: Node, name: string): any[] {
  const value = typeof node === 'object' ? node[name] : undefined;
  return value === undefined ? [] : Array.isArray(value) ? value : [value];
}

/** Follows element names down from a node; where an element repeats, the first one counts. */
const at = (node: Node, ...path: string[]): any => path.reduce((n, name) => all(n, name)[0], node);

/** The text of an element, whether or not it carries attributes. Empty counts as absent. */
function text(node: Node, ...path: string[]): string | undefined {
  const element = at(node, ...path);
  const content = typeof element === 'object' ? element['#text'] : element;
  return content === undefined || content === '' ? undefined : String(content);
}

function number(node: Node, ...path: string[]): number | undefined {
  const value = text(node, ...path);
  return value === undefined ? undefined : Number(value);
}

/** CII dates are YYYYMMDD (format 102). Any other notation is passed on as it is and fails the date check. */
const date = (node: Node, ...path: string[]) => text(node, ...path, 'DateTimeString')?.replace(/^(\d{4})(\d{2})(\d{2})$/, '$1-$2-$3');

const attribute = (node: Node, name: string): string | undefined => (typeof node === 'object' ? node[`@_${name}`] : undefined);

function party(node: Node, who: 'seller' | 'buyer') {
  const address = at(node, 'PostalTradeAddress');
  const contact = at(node, 'DefinedTradeContact');
  const endpoint = at(node, 'URIUniversalCommunication', 'URIID');
  const taxIds = all(node, 'SpecifiedTaxRegistration').map((registration) => at(registration, 'ID'));
  const taxId = (scheme: string) => text(taxIds.find((id) => attribute(id, 'schemeID') === scheme));
  // The plain identifier is any number the party is known by (BT-29, BT-46), such as a customer number. It stands
  // in for a tax ID only where the seller has no registration, and only in the shape of one.
  const plainId = who === 'seller' && taxIds.length === 0 ? text(node, 'ID') : undefined;
  return {
    name: text(node, 'Name'),
    street: text(address, 'LineOne'),
    postalCode: text(address, 'PostcodeCode'),
    city: text(address, 'CityName'),
    country: text(address, 'CountryID'),
    // Without any tax registration, the plain identifier of the seller is its tax ID (see BR-O-02 in ubl.ts).
    vatId: taxId('VA') ?? (/^[A-Z]{2}[A-Z0-9]{2,12}$/.test(plainId ?? '') ? plainId : undefined),
    taxNumber: taxId('FC') ?? (/^\d[\d/ -]{7,}$/.test(plainId ?? '') ? plainId : undefined),
    email: text(contact, 'EmailURIUniversalCommunication', 'URIID') ?? (attribute(endpoint, 'schemeID') === 'EM' ? text(endpoint) : undefined),
    phone: text(contact, 'TelephoneUniversalCommunication', 'CompleteNumber'),
    contactName: text(contact, 'PersonName'),
  };
}

function line(item: Node) {
  const quantity = at(item, 'SpecifiedLineTradeDelivery', 'BilledQuantity');
  const settlement = at(item, 'SpecifiedLineTradeSettlement');
  return {
    name: text(item, 'SpecifiedTradeProduct', 'Name'),
    description: text(item, 'SpecifiedTradeProduct', 'Description'),
    quantity: number(quantity),
    unit: attribute(quantity, 'unitCode'),
    unitPrice: number(item, 'SpecifiedLineTradeAgreement', 'NetPriceProductTradePrice', 'ChargeAmount'),
    netAmount: number(settlement, 'SpecifiedTradeSettlementLineMonetarySummation', 'LineTotalAmount'),
    vatCategory: text(settlement, 'ApplicableTradeTax', 'CategoryCode') as VatCategory | undefined,
    // Category O states no rate at all.
    vatRate: number(settlement, 'ApplicableTradeTax', 'RateApplicablePercent') ?? 0,
  };
}

/**
 * A line with its discount. The model holds one discount on a line. Several of them, a surcharge or a price for
 * several units change the total in a way it cannot hold: such a line is `adjusted`. A discount whose percentage,
 * base and amount disagree in the XML `contradicts` itself (Peppol R040). Its percentage stays only where it gives the
 * amount from quantity times price as well, so that `check` does not report the same thing twice.
 */
function lineOf(item: Node, currency: string | undefined) {
  const read = line(item);
  const entries = all(at(item, 'SpecifiedLineTradeSettlement'), 'SpecifiedTradeAllowanceCharge');
  const perUnit = [undefined, 1].includes(number(item, 'SpecifiedLineTradeAgreement', 'NetPriceProductTradePrice', 'BasisQuantity'));
  const [entry] = entries;
  if (entries.length !== 1 || text(entry, 'ChargeIndicator', 'Indicator') !== 'false' || !perUnit) {
    return { line: read, adjusted: entries.length > 0 || !perUnit, contradicts: false };
  }
  const amount = number(entry, 'ActualAmount');
  const { percent, signed } = percentageOf(entry);
  const base = number(entry, 'BasisAmount');
  const slack = slackOf(currency);
  const agrees = (from: number | undefined, sign = 1) =>
    from !== undefined && percent !== undefined && amount !== undefined && percentAgrees(from, sign * percent, amount, slack);
  const ownBase = read.quantity !== undefined && read.unitPrice !== undefined ? lineBase(read.quantity, read.unitPrice) : undefined;
  const discount: Allowance = {
    ...(agrees(ownBase) ? { percent } : {}),
    ...(amount !== undefined ? { amount } : {}),
    reason: text(entry, 'Reason') ?? text(entry, 'ReasonCode'),
  };
  return {
    line: { ...read, discount },
    adjusted: false,
    contradicts: percent !== undefined && base !== undefined && !agrees(base) && !(signed && agrees(base, -1)),
  };
}

/**
 * The discounts and charges on the whole invoice (BG-20, BG-21), each with its own VAT category and rate and its amount
 * as signed in the XML. Its percentage stays only where it gives the amount from the lines of its VAT group as well;
 * else `percentages` keeps it, by the path of the entry, for the comparison with the page. An entry whose percentage,
 * base and amount disagree in the XML `contradicts` itself (Peppol R040), whatever the lines say.
 */
function adjustmentsOf(settlement: Node, lines: ReturnType<typeof line>[], currency: string | undefined) {
  const slack = slackOf(currency);
  const read = {
    discounts: [] as DocumentAllowance[],
    charges: [] as DocumentAllowance[],
    contradictions: [] as string[],
    percentages: {} as Record<string, number>,
  };
  for (const entry of all(settlement, 'SpecifiedTradeAllowanceCharge')) {
    const list = text(entry, 'ChargeIndicator', 'Indicator') === 'true' ? 'charges' : 'discounts';
    const path = `${list}.${read[list].length}`;
    const amount = number(entry, 'ActualAmount');
    const { percent, signed } = percentageOf(entry);
    const base = number(entry, 'BasisAmount');
    const vatCategory = text(entry, 'CategoryTradeTax', 'CategoryCode') as VatCategory | undefined;
    // Category O states no rate at all. Without any category (BR-32) there is no rate either, and no VAT group is guessed.
    const vatRate = number(entry, 'CategoryTradeTax', 'RateApplicablePercent') ?? (vatCategory !== undefined ? 0 : undefined);
    const agrees = (from: number | undefined, sign = 1) =>
      from !== undefined && percent !== undefined && amount !== undefined && percentAgrees(from, sign * percent, amount, slack);
    const group = lines.filter((l) => l.vatCategory === vatCategory && l.vatRate === vatRate);
    // Summed in millionths, never in floating point euros.
    const ownBase = group.every((l) => l.netAmount !== undefined) ? Number(group.reduce((sum, l) => sum + micro(l.netAmount!), 0n)) / 1e6 : undefined;
    if (percent !== undefined && base !== undefined && !agrees(base) && !(signed && agrees(base, -1))) read.contradictions.push(`${path}.percent`);
    else if (percent !== undefined && !agrees(ownBase)) read.percentages[path] = percent;
    read[list].push({
      ...(agrees(ownBase) ? { percent } : {}),
      ...(amount !== undefined ? { amount } : {}),
      reason: text(entry, 'Reason') ?? text(entry, 'ReasonCode'),
      vatCategory,
      vatRate,
    });
  }
  return read;
}

/**
 * Reads a UN/CEFACT Cross Industry Invoice (the XML inside a ZUGFeRD 2 / Factur-X PDF) into the invoice model: the
 * inverse of what `createEInvoice` writes. `profile` is the specification identifier (BT-24). `totals` holds the
 * totals the XML states, so `check` reports them when they contradict the lines. `adjustedLines` counts from 0 the
 * lines whose total the XML explains by what the model does not hold: more than one discount, a surcharge or a price
 * for several units. `contradictions` names the discounts and charges whose percentage, base and amount disagree in
 * the XML, by path. `percentages` holds, by the path of the entry, the percentage of a discount or charge on the whole
 * invoice that the data leaves out because it does not give the amount from the lines; pass it on to `check`.
 * Throws if the XML is not well-formed or not a Cross Industry Invoice.
 */
export function readInvoiceXml(xml: string): {
  profile?: string;
  invoice: InvoiceDraft;
  adjustedLines: number[];
  contradictions: string[];
  percentages: Record<string, number>;
} {
  let root: Node;
  try {
    root = parser.parse(xml, true).CrossIndustryInvoice;
  } catch (e) {
    throw new Error(`The XML is not well-formed (${e instanceof Error ? e.message : String(e)}).`, { cause: e });
  }
  if (root === undefined) {
    throw new Error(
      'The XML is not a UN/CEFACT Cross Industry Invoice (root element rsm:CrossIndustryInvoice). UBL invoices and ZUGFeRD 1 files are not supported.',
    );
  }

  const document = at(root, 'ExchangedDocument');
  const transaction = at(root, 'SupplyChainTradeTransaction');
  const agreement = at(transaction, 'ApplicableHeaderTradeAgreement');
  const settlement = at(transaction, 'ApplicableHeaderTradeSettlement');
  const means = at(settlement, 'SpecifiedTradeSettlementPaymentMeans');
  const terms = at(settlement, 'SpecifiedTradePaymentTerms');
  const preceding = at(settlement, 'InvoiceReferencedDocument');
  const sums = at(settlement, 'SpecifiedTradeSettlementHeaderMonetarySummation');
  const currency = text(settlement, 'InvoiceCurrencyCode');
  // The VAT total may be given a second time in the accounting currency (BT-111); the one in the invoice currency counts.
  const vatTotals = all(sums, 'TaxTotalAmount');
  const notes = all(document, 'IncludedNote').map((note) => text(note, 'Content'));
  const lines = all(transaction, 'IncludedSupplyChainTradeLineItem').map((item) => lineOf(item, currency));
  const { discounts, charges, contradictions, percentages } = adjustmentsOf(
    settlement,
    lines.map((read) => read.line),
    currency,
  );

  return {
    profile: text(root, 'ExchangedDocumentContext', 'GuidelineSpecifiedDocumentContextParameter', 'ID'),
    adjustedLines: lines.flatMap((read, i) => (read.adjusted ? [i] : [])),
    contradictions: [...lines.flatMap((read, i) => (read.contradicts ? [`lines.${i}.discount.percent`] : [])), ...contradictions],
    percentages,
    invoice: {
      number: text(document, 'ID'),
      issueDate: date(document, 'IssueDateTime'),
      typeCode: text(document, 'TypeCode') as InvoiceType | undefined,
      currency,
      dueDate: date(terms, 'DueDateDateTime'),
      deliveryDate: date(transaction, 'ApplicableHeaderTradeDelivery', 'ActualDeliverySupplyChainEvent', 'OccurrenceDateTime'),
      deliveryCountry: text(transaction, 'ApplicableHeaderTradeDelivery', 'ShipToTradeParty', 'PostalTradeAddress', 'CountryID'),
      periodStart: date(settlement, 'BillingSpecifiedPeriod', 'StartDateTime'),
      periodEnd: date(settlement, 'BillingSpecifiedPeriod', 'EndDateTime'),
      buyerReference: text(agreement, 'BuyerReference'),
      orderReference: text(agreement, 'BuyerOrderReferencedDocument', 'IssuerAssignedID'),
      precedingInvoiceNumber: text(preceding, 'IssuerAssignedID'),
      precedingInvoiceDate: date(preceding, 'FormattedIssueDateTime'),
      note: notes.filter(Boolean).join('\n') || undefined,
      paymentTerms: text(terms, 'Description'),
      iban: text(means, 'PayeePartyCreditorFinancialAccount', 'IBANID'),
      bic: text(means, 'PayeeSpecifiedCreditorFinancialInstitution', 'BICID'),
      // EN 16931 accepts the reason as text (BT-120) or as a code (BT-121).
      vatExemptionReason: all(settlement, 'ApplicableTradeTax')
        .map((tax) => text(tax, 'ExemptionReason') ?? text(tax, 'ExemptionReasonCode'))
        .find(Boolean),
      prepaidAmount: number(sums, 'TotalPrepaidAmount'),
      seller: party(at(agreement, 'SellerTradeParty'), 'seller'),
      buyer: party(at(agreement, 'BuyerTradeParty'), 'buyer'),
      lines: lines.map((read) => read.line),
      ...(discounts.length ? { discounts } : {}),
      ...(charges.length ? { charges } : {}),
      totals: {
        net: number(sums, 'TaxBasisTotalAmount'),
        vat: number(vatTotals.find((total) => attribute(total, 'currencyID') === currency) ?? vatTotals[0]),
        gross: number(sums, 'GrandTotalAmount'),
        due: number(sums, 'DuePayableAmount'),
      },
    },
  };
}
