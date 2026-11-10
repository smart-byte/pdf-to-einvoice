---
name: pdf-to-einvoice
description: Turn an existing invoice PDF into an e-invoice (E-Rechnung) - ZUGFeRD / Factur-X, EN 16931 - by attaching the invoice data as XML without changing how the PDF looks, or write the invoice data as an XRechnung for a German public body. Use when the user has an invoice PDF and wants an e-invoice, asks about ZUGFeRD, Factur-X, XRechnung or "E-Rechnung", wants invoice data checked against EN 16931 or the XRechnung rules, wants an existing e-invoice PDF validated, or wants the XML read out of an e-invoice PDF.
---

# PDF to e-invoice

`pdf-to-einvoice` takes the invoice PDF the user already has, plus the invoice data as JSON, and writes a copy of the
PDF as PDF/A-3 with the data attached as `factur-x.xml` (Factur-X / ZUGFeRD, profile EN 16931). The pages stay as they
are. Everything runs locally; nothing is uploaded.

Your job is to read the data off the PDF, have the tool check it, let the user confirm it, and create the file.

To use this skill, copy the folder `skills/pdf-to-einvoice` into the skills folder of your agent; the npm package
ships it under `node_modules/pdf-to-einvoice/skills/`.

## Rules

- You act for the invoice **issuer** (the seller). A recipient cannot turn a received PDF into a valid e-invoice: it has
  to come from the supplier. Say so if that is what is asked.
- Copy values exactly as the PDF prints them. Never invent, guess or "correct" a value. If something is missing or
  unclear, ask the user.
- Always show the user the findings. Errors block the e-invoice; warnings need a second look.
- The XML is the legally binding part of the e-invoice and must not contradict the PDF. Get the user's confirmation of
  the data before you create the file.
- This is not tax advice. Which VAT category applies is the user's decision; ask when the PDF does not say.

## Workflow

```bash
npx pdf-to-einvoice read invoice.pdf --json     # 1. text of the PDF, guessed values, facts about the file
npx pdf-to-einvoice schema                      # 2. every field of the data, with descriptions (JSON Schema)
npx pdf-to-einvoice check data.json --pdf invoice.pdf   # 3. check the data and compare it with the PDF
npx pdf-to-einvoice create invoice.pdf data.json        # 5. writes invoice.einvoice.pdf next to the input
```

1. **Read.** `read --json` prints `{ text, guess, pdf }`. `text` is the PDF row by row. `guess` holds labelled values
   found by pattern (number, dates, IBAN, tax IDs, totals): a starting point, check each one against `text`. If
   `pdf.isEInvoice` is true the file already is an e-invoice; stop. If you can read the PDF yourself, still use `text`:
   it is what the check compares against.
2. **Fill in `data.json`** following `schema`. Leave out what the PDF does not state. Put the totals the PDF prints
   into `totals`; they are only used to detect contradictions.
3. **Check.** Exit code 1 means errors. Each line reads `severity path: message`, e.g. `error seller.vatId: ...`.
   A `not-in-pdf` warning means the value does not occur in the PDF text: re-read it. Fix and repeat until no error is
   left and every warning is understood.
4. **Confirm.** Show the user the data, the calculated totals and the remaining warnings. Wait for a yes.
5. **Create.** Prints the output path. It never overwrites the input, and another existing file only with `--force`.
   Use `-o out.pdf` for a different name. Warnings go to stderr; pass them on.

`npx pdf-to-einvoice xml einvoice.pdf` prints the XML of an existing e-invoice.

## XRechnung

XRechnung is the German version of EN 16931 that public bodies ask for. Use it for an invoice to a German public body,
or when the user asks for it by name; do not choose it on your own.

```bash
npx pdf-to-einvoice check data.json --pdf invoice.pdf --rules xrechnung   # 3. the check, with the XRechnung rules
npx pdf-to-einvoice xrechnung data.json -o invoice.xml                    # 5. the XML alone: UBL, or --syntax cii
npx pdf-to-einvoice create invoice.pdf data.json --profile xrechnung      # 5. or the PDF with that XML inside
```

The steps are the ones above. The XML declares XRechnung 3.0. Without `-o`, `xrechnung` prints the XML to standard
output; it needs no PDF, but read and compare the PDF all the same if the data comes from one.

XRechnung takes more data, and the check reports what is missing under codes that start with `xrechnung-`:

