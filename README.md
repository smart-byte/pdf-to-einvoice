# pdf-to-einvoice

Turn the invoice PDF you already have into an e-invoice (ZUGFeRD / Factur-X, EN 16931) without changing how it
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
- **It tells you what is missing.** Required fields, sums that do not add up, and numbers, names, addresses, dates
  and amounts that do not appear on your PDF are listed before anything is created.
- **Nothing is uploaded.** The web app works in your browser; the library and the command line tool run on your
  machine.
- **The common kinds of invoice.** Domestic with VAT, several rates, small businesses, reverse charge, intra-community
  supplies, exports, services to non-EU customers, credit notes and corrections.
- **XRechnung for public bodies**, as plain XML or inside the PDF, see [XRechnung](#xrechnung).
- **Checked against the reference.** CI creates each of those kinds and has an independent validator check the
  result: veraPDF for PDF/A-3, and the official EN 16931, Factur-X and XRechnung rules. What your own PDF brings
  along is a different matter, see [What changes in your PDF](#what-changes-in-your-pdf).

## In the browser

**[Open the web app](https://pdf-to-einvoice.app/)**, or start it locally with `npm run site`. Drop a PDF, check the
data that was read from it, download the e-invoice. The page is in English and German. The site at that address
can count page views and created files, never anything of an invoice, with a cookieless Umami we run ourselves; its
privacy policy says whether it does. A copy you build yourself counts nothing.

Reading works by pattern matching, without any AI. On request a small language model fills in what the patterns did
not find. It runs in your browser (WebGPU) and is downloaded once from Hugging Face (huggingface.co, hf.co) and
raw.githubusercontent.com; if you point the page at a model service of your own, the invoice text goes to that
service.

### Compared with online converters

Many services convert PDF invoices too. The main difference is where your invoice is processed.

|                                         | typical online converter                                                                               | pdf-to-einvoice                                                                                                                                                |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Where is your invoice processed?        | On the provider's servers: the file is uploaded.                                                       | On your device, in the browser. Nothing is uploaded.                                                                                                           |
| Who reads the data?                     | Depending on the provider, an AI service in the cloud, also outside the EU, or you type everything in. | Rules on your device; on request also a language model that runs in your browser too, or a service whose address you enter yourself.                           |
| Where does each value come from?        | You get a form to correct.                                                                             | What was read from the PDF is marked on it. Numbers, names, addresses, dates, prices and totals are compared with its text: whether they are there, not where. |
| Account, ads, tracking                  | Depending on the provider, sign-up, ads or a subscription.                                             | No sign-up, no ads, no cookies.                                                                                                                                |
| Source code                             | Mostly closed.                                                                                         | Open (MIT licence): anyone can check what the page does.                                                                                                       |
| For software and AI assistants          | Mostly an API that invoices are sent to.                                                               | Library, command line tool and MCP server, all on your own machine.                                                                                            |
| Checking against the official rule sets | Some offer their own validator.                                                                        | Its own plausibility check; not a complete check against the official rule sets.                                                                               |

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

It works the same in a browser: `pdf` is a `Uint8Array` in and out. A bundler needs two things set up, as
[`site/vite.config.ts`](site/vite.config.ts) and [`site/main.ts`](site/main.ts) do: an alias that points
`@e-invoice-eu/core` to its browser bundle, and the worker of pdf.js.

| function                                     | what it does                                                                                                       |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `createEInvoice({ pdf, invoice, profile? })` | checks the data, then returns `{ pdf, xml, findings, totals }`; throws `InvoiceError` if data is wrong             |
| `createXRechnung({ invoice, syntax? })`      | the data as an [XRechnung](#xrechnung): returns `{ xml, findings, totals }`, no PDF; throws `InvoiceError` as well |
| `check(invoice, { pdfText?, rules? })`       | returns `{ findings, totals, invoice? }` without creating anything; never throws on incomplete data                |
| `extractText(pdf)`                           | the text of a PDF, row by row                                                                                      |
| `extractLayout(pdf)`                         | the text plus its geometry: `blocks` (text that stands together), `pieces` with their position, `pages`            |
| `guessFromText(text, { blocks })`            | reads an invoice without a model: totals that add up, items that add up to them, seller and buyer, labelled values |
| `keepWhatThePdfShows(draft, text)`           | drops every value the PDF does not show: a guard for data read by a small language model                           |
| `languageOf(text)`                           | `'de'` or `'en'`: the language an invoice is written in                                                            |
| `validateEInvoice(pdf, { pdfText? })`        | looks at an existing e-invoice: profile and embedded data; with `pdfText` also whether the XML matches the page    |
| `readEmbeddedXml(pdf)`                       | the XML of an existing e-invoice, or `null`                                                                        |
| `calculate(invoice)`                         | the totals, following the EN 16931 rounding rules                                                                  |
| `invoiceJsonSchema`                          | JSON Schema of the invoice data, for forms, validation and language models                                         |

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
npx pdf-to-einvoice xrechnung invoice.json -o invoice.xml   # the data as an XRechnung, see below
```

`create` and `xrechnung` never overwrite a file unless you pass `--force`, and never write over their input.

## Many invoices at once

An invoicing program already has what this tool needs: the PDF it renders and the data it renders it from. Pass that
data on instead of reading it back from the PDF. Reading is a first draft for a person to check, not something to run
unattended over a batch.

```ts
import { readFile, writeFile } from 'node:fs/promises';
import { createEInvoice, InvoiceError } from 'pdf-to-einvoice';

for (const { pdfPath, invoice } of invoicesToConvert) {
  try {
    const { pdf } = await createEInvoice({ pdf: await readFile(pdfPath), invoice });
    await writeFile(pdfPath.replace(/\.pdf$/i, '.einvoice.pdf'), pdf);
  } catch (error) {
    if (!(error instanceof InvoiceError)) throw error;
    console.error(pdfPath, error.findings); // the data has errors: nothing was written
  }
}
```

On the command line, with a data file next to each PDF (`RE-1.pdf` and `RE-1.json`):

```bash
for pdf in invoices/*.pdf; do
  npx pdf-to-einvoice create "$pdf" "${pdf%.pdf}.json" || echo "not created: $pdf"
done
```

## For AI assistants

The MCP server lets an AI assistant do the whole job: read the PDF, fill in the data, show you what is missing, and
create the file after you confirm.

```json
{
  "mcpServers": {
    "pdf-to-einvoice": { "command": "npx", "args": ["-y", "pdf-to-einvoice", "mcp"] }
  }
}
```

Tools: `read_invoice_pdf`, `check_invoice`, `create_einvoice`, `create_xrechnung`, `validate_einvoice`,
`read_einvoice_xml`. A summary for language models is in [llms.txt](site/public/llms.txt).

For agents that work with a shell, such as Claude Code, the folder [skills/pdf-to-einvoice](skills/pdf-to-einvoice) is
a skill. The agent reads the PDF itself, a scanned one too, compares its reading with what the tool found by pattern,
and lets the tool check the data and create the file. Copy the folder into the agent's skills folder; for Claude Code
that is `~/.claude/skills/` for all projects or `.claude/skills/` in one. The npm package ships it in
`node_modules/pdf-to-einvoice/skills/`.

The server and the skill run on your machine, need no API key and call no model themselves: the assistant you
already use reads the invoice. Its content therefore goes wherever that assistant runs.

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
XML must not contradict the page. A line's `discount` is a `percent` of quantity x unit price, an `amount`, or both;
its `netAmount` may differ from quantity x unit price less the discount by rounding only (0.02). The full list of
fields is in [`src/model.ts`](src/model.ts) and in `npx pdf-to-einvoice schema`.

## XRechnung

XRechnung is the German version of EN 16931 that public bodies ask for. The same invoice data can be written as one:

- **As plain XML** in UBL (default) or CII: `createXRechnung({ invoice, syntax? })`, the command
  `xrechnung <data.json> [--syntax ubl|cii] [-o out.xml]`, the MCP tool `create_xrechnung`.
- **Inside the PDF**, in place of the EN 16931 profile: `profile: 'xrechnung'` for `createEInvoice`,
  `--profile xrechnung` for `create`, `profile` for `create_einvoice`.
- **In the web app:** choose XRechnung above the form, and you get both files.

XRechnung asks for more than EN 16931 does. `check` with `rules: 'xrechnung'` (`--rules xrechnung`) reports what is
missing, under codes that start with `xrechnung-`, and both ways of creating run it first:

- `buyerReference`: for a German public body its Leitweg-ID, which the buyer names
- a contact at the seller: `seller.contactName`, `seller.phone`, `seller.email`
- `buyer.email`, which is written as the buyer's electronic address
- `city` and `postalCode` of seller and buyer
- a line of `paymentTerms` that starts with `#` in the form of a cash discount: `#SKONTO#TAGE=14#PROZENT=2.00#`

The XML declares XRechnung 3.0. What it cannot do yet:

- An intra-community supply (`K`) and a `deliveryCountry` are refused: XRechnung wants a place of delivery with city
  and postal code, and the data has no delivery address.
- The electronic address of seller and buyer is always an e-mail address, not a Leitweg-ID or a Peppol ID.
- The extension of XRechnung (sub-lines, payments by a third party) is not written.
- The file is not sent anywhere. How a public body takes invoices in (portal, e-mail, Peppol) is for it to say.
- `validateEInvoice` reads the XML inside a PDF, not a plain XML file.

## What changes in your PDF

Only what the standard asks for: the XML attachment, XMP metadata that declares PDF/A-3 and Factur-X, an sRGB
output intent and a document ID. Two things PDF/A forbids are taken out: the flag of images that ask viewers to smooth
them (`/Interpolate true`), and scripts and actions the file would run (JavaScript, starting a program and the like),
which you are told about. The page content is not touched.

One defect is detected and reported, but not repaired: fonts that are not embedded. The XML is not affected, but the
file is not a strict PDF/A-3; export the PDF with embedded fonts (or as PDF/A) and run it again. Other things PDF/A
forbids in your original are neither found nor repaired. If the software of a recipient rejects the file, check it
with a PDF/A validator.

## Limits

- **Only the issuer can turn an invoice into an e-invoice.** Converting a PDF you _received_ does not make it one.
- **Check every value.** Reading is a first draft: it knows some layouts well and others less, leaves empty what it
  cannot place, and can be wrong. A scanned PDF has no text to read at all. The comparison with the PDF tells whether
  a value stands in its text, not where: an address entered for the wrong party passes. The XML is the part that
  counts legally, and the tool cannot know what you meant.
- **Not modelled yet:** discounts and charges on the whole invoice (use a line with a negative quantity), VAT in a
  second currency, several payment accounts, attachments, the profiles BASIC and EXTENDED.
- **Nothing is assumed about the delivery.** Without a delivery date and a `deliveryCountry` the delivery part of the
  XML is empty, as in official samples of the standard; a validator may remark on the empty element. Only an
  intra-community supply names the buyer's country there, and the check asks about it.
- **`validateEInvoice` is a plausibility check,** not a replacement for a full validator.
- **No encryption or password protection:** PDF/A forbids it.
- **Country rules:** in Germany a hybrid PDF is one accepted form of e-invoice. Italy, Poland, Belgium and France
  route invoices through national platforms or networks; a file alone is not enough there.
- This is a tool, not tax or legal advice.

## Develop

```bash
npm install
npm test
npm run site             # the web app on http://localhost:4350
```

The rest is in [CONTRIBUTING.md](CONTRIBUTING.md): the checks, the reference validation and how the reader is
measured.

## Licence

MIT, see [LICENSE](LICENSE). The libraries this project builds on, and their licences, are listed in
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). The software uses a subset of the semantic data model of the
European standard EN 16931-1:2017; the standard itself is the property of CEN and is not part of this repository.

ZUGFeRD, Factur-X and XRechnung are names of their respective owners. This project is independent: it is not
affiliated with the organisations behind these standards, and it is neither endorsed nor certified by them.
