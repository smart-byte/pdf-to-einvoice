# pdf-to-einvoice

Turn the invoice PDF you already have into a valid e-invoice (ZUGFeRD / Factur-X, EN 16931) without changing how it
looks. In the browser, on the command line, as a TypeScript library, or as an MCP server for AI assistants.

[![CI](https://github.com/smart-byte/pdf-to-einvoice/actions/workflows/ci.yml/badge.svg)](https://github.com/smart-byte/pdf-to-einvoice/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/pdf-to-einvoice.svg)](https://www.npmjs.com/package/pdf-to-einvoice)
[![license](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

![The web app: your PDF on the left, its data on the right](docs/screenshot.png)

An e-invoice (German: _E-Rechnung_) is an invoice that software can read. The hybrid kind, ZUGFeRD in Germany and
Factur-X in France, is a PDF that carries the invoice a second time as XML. Most tools make you write your invoices
in their format. This one starts from the PDF you already produce with Word, your invoicing tool or a template:

- **Your layout stays.** The pages are not redrawn. The data is attached as `factur-x.xml` and the file becomes a
  PDF/A-3.
- **It tells you what is missing.** Required fields, sums that do not add up, and values that do not appear on
  your PDF are listed before anything is created.
- **Nothing is uploaded.** The web app has no server; the library and CLI run on your machine.
- **Every kind of invoice.** Domestic with VAT, several rates, small businesses, reverse charge, intra-community
  supplies, exports, services to non-EU customers, credit notes and corrections.
- **Checked against the reference.** Each of those kinds is validated in CI with
  [Mustang](https://www.mustangproject.org/), the validator of the ZUGFeRD community (veraPDF plus the official
  EN 16931 rules).

## In the browser

`npm run site` starts the web app locally. Drop a PDF, check the data that was read from it, download the
e-invoice. Reading works without any AI by pattern matching; optionally a small language model that runs in your
browser (WebGPU) fills in what the patterns did not find. The page is available in English and German.

## As a library

```bash
npm install pdf-to-einvoice
```

```ts
import { readFile, writeFile } from 'node:fs/promises';
import { createEInvoice } from 'pdf-to-einvoice';

const { pdf, xml, findings } = await createEInvoice({
  pdf: await readFile('invoice.pdf'),
  invoice: {
    number: 'RE-2026-0042',
    issueDate: '2026-11-03',
    deliveryDate: '2026-10-31',
    dueDate: '2026-11-17',
    iban: 'DE02120300000000202051',
    seller: { name: 'Muster Software GmbH', street: 'Beispielweg 1', postalCode: '12345', city: 'Musterstadt', country: 'DE', vatId: 'DE123456789' },
    buyer: { name: 'Beispiel AG', street: 'Hauptstraße 5', postalCode: '54321', city: 'Beispielstadt', country: 'DE' },
    lines: [{ name: 'Consulting', quantity: 10, unit: 'HUR', unitPrice: 100, vatRate: 19 }],
  },
});

await writeFile('invoice.einvoice.pdf', pdf);
```

It works the same in a browser: `pdf` is a `Uint8Array` in and out.

| function                           | what it does                                                                                                       |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `createEInvoice({ pdf, invoice })` | checks the data, then returns `{ pdf, xml, findings, totals }`; throws `InvoiceError` if data is wrong             |
| `check(invoice, { pdfText? })`     | returns `{ findings, totals, invoice? }` without creating anything; never throws on incomplete data                |
| `extractText(pdf)`                 | the text of a PDF, row by row                                                                                      |
| `extractLayout(pdf)`               | the text plus its geometry: `blocks` (text that stands together), `pieces` with their position, `pages`            |
| `guessFromText(text, { blocks })`  | reads an invoice without a model: totals that add up, items that add up to them, seller and buyer, labelled values |
| `keepWhatThePdfShows(draft, text)` | drops every value the PDF does not show: a guard for data read by a small language model                           |
| `languageOf(text)`                 | `'de'` or `'en'`: the language an invoice is written in                                                            |
| `validateEInvoice(pdf)`            | looks at an existing e-invoice: profile, embedded data, and whether the XML matches the visible page               |
| `readEmbeddedXml(pdf)`             | the XML of an existing e-invoice, or `null`                                                                        |
| `calculate(invoice)`               | the totals, following the EN 16931 rounding rules                                                                  |
| `invoiceJsonSchema`                | JSON Schema of the invoice data, for forms, validation and language models                                         |

A finding is `{ path, severity, code, message }`. An `error` blocks the e-invoice; a `warning` asks for a second
look.

## On the command line

```bash
npx pdf-to-einvoice read invoice.pdf --json      # text, guessed values and facts about the PDF
npx pdf-to-einvoice schema                       # the JSON Schema of the invoice data
npx pdf-to-einvoice check invoice.json --pdf invoice.pdf
npx pdf-to-einvoice create invoice.pdf invoice.json   # writes invoice.einvoice.pdf
npx pdf-to-einvoice validate invoice.einvoice.pdf
npx pdf-to-einvoice xml invoice.einvoice.pdf     # prints the embedded XML
```

`create` never overwrites a file unless you pass `--force`, and never writes over its input.

## For AI assistants

The MCP server lets an assistant such as Claude do the whole job on your machine: read the PDF, fill in the data,
show you what is missing, and create the file after you confirm.

```json
{
  "mcpServers": {
    "pdf-to-einvoice": { "command": "npx", "args": ["-y", "pdf-to-einvoice", "mcp"] }
  }
}
```

Tools: `read_invoice_pdf`, `check_invoice`, `create_einvoice`, `validate_einvoice`, `read_einvoice_xml`. For
agents that work with a shell instead, [skills/pdf-to-einvoice/SKILL.md](skills/pdf-to-einvoice/SKILL.md) describes
the same workflow with the CLI. A summary for language models is in [llms.txt](site/public/llms.txt).

The server needs no API key and calls no model itself: the assistant you already use reads the invoice.

## The invoice data

Small and flat on purpose. Required: `number`, `issueDate`, `seller` and `buyer` with `name` and `country`, a tax
identifier of the seller (`vatId` or `taxNumber`), at least one line, and a `dueDate` or `paymentTerms` when money is
owed. Defaults: `typeCode` 380 (invoice), `currency` EUR, `unit` C62 (piece), `vatCategory` S.

| VAT category | meaning                | typical case                                           |
| ------------ | ---------------------- | ------------------------------------------------------ |
| `S`          | standard rate          | domestic sale with VAT (any rate above 0)              |
| `Z`          | zero rated             | goods taxed at 0 %                                     |
| `E`          | exempt                 | small business (§ 19 UStG), exempt services            |
| `AE`         | reverse charge         | service for a business in another EU country           |
| `K`          | intra-community supply | goods delivered to a business in another EU country    |
| `G`          | export                 | goods delivered outside the EU                         |
| `O`          | not subject to VAT     | service for a business outside the EU, e.g. in the USA |

Every category except `S` and `Z` needs `vatExemptionReason`: the sentence on your invoice that says why no VAT is
charged. `totals` are the sums printed on the PDF; if they contradict the calculation, that is an error, because the
XML must not say something else than the page. The full list of fields is in
[`src/model.ts`](src/model.ts) and in `npx pdf-to-einvoice schema`.

## What changes in your PDF

Only what the standard asks for: the XML attachment, XMP metadata that declares PDF/A-3 and Factur-X, an sRGB
output intent and a document ID. Images that ask viewers to smooth them (`/Interpolate true`) have that flag switched
off, because PDF/A forbids it. The page content is not touched.

What cannot be repaired is reported: if your PDF does not embed its fonts, the XML is still valid, but the file is
not a strict PDF/A-3. Export the PDF with embedded fonts (or as PDF/A) and run it again.

## Limits

- **Only the issuer can issue an e-invoice.** A PDF you _received_ does not become a valid e-invoice because you
  converted it. If you sent a plain PDF where an e-invoice was required, issue a corrected invoice (type 384) that
  refers to the original.
- **Reading is still being broadened.** Pattern matching reads the layouts it knows well and less of others; what it
  cannot place is left empty and shown as missing. Reading invoices of every kind is work in progress.
- **The XML is the binding part.** The tool checks arithmetic and compares the data with the text of the PDF, but
  it cannot know what you meant. Review the data before you create the file.
- **Profile and syntax:** Factur-X / ZUGFeRD profile EN 16931 (CII). Plain XRechnung and UBL output are not built
  yet.
- **Not modelled yet:** discounts and charges on the whole invoice (use a line with a negative quantity), VAT in a
  second currency, several payment accounts, attachments.
- **`validateEInvoice` is a plausibility check,** not a replacement for a full validator.
- **No encryption or password protection:** PDF/A forbids it, so a protected file would no longer be a valid
  e-invoice.
- **Country rules:** a hybrid PDF is how e-invoices are exchanged in Germany. Italy, Poland, Belgium and France
  route invoices through national platforms or networks; a file alone is not enough there.
- This is a tool, not tax advice.

## Built on

[`@e-invoice-eu/core`](https://github.com/gflohr/e-invoice-eu) writes the XML and embeds it,
[`@cantoo/pdf-lib`](https://github.com/cantoo-scribe/pdf-lib) reads and repairs PDFs,
[pdf.js](https://mozilla.github.io/pdf.js/) extracts text, [WebLLM](https://webllm.mlc.ai/) runs models in the
browser, and the [MCP TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk) speaks to assistants.
This project adds the simple data model, the checks, the comparison with the PDF and the front ends. Licences are
listed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

## Develop

```bash
npm install
npm test                 # unit tests
npm run type-check && npm run lint && npm run format:check
npm run site             # the web app on http://localhost:4350
```

`npm run test:reference` validates generated invoices with Mustang; it needs Java and the Mustang CLI, see
[CONTRIBUTING.md](CONTRIBUTING.md).

`npm run eval:reader -- <folder>` measures how much the reader gets right on e-invoices that carry their own answer
(their XML); CONTRIBUTING.md says where to get such files.

## Licence

MIT, see [LICENSE](LICENSE). The software implements the semantic data model of the European standard
EN 16931-1:2017; the standard itself is the property of CEN and is not part of this repository.
