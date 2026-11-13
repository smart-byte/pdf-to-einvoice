/**
 * The invoice data model: deliberately small and flat so that people, forms
 * and language models can fill it in. "BT-n" refers to the business terms of
 * EN 16931-1.
 */

/** VAT category codes (UNTDID 5305 subset used by EN 16931). */
export const VAT_CATEGORIES = {
  S: 'Standard rate',
  Z: 'Zero rated',
  E: 'Exempt from VAT',
  AE: 'Reverse charge',
  K: 'Intra-community supply',
  G: 'Export outside the EU',
  O: 'Not subject to VAT',
} as const;
export type VatCategory = keyof typeof VAT_CATEGORIES;

/** Invoice type codes (UNTDID 1001 subset). */
export const INVOICE_TYPES = {
  '380': 'Invoice',
  '381': 'Credit note',
  '384': 'Corrected invoice',
  '389': 'Self-billed invoice',
  '326': 'Partial invoice',
  '386': 'Prepayment invoice',
} as const;
export type InvoiceType = keyof typeof INVOICE_TYPES;

export interface Party {
  /** Full legal name (seller BT-27, buyer BT-44). */
  name: string;
  street?: string;
  postalCode?: string;
  city?: string;
  /** ISO 3166-1 alpha-2 country code, e.g. "DE" (BT-40 / BT-55). */
  country: string;
  /** VAT identifier with country prefix, e.g. "DE123456789" (BT-31 / BT-48). */
  vatId?: string;
  /** Local tax number, seller only (BT-32). */
  taxNumber?: string;
  email?: string;
  phone?: string;
  contactName?: string;
}

/** A discount or charge: a percentage of its base, an amount, or both. */
export interface Allowance {
  /** Percentage of the base, e.g. 10 (BT-138). Not negative. */
  percent?: number;
  /** Amount (BT-136), signed as in the standard: the line total is its base less this amount. */
  amount?: number;
  /** Reason as printed, e.g. "Treuerabatt" (BT-139). */
  reason?: string;
}

export interface Line {
  /** What was sold (BT-153). */
  name: string;
  description?: string;
  /** Invoiced quantity (BT-129). Negative on credit notes. */
  quantity: number;
  /** UN/ECE Rec. 20 unit code (BT-130): C62 = piece, HUR = hour, DAY = day. */
  unit: string;
  /** Net price per unit, without VAT (BT-146). Never negative. */
  unitPrice: number;
  /** Net line total (BT-131). Defaults to quantity x unitPrice less the discount. */
  netAmount?: number;
  /** Discount on the line (BG-27); its base is quantity x unitPrice. */
  discount?: Allowance;
  vatCategory: VatCategory;
  /** VAT rate in percent, e.g. 19 (BT-152). 0 for every category except S. */
  vatRate: number;
}

/** The amounts printed on the PDF. Used only to detect contradictions. */
export interface PrintedTotals {
  net?: number;
  vat?: number;
  gross?: number;
  due?: number;
}

export interface Invoice {
  /** Invoice number (BT-1). */
  number: string;
  /** Issue date, YYYY-MM-DD (BT-2). */
  issueDate: string;
  typeCode: InvoiceType;
  /** ISO 4217 currency code (BT-5). */
  currency: string;
  dueDate?: string;
  /** Date of delivery / service (BT-72). */
  deliveryDate?: string;
  /** Country the goods or services went to, ISO 3166-1 alpha-2 (BT-80). Without it the country is assumed from the VAT treatment. */
  deliveryCountry?: string;
  /** Service period, alternative to deliveryDate (BT-73, BT-74). */
  periodStart?: string;
  periodEnd?: string;
  /** Reference given by the buyer; the Leitweg-ID in German public procurement (BT-10). */
  buyerReference?: string;
  /** Purchase order number (BT-13). */
  orderReference?: string;
  /** Number and date of the invoice this one corrects or cancels (BT-25, BT-26). */
  precedingInvoiceNumber?: string;
  precedingInvoiceDate?: string;
  /** Free text note (BT-22). */
  note?: string;
  paymentTerms?: string;
  iban?: string;
  bic?: string;
  /** Why no VAT is charged; required for every category except S and Z (BT-120). */
  vatExemptionReason?: string;
  /** Amount already paid (BT-113). */
  prepaidAmount?: number;
  seller: Party;
  buyer: Party;
  lines: Line[];
  totals?: PrintedTotals;
}

type Draft<T> = T extends (infer U)[] ? Draft<U>[] : T extends object ? { [K in keyof T]?: Draft<T[K]> | null } : T;

/** Invoice data that may still be incomplete, e.g. straight from an extraction. */
export type InvoiceDraft = Draft<Invoice>;

