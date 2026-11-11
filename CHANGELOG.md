# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- `createEInvoice`: an existing invoice PDF plus invoice data becomes a ZUGFeRD / Factur-X e-invoice (PDF/A-3 with
  CII XML, profile EN 16931) without redrawing the pages.
- `createXRechnung`, and `profile: 'xrechnung'` for `createEInvoice`: the same data as XRechnung 3.0 for German
  public bodies, as plain XML in UBL or CII, or inside the PDF.
- `check`: required fields, formats, EN 16931 arithmetic and a comparison of the data with the text of the PDF; with
  `rules: 'xrechnung'` also what XRechnung asks for on top.
- `extractText`, `extractLayout` and `guessFromText`: the text and layout of a PDF, and reading an invoice from them
  without a model: totals by arithmetic, items that add up to them, also over several pages, seller and buyer,
  identifiers by their shape; labels in German, English and French.
- `keepWhatThePdfShows`: drops what a language model returned but the PDF does not show.
- `validateEInvoice` and `readEmbeddedXml` for existing e-invoices.
- VAT categories S, Z, E, AE, K, G and O; invoices, credit notes, corrected, partial, prepayment and self-billed
  invoices.
- Command line tool `pdf-to-einvoice`, an MCP server (`pdf-to-einvoice mcp`) and a skill for agents, with which the
  agent reads the PDF itself, a scanned one too.
- Web app in English and German that runs entirely in the browser: marks on the preview show where each value stands
  on the page, every finding says what to do, the XML can be viewed before the file is created, XRechnung is a
  second output, and an existing e-invoice that is dropped gets a verdict.
- Web app: on request a language model in the browser fills in what the patterns left empty. Every value it adds is
  marked until the user has checked it, and reading can be cancelled.
