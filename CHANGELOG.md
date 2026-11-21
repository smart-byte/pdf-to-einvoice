# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- A finding carries the values its message was filled with as `params`, such as `{ expected: '0.99', stated: '0.50' }`.
  The web app words its German texts from them instead of reading them out of the English message.

### Changed

- A line with a negative VAT rate is told that a rate is never negative, as a discount or a charge is, instead of what
  its category asks for.
- The comparison of a language model's answer with the PDF drops an e-mail address that `check` would reject, such as
  one that took the full stop of its sentence along.
- `check` and the comparison of a language model's answer with the PDF ask the same of a value the page is said to
  show. `check` no longer takes a part of a longer number or word for the value: "49" is not shown by "249,50", "10 %"
  not by "110 %", "Stadt" not by "Musterstadt". The comparison of a model's answer finds an amount whose thousands are
  grouped by a space that does not break, and a rate printed as "7,50 %".

### Fixed

- `check` reports a text that is given as a number, a list or an object, such as a postal code written as `1234`
  without quotes, instead of returning it as part of the invoice.
- The comparison of a language model's answer with the PDF keeps a service period printed as "März 2026" or
  "Mär. 2026"; month names with an umlaut were never found.

## [0.3.2] - 2026-11-19

### Fixed

- The web app reads "1.000" in the answer of a language model as 1000, as the reader of the page does, not as 1.

### Security

- fast-xml-parser 5.12.0, which reads an unterminated tag without quadratic CPU time (GHSA-474x-hrwr-fgx4).

## [0.3.1] - 2026-11-17

### Fixed

- A finding about a line total quotes the expected amount in cents, as the XML has it: 1 x 1.005 less 0.02 is 0.99,
  not 0.98.
- Checking an e-invoice no longer calls a discount a contradiction whose percentage repeats the minus of a credit
  note, and reads freight that the profile EXTENDED states as a logistics service charge.

## [0.3.0] - 2026-11-16

### Added

- Discounts and charges on the whole invoice (`discounts`, `charges`): a percentage, an amount or both, a reason and
  the VAT category and rate they belong to. A percentage is taken of each VAT rate of the lines; an amount is never
  split between rates. They are checked, written into the XML, read back from an e-invoice and entered in the web app.
- `check` refuses category O beside any other VAT category (BR-O-11).

### Changed

- `calculate` throws for a discount or charge it cannot place in a VAT group; `check` says why. `readInvoiceXml` and
  `validateEInvoice` return `percentages`, which `check` takes as an option.

## [0.2.0] - 2026-11-13

### Added

- A discount on a line item (`discount`): a percentage, an amount or both, with a reason. It is checked, written into
  the XML, read back from an e-invoice and entered in the web app.

### Fixed

- `guessFromText` no longer takes the customer's VAT ID or the seller's own address for the other party, nor a
  second currency on the page for the invoice's. It reads the country below an address abroad, Dutch postal codes,
  units in a column of their own, negative amounts set with a minus sign, English totals rows, the title of a
  partial, prepayment or corrected invoice with its type, periods over several months, payment terms that start
  with "Die Zahlung ist", and the VAT category of an invoice without VAT from its printed reason.
- `readInvoiceXml` takes no customer number for a tax number, and `check` finds unit prices finer than a cent on the
  PDF. `keepWhatThePdfShows` keeps quantities with a thousands separator and periods printed as months.

## [0.1.0] - 2026-11-11

The first release.

### Added

- `createEInvoice`: an existing invoice PDF plus invoice data becomes a ZUGFeRD / Factur-X e-invoice (PDF/A-3 with
  CII XML, profile EN 16931) without redrawing the pages. Scripts and actions PDF/A forbids are taken out of the
  PDF, and the data is compared with its text.
- `createXRechnung`, and `profile: 'xrechnung'` for `createEInvoice`: the same data as XRechnung 3.0 for German
  public bodies, as plain XML in UBL or CII, or inside the PDF.
- `check`: required fields, formats, EN 16931 arithmetic and a comparison of numbers, names, addresses, dates and
  amounts with the text of the PDF; with `rules: 'xrechnung'` also what XRechnung asks for on top.
- `extractText`, `extractLayout` and `guessFromText`: the text and layout of a PDF, and reading an invoice from them
  without a model: totals by arithmetic, items that add up to them, also over several pages, seller and buyer,
  identifiers by their shape, and contact data and the buyer reference where the page leaves no doubt whose they
  are; labels in German, English and French.
- `keepWhatThePdfShows`: drops what a language model returned but the PDF does not show.
- `validateEInvoice` and `readEmbeddedXml` for existing e-invoices.
- VAT categories S, Z, E, AE, K, G and O; invoices, credit notes, corrected, partial, prepayment and self-billed
  invoices.
- Command line tool `pdf-to-einvoice`, an MCP server (`pdf-to-einvoice mcp`) and a skill for agents, with which the
  agent reads the PDF itself, a scanned one too.
- Web app in English and German that runs entirely in the browser: marks on the preview show where each value stands
  on the page, every finding says what to do, the XML can be viewed before the file is created, XRechnung is a
  second output, and an existing e-invoice that is dropped gets a verdict.
- Web app: on request a language model in the browser fills in what the patterns left empty. A bar shows how far its
  answer has come, every value it adds is marked until the user has checked it, and reading can be cancelled.
