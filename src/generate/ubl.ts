import type { Invoice as EInvoiceEuInvoice } from '@e-invoice-eu/core';
import type { Adjustment, Totals } from '../domain/calculate.js';
import type { Invoice, Line, Party, VatCategory } from '../domain/model.js';

/** A part of the UBL document as @e-invoice-eu/core takes it: element names as keys, `name@attribute` for attributes. */
type UblElement = Record<string, unknown>;

const amount = (n: number) => n.toFixed(2);
/** Quantities and prices keep their precision; no exponent, no trailing zeros. */
const decimal = (n: number) => n.toFixed(6).replace(/\.?0+$/, '');
/** A unit price may be finer than a cent: two decimals at least, six at most. */
const price = (n: number) => n.toFixed(6).replace(/0{1,4}$/, '');
const VAT = { 'cbc:ID': 'VAT' };

/** Removes keys whose value is undefined, so optional elements simply do not appear. */
function compact<T extends UblElement>(object: T): T {
  return Object.fromEntries(Object.entries(object).filter(([, v]) => v !== undefined)) as T;
}

function address(p: Party): UblElement {
  return compact({
    'cbc:StreetName': p.street,
    'cbc:CityName': p.city,
    'cbc:PostalZone': p.postalCode,
    'cac:Country': { 'cbc:IdentificationCode': p.country },
  });
}

function contact(p: Party): UblElement | undefined {
  if (!p.contactName && !p.phone && !p.email) return undefined;
  return compact({ 'cbc:Name': p.contactName, 'cbc:Telephone': p.phone, 'cbc:ElectronicMail': p.email });
}

/** What every part of the document needs: the invoice, its totals, and what follows from them. */
interface Context {
  invoice: Invoice;
  totals: Totals;
  xrechnung: boolean;
  /** Every VAT category of the invoice; a discount or charge on the whole invoice may bring one of its own. */
  categories: Set<VatCategory>;
  /** BR-O-02: an invoice that is not subject to VAT must not carry VAT identifiers. */
  vatIdsAllowed: boolean;
}

/** An amount with its currency, as two keys: the element and its attribute. */
const amountElement = (ctx: Context, key: string, n: number) => ({
  [key]: amount(n),
  [`${key}@currencyID`]: ctx.invoice.currency,
});

/**
 * Maps the invoice to the input format of @e-invoice-eu/core (UBL element
 * names as JSON keys), which writes the XML. Amounts come from `totals`;
 * nothing is calculated here. With `xrechnung` the result also meets what
 * the XRechnung rules ask of the XML; what they ask of the data, `check`
 * reports. The keys stand in the order UBL wants the elements.
 */
export function toUbl(invoice: Invoice, totals: Totals, xrechnung = false): EInvoiceEuInvoice {
  const categories = new Set([
    ...invoice.lines.map((l) => l.vatCategory),
    ...totals.adjustments.map((a) => a.category),
  ]);
  const ctx: Context = { invoice, totals, xrechnung, categories, vatIdsAllowed: !categories.has('O') };
  const delivery = deliveryOf(ctx);

  const document = compact({
    'cbc:ID': invoice.number,
    'cbc:IssueDate': invoice.issueDate,
    'cbc:DueDate': invoice.dueDate,
    'cbc:InvoiceTypeCode': invoice.typeCode,
    'cbc:Note': invoice.note,
    'cbc:DocumentCurrencyCode': invoice.currency,
    'cbc:BuyerReference': invoice.buyerReference,
    'cac:InvoicePeriod':
      invoice.periodStart || invoice.periodEnd
        ? compact({ 'cbc:StartDate': invoice.periodStart, 'cbc:EndDate': invoice.periodEnd })
        : undefined,
    'cac:OrderReference': invoice.orderReference ? { 'cbc:ID': invoice.orderReference } : undefined,
    'cac:BillingReference': invoice.precedingInvoiceNumber
      ? [
          {
            'cac:InvoiceDocumentReference': compact({
              'cbc:ID': invoice.precedingInvoiceNumber,
              'cbc:IssueDate': invoice.precedingInvoiceDate,
            }),
          },
        ]
      : undefined,
    'cac:AccountingSupplierParty': { 'cac:Party': supplierParty(ctx) },
    'cac:AccountingCustomerParty': { 'cac:Party': customerParty(ctx) },
    'cac:Delivery': Object.keys(delivery).length ? delivery : undefined,
    'cac:PaymentMeans': paymentMeans(ctx),
    'cac:PaymentTerms': paymentTerms(ctx),
    'cac:AllowanceCharge': ctx.totals.adjustments.length
      ? ctx.totals.adjustments.map((a) => documentAllowance(ctx, a))
      : undefined,
    'cac:TaxTotal': [taxTotal(ctx)],
    'cac:LegalMonetaryTotal': monetaryTotal(ctx),
    'cac:InvoiceLine': invoice.lines.map((line, i) => invoiceLine(ctx, line, i)),
  });

  return { 'ubl:Invoice': document } as unknown as EInvoiceEuInvoice;
}

