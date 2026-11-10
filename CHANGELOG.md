# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Legal notice and privacy policy for the web app, in English and German, with the same footer and language switch
  on every page.
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