- `buyerReference`: the Leitweg-ID of the public body. The buyer names it, usually with the order. Ask the user for
  it; never make one up.
- `seller.contactName`, `seller.phone`, `seller.email`: a contact at the seller.
- `buyer.email`: where the buyer takes invoices. It is written as the buyer's electronic address.
- `city` and `postalCode` of both parties.
- A line's `netAmount` has to be quantity x unit price, at most 0.02 apart.
- A line of `paymentTerms` that starts with `#` has to be a cash discount in the fixed form
  `#SKONTO#TAGE=14#PROZENT=2.00#`.

Not possible as XRechnung: an intra-community supply (category `K`), because the data has no delivery address. The
tool does not send the file: how the public body takes invoices in (portal, e-mail, Peppol) is for it to say.

## Validating an existing e-invoice

```bash
npx pdf-to-einvoice validate einvoice.pdf       # add --json to also get the data read from the XML
```

For an e-invoice that already exists, issued or received. It prints whether the PDF is an e-invoice and in which
profile, then the findings and the totals calculated from the lines of the XML. Exit code 1 means it is not an
e-invoice or has errors.

- `no-xml`: a plain PDF without invoice XML. `xml-syntax`: the XML cannot be read. `profile`: the XML is MINIMUM or
  BASIC WL, which is not an e-invoice under EN 16931 and German VAT law.
- `not-in-pdf`: a value of the XML does not occur in the text of the PDF. The XML is the part that counts legally, so
  show the user every such value.
- `totals-mismatch`: the totals stated in the XML contradict its lines.
- `pdf-a`, `pdf-fonts`: the file does not declare PDF/A-3, or does not embed its fonts.
- Every other finding is one of `check`, applied to the data read from the XML.

This is a plausibility check, not a full validation: it runs neither the EN 16931 Schematron rules nor a PDF/A
validator such as veraPDF. No findings does not prove that the file conforms; say so when you report the result. An
e-invoice with errors has to be corrected by its issuer.

## The data

```json
{
  "number": "RE-2026-0042",
  "issueDate": "2026-11-03",
  "deliveryDate": "2026-10-31",
  "dueDate": "2026-11-17",
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

- Dates are `YYYY-MM-DD`; countries two letters (`DE`); amounts plain numbers (`1499.5`), prices net of VAT.
- Defaults: `typeCode` 380 (invoice), `currency` EUR, `unit` C62, `vatCategory` S.
- The seller needs `vatId` or `taxNumber`. An amount due needs `dueDate` or `paymentTerms`.
- Give `deliveryDate`, or `periodStart` / `periodEnd` for a service period: German invoices must state it.
- Other type codes: 381 credit note, 384 corrected invoice (name the original in `precedingInvoiceNumber` and
  `precedingInvoiceDate`), 326 partial invoice, 386 prepayment invoice, 389 self-billed invoice.
- A line total that differs from quantity x price by rounding goes into the line's `netAmount`.

### VAT categories

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

### Unit codes

`C62` piece, `HUR` hour, `DAY` day, `MON` month, `KGM` kilogram, `MTR` metre, `LTR` litre, `LS` lump sum.

## Limits

- No invoice-level discounts or surcharges yet. Model a discount as its own line with a negative quantity and a
  positive unit price.
- VAT is calculated per rate on the summed lines. If the PDF rounds VAT per line and ends up a cent apart, the check
  reports `totals-mismatch`; the PDF then has to be corrected, not the data.
- An invoice in a foreign currency that charges VAT cannot state that VAT in euro as well.
- A scanned PDF has no text: `read` returns nothing and the data cannot be compared with it. Tell the user to check
  every value by eye.
- A `pdf-fonts` warning means the PDF does not embed its fonts. The XML is still valid, but the file is not a strict
  PDF/A-3; the user should export the PDF again with fonts embedded (or as PDF/A) and repeat.
- The output is a ZUGFeRD / Factur-X file or an XRechnung. Countries that require invoices to go through a state
  platform or network (Italy, Poland, Belgium, France) need that step in addition.

With the MCP server (`npx pdf-to-einvoice mcp`) the same steps are the tools `read_invoice_pdf`, `check_invoice`,
`create_einvoice`, `create_xrechnung`, `read_einvoice_xml` and `validate_einvoice`; `check_invoice` takes
`rules: "xrechnung"` and `create_einvoice` takes `profile: "xrechnung"`.
