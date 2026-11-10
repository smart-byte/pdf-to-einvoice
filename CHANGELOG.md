# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- `extractLayout`: the text of a PDF with its geometry (blocks, pieces with positions, page sizes).
- `guessFromText` reads by what fits together instead of where it stands: totals by arithmetic, items that add up to
  them, the seller by evidence and the buyer by exclusion, identifiers by their shape; labels in German, English and
  French. `scripts/eval-reader.mjs` measures it against e-invoices that carry their own answer.
- Legal notice and privacy policy for the web app, in English and German, with the same footer and language switch
  on every page.
- Web app: marks on the preview show where each value stands on the page and lead to its field; a progress bar
  while a model downloads and a band of light over the page while it reads; the XML that will be embedded can be
  viewed before the file is created.
- `createEInvoice`: turns an existing invoice PDF plus invoice data into a ZUGFeRD / Factur-X e-invoice
  (PDF/A-3 with CII XML, profile EN 16931) without redrawing the pages.
- `check`: required fields, formats, EN 16931 arithmetic, and a comparison of the data with the text of the PDF.
- `extractText` and `guessFromText`: text extraction and pattern-based reading of labelled values, of the seller
  and buyer from the sender line and address block, and of table rows that add up to the net total.
- `validateEInvoice` and `readEmbeddedXml` for existing e-invoices.
- VAT categories S, Z, E, AE, K, G and O; invoices, credit notes, corrected, partial and prepayment invoices.
- Command line tool `pdf-to-einvoice` and an MCP server (`pdf-to-einvoice mcp`).
- Web app in English and German that runs entirely in the browser, with optional in-browser language models.
  It reads service periods given as a month, a quarter or two dates, suggests a due date where the PDF states no
  payment term, and shows a verdict when an existing e-invoice is dropped.
