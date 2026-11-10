# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- XRechnung, the German version of EN 16931 for invoices to public bodies, as a second output. `createXRechnung`
  returns the invoice data as XML that declares XRechnung 3.0, in UBL or CII, and `createEInvoice` takes
  `profile: 'xrechnung'` for a hybrid PDF whose XML follows XRechnung. `check` takes `rules: 'xrechnung'` and then
  reports what XRechnung asks for beyond EN 16931, each under a code of its own (`xrechnung-...`); both create
  functions run it. On the command line that is `xrechnung <data.json> [--syntax ubl|cii] [-o out.xml]`,
  `create --profile xrechnung` and `check --rules xrechnung`; in the MCP server the tool `create_xrechnung`, `rules`
  for `check_invoice` and `profile` for `create_einvoice`. The reference validation covers the three outputs.
- Web app: XRechnung. A choice above the form switches between the hybrid PDF and XRechnung. With XRechnung the form
  asks for the Leitweg-ID or other buyer reference, a contact with phone and e-mail and the e-mail address of the
  buyer, the check runs the XRechnung rules, and two files are created: the XRechnung as XML (UBL) for the portal of
  the public body, and the PDF that carries it.
- `extractLayout`: the text of a PDF with its geometry (blocks, pieces with positions, page sizes).
- `guessFromText` reads by what fits together instead of where it stands: totals by arithmetic, items that add up to
  them, the seller by evidence and the buyer by exclusion, identifiers by their shape; labels in German, English and
  French. `scripts/eval-reader.mjs` measures it against e-invoices that carry their own answer, alone and together
  with an in-browser language model.
- Legal notice and privacy policy for the web app, in English and German, with the same footer and language switch
  on every page.
- Web app: marks on the preview show where each value stands on the page and lead to its field, on every page of the
  PDF: the preview turns to the page a value stands on; a progress bar
  while a model downloads and a band of light over the page while it reads; the XML that will be embedded can be
  viewed before the file is created.
- Web app: every value a language model added is marked at its field until the user has changed it or ticked it
  off, and the verdict counts them. A model gets about four in ten of the values it adds wrong.
- Web app: the built pages carry a Content-Security-Policy.
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
