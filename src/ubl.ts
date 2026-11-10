import type { Invoice as EInvoiceEuInvoice } from '@e-invoice-eu/core';
import type { Totals } from './calculate.js';
import type { Invoice, Party } from './model.js';

type Bag = Record<string, unknown>;

const amount = (n: number) => n.toFixed(2);
/** Quantities and prices keep their precision; no exponent, no trailing zeros. */
const decimal = (n: number) => n.toFixed(6).replace(/\.?0+$/, '');
/** A unit price may be finer than a cent: two decimals at least, six at most. */
const price = (n: number) => n.toFixed(6).replace(/0{1,4}$/, '');
const VAT = { 'cbc:ID': 'VAT' };

/** Removes keys whose value is undefined, so optional elements simply do not appear. */
function compact<T extends Bag>(object: T): T {
  return Object.fromEntries(Object.entries(object).filter(([, v]) => v !== undefined)) as T;
}

function address(p: Party): Bag {
  return compact({
    'cbc:StreetName': p.street,
    'cbc:CityName': p.city,
    'cbc:PostalZone': p.postalCode,
    'cac:Country': { 'cbc:IdentificationCode': p.country },
  });
}

function contact(p: Party): Bag | undefined {
  if (!p.contactName && !p.phone && !p.email) return undefined;
  return compact({ 'cbc:Name': p.contactName, 'cbc:Telephone': p.phone, 'cbc:ElectronicMail': p.email });
}

/**
 * Maps the invoice to the input format of @e-invoice-eu/core (UBL element
 * names as JSON keys), which writes the XML. Amounts come from `totals`;
 * nothing is calculated here. With `xrechnung` the result also meets what
 * the XRechnung rules ask of the XML; what they ask of the data, `check`
 * reports.
 */