function taxCategory(ctx: Context, category: string, rate: number, breakdown: boolean): UblElement {
  return compact({
    'cbc:ID': category,
    // BR-O-05: no rate at all where VAT does not apply. XRechnung wants one in every VAT breakdown all the same (BR-DE-14).
    'cbc:Percent': category === 'O' && !(ctx.xrechnung && breakdown) ? undefined : decimal(rate),
    'cbc:TaxExemptionReason':
      breakdown && category !== 'S' && category !== 'Z' ? ctx.invoice.vatExemptionReason : undefined,
    'cac:TaxScheme': VAT,
  });
}

function supplierParty({ invoice: { seller }, vatIdsAllowed }: Context): UblElement {
  const taxSchemes = [
    vatIdsAllowed && seller.vatId ? { 'cbc:CompanyID': seller.vatId, 'cac:TaxScheme': VAT } : undefined,
    seller.taxNumber ? { 'cbc:CompanyID': seller.taxNumber, 'cac:TaxScheme': { 'cbc:ID': 'FC' } } : undefined,
  ].filter(Boolean);
  // BR-CO-26 wants a seller identifier, legal registration or VAT ID. Where no VAT ID is given
  // (or allowed), the tax identifier the invoice prints is passed on as the plain seller identifier.
  const identifier = vatIdsAllowed && seller.vatId ? undefined : (seller.vatId ?? seller.taxNumber);
  return compact({
    'cbc:EndpointID': seller.email,
    'cbc:EndpointID@schemeID': seller.email ? 'EM' : undefined,
    'cac:PartyIdentification': identifier ? [{ 'cbc:ID': identifier }] : undefined,
    'cac:PostalAddress': address(seller),
    'cac:PartyTaxScheme': taxSchemes.length ? taxSchemes : undefined,
    'cac:PartyLegalEntity': { 'cbc:RegistrationName': seller.name },
    'cac:Contact': contact(seller),
  });
}

function customerParty({ invoice: { buyer }, vatIdsAllowed }: Context): UblElement {
  return compact({
    'cbc:EndpointID': buyer.email,
    'cbc:EndpointID@schemeID': buyer.email ? 'EM' : undefined,
    'cac:PostalAddress': address(buyer),
    'cac:PartyTaxScheme':
      vatIdsAllowed && buyer.vatId ? { 'cbc:CompanyID': buyer.vatId, 'cac:TaxScheme': VAT } : undefined,
    'cac:PartyLegalEntity': { 'cbc:RegistrationName': buyer.name },
    'cac:Contact': contact(buyer),
  });
}

/**
 * The date of delivery, and the country of delivery where the data states it. Only an intra-community supply has to
 * name one (BR-IC-12): there the country of the buyer stands in, and `check` asks about that assumption. Nothing else
 * is assumed, so an invoice without a delivery date and a country of delivery has an empty delivery element, as
 * official samples of the standard have; a validator may remark on the empty element.
 * Not so in an XRechnung: a place of delivery there needs its city and postal code (BR-DE-10, BR-DE-11), which the
 * data does not have. `check` refuses an intra-community supply for that reason.
 */
function deliveryOf({ invoice, xrechnung, categories }: Context): UblElement {
  const stateCountry = !xrechnung && (categories.has('K') || invoice.deliveryCountry !== undefined);
  return compact({
    'cbc:ActualDeliveryDate': invoice.deliveryDate,
    'cac:DeliveryLocation': stateCountry
      ? {
          'cac:Address': {
            'cac:Country': { 'cbc:IdentificationCode': invoice.deliveryCountry ?? invoice.buyer.country },
          },
        }
      : undefined,
  });
}

function paymentMeans({ invoice, xrechnung }: Context): UblElement[] | undefined {
  if (invoice.iban) {
    return [
      {
        'cbc:PaymentMeansCode': '58', // SEPA credit transfer
        'cac:PayeeFinancialAccount': compact({
          'cbc:ID': invoice.iban,
          'cac:FinancialInstitutionBranch': invoice.bic ? { 'cbc:ID': invoice.bic } : undefined,
        }),
      },
    ];
  }
  // BR-DE-1 wants payment instructions in every XRechnung; without an account they say "instrument not defined".
  return xrechnung ? [{ 'cbc:PaymentMeansCode': '1' }] : undefined;
}

