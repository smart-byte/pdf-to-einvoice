import { XMLParser } from 'fast-xml-parser';
import type { InvoiceDraft, InvoiceType, VatCategory } from './model.js';

type Node = Record<string, any> | string | undefined;

// Every value stays a string, so "0042" or a postal code is not turned into a number; amounts are converted where
// they are read. Character references such as &#228; are decoded only with htmlEntities.
const parser = new XMLParser({ ignoreAttributes: false, removeNSPrefix: true, parseTagValue: false, htmlEntities: true });

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

function party(node: Node) {
  const address = at(node, 'PostalTradeAddress');
  const contact = at(node, 'DefinedTradeContact');
  const endpoint = at(node, 'URIUniversalCommunication', 'URIID');
  const taxIds = all(node, 'SpecifiedTaxRegistration').map((registration) => at(registration, 'ID'));
  const taxId = (scheme: string) => text(taxIds.find((id) => attribute(id, 'schemeID') === scheme));
  const plainId = text(node, 'ID');
  return {
    name: text(node, 'Name'),
    street: text(address, 'LineOne'),
    postalCode: text(address, 'PostcodeCode'),
    city: text(address, 'CityName'),
    country: text(address, 'CountryID'),
    // Without any tax registration, the plain party identifier is the tax ID (see BR-O-02 in ubl.ts).
    vatId: taxId('VA') ?? (taxIds.length === 0 && /^[A-Z]{2}[A-Z0-9]{2,12}$/.test(plainId ?? '') ? plainId : undefined),
    taxNumber: taxId('FC') ?? (taxIds.length === 0 && !/^[A-Z]{2}[A-Z0-9]{2,12}$/.test(plainId ?? '') ? plainId : undefined),
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

/** Whether a line states what the invoice model cannot hold and what changes its total: a discount, a surcharge, or a price for several units. */
const adjusted = (item: Node) =>
  all(at(item, 'SpecifiedLineTradeSettlement'), 'SpecifiedTradeAllowanceCharge').length > 0 ||
  ![undefined, 1].includes(number(item, 'SpecifiedLineTradeAgreement', 'NetPriceProductTradePrice', 'BasisQuantity'));

/**
 * Reads a UN/CEFACT Cross Industry Invoice (the XML inside a ZUGFeRD 2 / Factur-X PDF) into the invoice model: the
 * inverse of what `createEInvoice` writes. `profile` is the specification identifier (BT-24). `totals` holds the
 * totals the XML states, so `check` reports them when they contradict the lines. `adjustedLines` counts from 0 the
 * lines whose total the XML explains by a discount, a surcharge or a price for several units, which the model does
 * not hold. Throws if the XML is not well-formed or not a Cross Industry Invoice.
 */
export function readInvoiceXml(xml: string): { profile?: string; invoice: InvoiceDraft; adjustedLines: number[] } {
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
  const items = all(transaction, 'IncludedSupplyChainTradeLineItem');

  // Known limit: document-level allowances and charges (BG-20, BG-21) are not in the model, so an invoice that has them
  // shows up in `check` as totals-mismatch. Add them to the model and to `calculate` when such invoices matter.
  return {
    profile: text(root, 'ExchangedDocumentContext', 'GuidelineSpecifiedDocumentContextParameter', 'ID'),
    adjustedLines: items.flatMap((item, i) => (adjusted(item) ? [i] : [])),
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
      seller: party(at(agreement, 'SellerTradeParty')),
      buyer: party(at(agreement, 'BuyerTradeParty')),
      lines: items.map(line),
      totals: {
        net: number(sums, 'TaxBasisTotalAmount'),
        vat: number(vatTotals.find((total) => attribute(total, 'currencyID') === currency) ?? vatTotals[0]),
        gross: number(sums, 'GrandTotalAmount'),
        due: number(sums, 'DuePayableAmount'),
      },
    },
  };
}