export function toUbl(invoice: Invoice, totals: Totals, xrechnung = false): EInvoiceEuInvoice {
  const { seller, buyer, currency } = invoice;
  const money = (key: string, n: number) => ({ [key]: amount(n), [`${key}@currencyID`]: currency });
  const categories = new Set(invoice.lines.map((l) => l.vatCategory));
  // BR-O-02: an invoice that is not subject to VAT must not carry VAT identifiers.
  const vatIdsAllowed = !categories.has('O');

  const taxCategory = (category: string, rate: number, breakdown: boolean) =>
    compact({
      'cbc:ID': category,
      // BR-O-05: no rate at all where VAT does not apply. XRechnung wants one in every VAT breakdown all the same (BR-DE-14).
      'cbc:Percent': category === 'O' && !(xrechnung && breakdown) ? undefined : decimal(rate),
      'cbc:TaxExemptionReason': breakdown && category !== 'S' && category !== 'Z' ? invoice.vatExemptionReason : undefined,
      'cac:TaxScheme': VAT,
    });

  const sellerTaxSchemes = [
    vatIdsAllowed && seller.vatId ? { 'cbc:CompanyID': seller.vatId, 'cac:TaxScheme': VAT } : undefined,
    seller.taxNumber ? { 'cbc:CompanyID': seller.taxNumber, 'cac:TaxScheme': { 'cbc:ID': 'FC' } } : undefined,
  ].filter(Boolean);
  // BR-CO-26 wants a seller identifier, legal registration or VAT ID. Where no VAT ID is given
  // (or allowed), the tax identifier the invoice prints is passed on as the plain seller identifier.
  const sellerIdentifier = vatIdsAllowed && seller.vatId ? undefined : (seller.vatId ?? seller.taxNumber);

  // The country of supply follows from the VAT treatment: where VAT is charged (or exempt) at home it is the
  // seller's country, otherwise the buyer's. It is stated for intra-community supplies (BR-IC-12) and whenever
  // there is no delivery date (ZUGFeRD rule BR-FX-DE-04; it also keeps the mandatory delivery element from being empty).
  // Not so in an XRechnung: a place of delivery there needs its city and postal code (BR-DE-10, BR-DE-11), which the
  // data does not have. `check` refuses an intra-community supply for that reason.
  const suppliedAtHome = !categories.has('K') && ['S', 'Z', 'E'].some((c) => categories.has(c as 'S'));
  const stateCountry = !xrechnung && (categories.has('K') || !invoice.deliveryDate);
  const delivery = compact({
    'cbc:ActualDeliveryDate': invoice.deliveryDate,
    'cac:DeliveryLocation': stateCountry
      ? { 'cac:Address': { 'cac:Country': { 'cbc:IdentificationCode': suppliedAtHome ? seller.country : buyer.country } } }
      : undefined,
  });

  const document = compact({
    'cbc:ID': invoice.number,
    'cbc:IssueDate': invoice.issueDate,
    'cbc:DueDate': invoice.dueDate,
    'cbc:InvoiceTypeCode': invoice.typeCode,
    'cbc:Note': invoice.note,
    'cbc:DocumentCurrencyCode': currency,
    'cbc:BuyerReference': invoice.buyerReference,
    'cac:InvoicePeriod':
      invoice.periodStart || invoice.periodEnd ? compact({ 'cbc:StartDate': invoice.periodStart, 'cbc:EndDate': invoice.periodEnd }) : undefined,
    'cac:OrderReference': invoice.orderReference ? { 'cbc:ID': invoice.orderReference } : undefined,
    'cac:BillingReference': invoice.precedingInvoiceNumber
      ? [{ 'cac:InvoiceDocumentReference': compact({ 'cbc:ID': invoice.precedingInvoiceNumber, 'cbc:IssueDate': invoice.precedingInvoiceDate }) }]
      : undefined,
    'cac:AccountingSupplierParty': {
      'cac:Party': compact({
        'cbc:EndpointID': seller.email,
        'cbc:EndpointID@schemeID': seller.email ? 'EM' : undefined,
        'cac:PartyIdentification': sellerIdentifier ? [{ 'cbc:ID': sellerIdentifier }] : undefined,
        'cac:PostalAddress': address(seller),
        'cac:PartyTaxScheme': sellerTaxSchemes.length ? sellerTaxSchemes : undefined,
        'cac:PartyLegalEntity': { 'cbc:RegistrationName': seller.name },
        'cac:Contact': contact(seller),
      }),
    },
    'cac:AccountingCustomerParty': {
      'cac:Party': compact({
        'cbc:EndpointID': buyer.email,
        'cbc:EndpointID@schemeID': buyer.email ? 'EM' : undefined,
        'cac:PostalAddress': address(buyer),
        'cac:PartyTaxScheme': vatIdsAllowed && buyer.vatId ? { 'cbc:CompanyID': buyer.vatId, 'cac:TaxScheme': VAT } : undefined,
        'cac:PartyLegalEntity': { 'cbc:RegistrationName': buyer.name },
        'cac:Contact': contact(buyer),
      }),
    },
    'cac:Delivery': Object.keys(delivery).length ? delivery : undefined,
    'cac:PaymentMeans': invoice.iban
      ? [
          {
            'cbc:PaymentMeansCode': '58', // SEPA credit transfer
            'cac:PayeeFinancialAccount': compact({
              'cbc:ID': invoice.iban,
              'cac:FinancialInstitutionBranch': invoice.bic ? { 'cbc:ID': invoice.bic } : undefined,
            }),
          },
        ]
      : xrechnung
        ? [{ 'cbc:PaymentMeansCode': '1' }] // BR-DE-1 wants payment instructions in every XRechnung; without an account they say "instrument not defined"
        : undefined,
    // XRechnung reads a line that starts with # as a cash discount and wants a line break after it (BR-DE-18).
    'cac:PaymentTerms': invoice.paymentTerms
      ? { 'cbc:Note': xrechnung && /^\s*#/m.test(invoice.paymentTerms) ? `${invoice.paymentTerms}\n` : invoice.paymentTerms }
      : undefined,
    'cac:TaxTotal': [
      {
        ...money('cbc:TaxAmount', totals.vat),
        'cac:TaxSubtotal': totals.vatBreakdown.map((group) => ({
          ...money('cbc:TaxableAmount', group.taxable),
          ...money('cbc:TaxAmount', group.tax),
          'cac:TaxCategory': taxCategory(group.category, group.rate, true),
        })),
      },
    ],
    'cac:LegalMonetaryTotal': compact({
      ...money('cbc:LineExtensionAmount', totals.net),
      ...money('cbc:TaxExclusiveAmount', totals.net),
      ...money('cbc:TaxInclusiveAmount', totals.gross),
      ...(totals.prepaid ? money('cbc:PrepaidAmount', totals.prepaid) : {}),
      ...money('cbc:PayableAmount', totals.due),
    }),
    'cac:InvoiceLine': invoice.lines.map((line, i) => ({
      'cbc:ID': String(i + 1),
      'cbc:InvoicedQuantity': decimal(line.quantity),
      'cbc:InvoicedQuantity@unitCode': line.unit,
      ...money('cbc:LineExtensionAmount', totals.lineNet[i]!),
      'cac:Item': compact({
        'cbc:Description': line.description,
        'cbc:Name': line.name,
        'cac:ClassifiedTaxCategory': taxCategory(line.vatCategory, line.vatRate, false),
      }),
      'cac:Price': { 'cbc:PriceAmount': price(line.unitPrice), 'cbc:PriceAmount@currencyID': currency },
    })),
  });

  return { 'ubl:Invoice': document } as unknown as EInvoiceEuInvoice;
}