const date = (description: string) => ({
  type: 'string',
  pattern: '^\\d{4}-\\d{2}-\\d{2}$',
  description: `${description} Format YYYY-MM-DD.`,
});
const text = (description: string) => ({ type: 'string', description });
const amount = (description: string) => ({ type: 'number', description });

const party = (who: string, extra: Record<string, unknown> = {}) => ({
  type: 'object',
  additionalProperties: false,
  required: ['name', 'country'],
  properties: {
    name: text(`Full legal name of the ${who}.`),
    street: text('Street and house number.'),
    postalCode: text('Postal code.'),
    city: text('City.'),
    country: {
      type: 'string',
      pattern: '^[A-Z]{2}$',
      description: 'ISO 3166-1 alpha-2 country code, e.g. DE, AT, FR.',
    },
    vatId: text(`VAT identification number of the ${who} with country prefix, e.g. DE123456789.`),
    ...extra,
    email: text('E-mail address.'),
    phone: text('Phone number.'),
    contactName: text('Contact person.'),
  },
});

/**
 * JSON Schema of {@link Invoice}. Handed to language models (structured
 * output, MCP tool input) and usable for any other validation.
 */
export const invoiceJsonSchema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  title: 'Invoice',
  description: 'Invoice data as printed on the PDF. Copy values exactly; leave out anything the document does not state.',
  type: 'object',
  additionalProperties: false,
  required: ['number', 'issueDate', 'seller', 'buyer', 'lines'],
  properties: {
    number: text('Invoice number.'),
    issueDate: date('Invoice date.'),
    typeCode: {
      type: 'string',
      enum: Object.keys(INVOICE_TYPES),
      description: '380 invoice (default), 381 credit note, 384 corrected invoice, 389 self-billed invoice, 326 partial invoice, 386 prepayment invoice.',
    },
    currency: {
      type: 'string',
      pattern: '^[A-Z]{3}$',
      description: 'ISO 4217 currency code. Default EUR.',
    },
    dueDate: date('Payment due date.'),
    deliveryDate: date('Date of delivery or service.'),
    deliveryCountry: {
      type: 'string',
      pattern: '^[A-Z]{2}$',
      description:
        'Country the goods went to, as ISO 3166-1 alpha-2 code. State it for an intra-community supply (category K) that did not go to the country of the buyer.',
    },
    periodStart: date('Start of the service period, if a period is given instead of a single date.'),
    periodEnd: date('End of the service period.'),
    buyerReference: text('Reference given by the buyer (Leitweg-ID for German public bodies).'),
    orderReference: text('Purchase order number.'),
    precedingInvoiceNumber: text('Number of the invoice this document corrects or cancels.'),
    precedingInvoiceDate: date('Date of that earlier invoice.'),
    note: text('Free text note.'),
    paymentTerms: text('Payment terms as printed, e.g. "Payable within 14 days".'),
    iban: text('IBAN of the seller.'),
    bic: text('BIC of the seller bank.'),
    vatExemptionReason: text('Printed reason why no VAT is charged (reverse charge, small business, export ...).'),
    prepaidAmount: amount('Amount already paid.'),
    seller: party('seller (the company that issued the invoice)', {
      taxNumber: text('Local tax number of the seller (German Steuernummer).'),
    }),
    buyer: party('buyer (the invoice recipient)'),
    lines: {
      type: 'array',
      minItems: 1,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['name', 'quantity', 'unitPrice', 'vatRate'],
        properties: {
          name: text('Item or service name.'),
          description: text('Further description.'),
          quantity: amount('Quantity.'),
          unit: text('UN/ECE Rec. 20 unit code: C62 piece (default), HUR hour, DAY day, MON month, KGM kilogram, MTR metre, LTR litre, LS lump sum.'),
          unitPrice: amount('Net price per unit, without VAT.'),
          netAmount: amount('Net line total as printed.'),
          discount: {
            type: 'object',
            additionalProperties: false,
            description: 'Discount on this line as printed: a percentage of quantity x unit price, an amount, or both.',
            properties: {
              percent: amount('Percentage, e.g. 10.'),
              amount: amount('Discount amount. Negative on a line with a negative quantity.'),
              reason: text('Reason as printed, e.g. "Treuerabatt".'),
            },
          },
          vatCategory: {
            type: 'string',
            enum: Object.keys(VAT_CATEGORIES),
            description: 'S standard rate (default), Z zero rated, E exempt, AE reverse charge, K intra-community supply, G export, O not subject to VAT.',
          },
          vatRate: amount('VAT rate in percent, e.g. 19.'),
        },
      },
    },
    totals: {
      type: 'object',
      additionalProperties: false,
      description: 'Totals exactly as printed on the invoice.',
      properties: {
        net: amount('Total without VAT.'),
        vat: amount('Total VAT.'),
        gross: amount('Total including VAT.'),
        due: amount('Amount due for payment.'),
      },
    },
  },
} as const;
