---
name: pdf-to-einvoice
description: Turn an invoice PDF the user issued into an e-invoice (E-Rechnung) - ZUGFeRD / Factur-X, EN 16931 - by attaching the invoice data as XML without changing how the PDF looks, also from a scanned PDF; or write the data as an XRechnung for a German public body; or check an existing e-invoice. Use when the user has an invoice PDF and wants an e-invoice, mentions ZUGFeRD, Factur-X, XRechnung or E-Rechnung, or wants an e-invoice checked. Runs locally with the pdf-to-einvoice command line tool.
---

# PDF to e-invoice

You turn an invoice PDF into an e-invoice: the same PDF, with the invoice data attached as XML. You read the invoice;
the tool does what has to be exact: the EN 16931 rules, the arithmetic, the comparison with the text of the PDF, the
XML and the PDF/A-3 file. Everything stays on this machine.

Run the tool as `npx -y pdf-to-einvoice <command>` (Node 22.13 or newer). Field lists, VAT categories and finding codes
are in [reference.md](reference.md); read it when you need them.

## Before you start

- Only the issuer can make an invoice an e-invoice. If the user received the PDF, say so and stop: the e-invoice has to
  come from the supplier. Checking a received e-invoice is fine (see below).
- The XML is what counts legally. Never invent or "correct" a value; ask the user. Create nothing before the user has
  confirmed the data.
- This is not tax or legal advice. When the PDF does not say which VAT treatment applies, the user decides.

## Steps

1. **Read the PDF yourself.** Look at its pages and note number, dates, seller, buyer, every line, totals, payment
   terms, bank details and tax IDs. You can also read a scan, which the tool cannot.
2. **Get the tool's reading:** `npx -y pdf-to-einvoice read invoice.pdf --json` prints `{ text, guess, pdf }`.
   - `pdf.isEInvoice` true: it is an e-invoice already; go to "Checking an existing e-invoice".
   - `text` empty: a scan. Nothing can be compared, so the user has to confirm every value; say so.
3. **Compare** your reading with `guess`, which the tool found by pattern without any model. Where both agree, the value
   is very likely right. Where they differ, or `guess` lacks it, look at the PDF again; ask the user when unsure.
4. **Write `data.json`** (fields: `npx -y pdf-to-einvoice schema`). Leave out what the PDF does not state. Put the
   printed totals into `totals`: they are only used to find contradictions. A domestic invoice rarely prints the
   required `country`: take the seller's from its VAT ID, and a buyer who is charged VAT is in the same country.
5. **Check:** `npx -y pdf-to-einvoice check data.json --pdf invoice.pdf` prints the findings and the calculated
   totals; exit code 1 means errors. A `not-in-pdf` warning means the value does not occur on the PDF: read it again.
   Fix and repeat until no error is left.
6. **Confirm:** show the user the data as a short table (every value for a scan), what you assumed, the calculated
   totals and every remaining warning. Wait for a yes.
7. **Create:** `npx -y pdf-to-einvoice create invoice.pdf data.json` writes `invoice.einvoice.pdf` next to the input. It
   never overwrites a file (`-o` for another name). Pass its warnings on, and tell the user where the file is.

## XRechnung, for public bodies

Only for an invoice to a German public body, or when the user asks for it. It needs more: the Leitweg-ID in
`buyerReference` (the buyer names it; never make one up), a contact at the seller with `contactName`, `phone` and
`email`, and the buyer's `email`. Check with `--rules xrechnung`, then create either:

- `npx -y pdf-to-einvoice xrechnung data.json -o invoice.xml`: the XML to upload to the public body's portal (UBL;
  `--syntax cii` for CII), or
- `npx -y pdf-to-einvoice create invoice.pdf data.json --profile xrechnung`: the PDF that carries it.

## Checking an existing e-invoice

`npx -y pdf-to-einvoice validate einvoice.pdf` (with `--json` also the data from the XML), for issued and received
e-invoices. It is a plausibility check, not a full validation against the official rules: say so when you report. A
received e-invoice with errors has to be corrected by its issuer.

## When it does not fit

- Many invoices from an invoicing program: take the data from that program instead of reading PDFs back; the README
  shows how ("Many invoices at once").
- Discounts on the whole invoice are not modelled yet: a line with a negative quantity.
- Italy, Poland, Belgium and France route invoices through state platforms; a file alone is not enough there.

With an MCP client, `npx -y pdf-to-einvoice mcp` offers the same steps as tools.
