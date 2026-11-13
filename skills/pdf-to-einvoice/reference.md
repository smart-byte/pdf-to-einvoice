# Reference for the pdf-to-einvoice skill

## The data

```json
{
  "number": "RE-2026-0042",
  "issueDate": "2026-11-03",
  "deliveryDate": "2026-10-31",
  "dueDate": "2026-11-17",
  "paymentTerms": "Zahlbar innerhalb von 14 Tagen ohne Abzug.",
  "iban": "DE02120300000000202051",
  "seller": {
    "name": "Muster Software GmbH",
    "street": "Beispielweg 1",
    "postalCode": "12345",
    "city": "Musterstadt",
    "country": "DE",
    "vatId": "DE123456789"
  },
  "buyer": { "name": "Beispiel AG", "street": "Hauptstraße 5", "postalCode": "54321", "city": "Beispielstadt", "country": "DE" },
  "lines": [{ "name": "Beratung", "quantity": 10, "unit": "HUR", "unitPrice": 100, "vatCategory": "S", "vatRate": 19 }],
  "totals": { "net": 1000, "vat": 190, "gross": 1190 }
}
```

- Dates are `YYYY-MM-DD`; countries two letters (`DE`); amounts plain numbers (`1499.5`); prices net of VAT; an IBAN
  with or without spaces.
- Defaults: `typeCode` 380 (invoice), `currency` EUR, `unit` C62, `vatCategory` S.
- The seller needs `vatId` or `taxNumber`. An amount due needs `dueDate` or `paymentTerms`.
- Give `deliveryDate`, or `periodStart` and `periodEnd` for a service period: German invoices must state it.
- Other type codes: 381 credit note, 384 corrected invoice (name the original in `precedingInvoiceNumber` and
  `precedingInvoiceDate`), 326 partial invoice, 386 prepayment invoice, 389 self-billed invoice.
- A discount on a line goes into its `discount` (`percent` and/or `amount` as printed), never into the price. A line
  total that differs from quantity x unit price less the discount by rounding goes into `netAmount`; more than 0.02
  apart is an error.
- The full list with descriptions: `npx -y pdf-to-einvoice schema`.

## VAT categories

Every category except `S` has `vatRate` 0. All of those except `Z` need `vatExemptionReason`: the sentence the PDF
prints about it.

| Code | Meaning                | Typical case                                                                 |
| ---- | ---------------------- | ---------------------------------------------------------------------------- |
| `S`  | Standard rate          | Domestic sale with VAT (19 % or 7 % in Germany)                              |
| `Z`  | Zero rated             | Goods taxed at 0 %; no reason needed                                         |
| `E`  | Exempt                 | Exempt services; German small business without VAT (§ 19 UStG)               |
| `AE` | Reverse charge         | Service for a business in another EU country; needs `buyer.vatId`            |
| `K`  | Intra-community supply | Goods to a business in another EU country; needs both VAT IDs                |
| `G`  | Export                 | Goods to a country outside the EU; needs `seller.vatId`                      |
| `O`  | Not subject to VAT     | Service for a business outside the EU (e.g. USA), not taxable in the country |

An intra-community supply states the country the goods went to. Without `deliveryCountry` the buyer's country is
written and the check asks about it: confirm it with the user, or give `deliveryCountry`.

VAT is calculated per rate on the summed lines. If the PDF rounds VAT per line and ends up a cent apart, the check
reports `totals-mismatch`; then the PDF has to be corrected, not the data.

## Unit codes

`C62` piece, `HUR` hour, `DAY` day, `MON` month, `KGM` kilogram, `MTR` metre, `LTR` litre, `LS` lump sum.

## XRechnung

What the check reports under codes that start with `xrechnung-`, beyond EN 16931:

- `buyerReference`: the Leitweg-ID of the public body, which the buyer names, usually with the order.
- `seller.contactName`, `seller.phone`, `seller.email`: a contact at the seller.
- `buyer.email`: where the buyer takes invoices; it is written as the buyer's electronic address.
- `city` and `postalCode` of both parties.
- A line of `paymentTerms` that starts with `#` has to be a cash discount in the fixed form
  `#SKONTO#TAGE=14#PROZENT=2.00#`.

An intra-community supply (category `K`) cannot be written as XRechnung, and neither can a `deliveryCountry`: the data
has no delivery address yet. The tool
does not send the file; how the public body takes invoices in (portal, e-mail, Peppol) is for it to say. The XML
declares XRechnung 3.0.

## Findings of `validate`

- `no-xml`: a plain PDF without invoice XML. `xml-syntax`: the XML cannot be read. `profile`: the XML is MINIMUM or
  BASIC WL, which is not an e-invoice under EN 16931 and German VAT law.
- `not-in-pdf`: a value of the XML does not occur in the text of the PDF. The XML is the part that counts legally, so
  show the user every such value.
- `totals-mismatch`: the totals stated in the XML contradict its lines.
- `pdf-a`, `pdf-fonts`: the file does not declare PDF/A-3, or does not embed its fonts. Fonts that are not embedded do
  not affect the XML, but the file is not a strict PDF/A-3: export the PDF with embedded fonts (or as PDF/A) and repeat.
- Every other finding is one of `check`, applied to the data read from the XML.

`validate` runs neither the official EN 16931 Schematron rules nor a PDF/A validator such as veraPDF; a result without
findings does not prove that the file conforms.