/** XRechnung reads a line that starts with # as a cash discount and wants a line break after it (BR-DE-18). */
function paymentTerms({ invoice: { paymentTerms: terms }, xrechnung }: Context): UblElement | undefined {
  if (!terms) return undefined;
  return { 'cbc:Note': xrechnung && /^\s*#/m.test(terms) ? `${terms}\n` : terms };
}

/** One for each VAT group a discount or charge on the whole invoice goes into. A reason in words stands alone, as on a line. */
function documentAllowance(ctx: Context, a: Adjustment): UblElement {
  return compact({
    'cbc:ChargeIndicator': String(a.list === 'charges'),
    'cbc:AllowanceChargeReasonCode': a.reason || a.list === 'charges' ? undefined : '95',
    'cbc:AllowanceChargeReason': a.reason,
    'cbc:MultiplierFactorNumeric': a.percent !== undefined ? decimal(a.percent) : undefined,
    ...amountElement(ctx, 'cbc:Amount', a.amount),
    ...(a.base !== undefined ? amountElement(ctx, 'cbc:BaseAmount', a.base) : {}),
    'cac:TaxCategory': taxCategory(ctx, a.category, a.rate, false),
  });
}

function taxTotal(ctx: Context): UblElement {
  return {
    ...amountElement(ctx, 'cbc:TaxAmount', ctx.totals.vat),
    'cac:TaxSubtotal': ctx.totals.vatBreakdown.map((group) => ({
      ...amountElement(ctx, 'cbc:TaxableAmount', group.taxable),
      ...amountElement(ctx, 'cbc:TaxAmount', group.tax),
      'cac:TaxCategory': taxCategory(ctx, group.category, group.rate, true),
    })),
  };
}

function monetaryTotal(ctx: Context): UblElement {
  const { totals } = ctx;
  return compact({
    ...amountElement(ctx, 'cbc:LineExtensionAmount', totals.lineTotal),
    ...amountElement(ctx, 'cbc:TaxExclusiveAmount', totals.net),
    ...amountElement(ctx, 'cbc:TaxInclusiveAmount', totals.gross),
    // Written whenever there is a discount or charge, even at 0.00 (BR-CO-11, BR-CO-12).
    ...(totals.adjustments.some((a) => a.list === 'discounts')
      ? amountElement(ctx, 'cbc:AllowanceTotalAmount', totals.allowances)
      : {}),
    ...(totals.adjustments.some((a) => a.list === 'charges')
      ? amountElement(ctx, 'cbc:ChargeTotalAmount', totals.charges)
      : {}),
    ...(totals.prepaid ? amountElement(ctx, 'cbc:PrepaidAmount', totals.prepaid) : {}),
    ...amountElement(ctx, 'cbc:PayableAmount', totals.due),
  });
}

function invoiceLine(ctx: Context, line: Line, i: number): UblElement {
  return {
    'cbc:ID': String(i + 1),
    'cbc:InvoicedQuantity': decimal(line.quantity),
    'cbc:InvoicedQuantity@unitCode': line.unit,
    ...amountElement(ctx, 'cbc:LineExtensionAmount', ctx.totals.lineNet[i]!),
    ...(line.discount ? { 'cac:AllowanceCharge': [lineDiscount(ctx, line.discount, i)] } : {}),
    'cac:Item': compact({
      'cbc:Description': line.description,
      'cbc:Name': line.name,
      'cac:ClassifiedTaxCategory': taxCategory(ctx, line.vatCategory, line.vatRate, false),
    }),
    'cac:Price': { 'cbc:PriceAmount': price(line.unitPrice), 'cbc:PriceAmount@currencyID': ctx.invoice.currency },
  };
}

function lineDiscount(ctx: Context, discount: NonNullable<Line['discount']>, i: number): UblElement {
  const calculated = ctx.totals.lineDiscounts[i]!;
  return compact({
    'cbc:ChargeIndicator': 'false',
    // A reason in words stands alone: a code beside it would have to name the same kind of discount (BR-CO-7).
    'cbc:AllowanceChargeReasonCode': discount.reason ? undefined : '95',
    'cbc:AllowanceChargeReason': discount.reason,
    'cbc:MultiplierFactorNumeric': discount.percent !== undefined ? decimal(discount.percent) : undefined,
    ...amountElement(ctx, 'cbc:Amount', calculated.amount),
    ...(discount.percent !== undefined ? amountElement(ctx, 'cbc:BaseAmount', calculated.base) : {}),
  });
}
