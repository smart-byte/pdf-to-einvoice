// Validates generated e-invoices with Mustang, the reference validator of the ZUGFeRD community: veraPDF for
// PDF/A-3 plus the official EN 16931 / Factur-X Schematron rules, and for a file that declares XRechnung the
// XRechnung rules of KoSIT. Opt-in, because it needs Java and a download:
//
//   curl -LO https://github.com/ZUGFeRD/mustangproject/releases/download/core-2.26.0/Mustang-CLI-2.26.0.jar
//   MUSTANG_JAR=$PWD/Mustang-CLI-2.26.0.jar npm run test:reference
import { execFile } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { PDFDocument, PDFName, PDFString } from '@cantoo/pdf-lib';
import { describe, expect, it } from 'vitest';
import { createEInvoice, createXRechnung } from '../src/create.js';
import type { InvoiceDraft } from '../src/model.js';

const jar = process.env.MUSTANG_JAR;
const file = (name: string) => readFileSync(new URL(`../examples/${name}`, import.meta.url));
const sample = (change: (draft: any) => void = () => {}): InvoiceDraft => {
  const draft = JSON.parse(file('sample-invoice.json').toString());
  change(draft);
  return draft;
};
/** Every line in the given VAT category at 0 %, with a reason and no printed totals. */
const withoutVat = (category: string, reason: string, change: (draft: any) => void = () => {}) =>
  sample((d) => {
    for (const line of d.lines) Object.assign(line, { vatCategory: category, vatRate: 0 });
    d.vatExemptionReason = reason;
    delete d.totals;
    change(d);
  });

const US_BUYER = { name: 'Example Inc.', street: '1 Market Street', postalCode: '94105', city: 'San Francisco', country: 'US' };
const AT_BUYER = { name: 'Beispiel GmbH', street: 'Ringstraße 1', postalCode: '1010', city: 'Wien', country: 'AT', vatId: 'ATU12345678' };

const CASES: Record<string, InvoiceDraft> = {
  'domestic invoice with VAT': sample(),
  'seller with a tax number instead of a VAT ID': sample((d) => {
    delete d.seller.vatId;
    d.seller.taxNumber = '123/456/78901';
  }),
  'two VAT rates': sample((d) => {
    d.lines[1].vatRate = 7;
    delete d.totals;
  }),
  'service period instead of a delivery date': sample((d) => {
    delete d.deliveryDate;
    Object.assign(d, { periodStart: '2026-10-01', periodEnd: '2026-10-31' });
  }),
  'partly paid in advance': sample((d) => {
    d.prepaidAmount = 500;
    delete d.totals;
  }),
  'reverse charge to a business in another EU country': withoutVat('AE', 'Reverse charge: VAT is owed by the recipient.', (d) => (d.buyer = AT_BUYER)),
  'intra-community supply of goods': withoutVat('K', 'Tax-free intra-community supply.', (d) => (d.buyer = AT_BUYER)),
  'export of goods to the USA': withoutVat('G', 'Tax-free export.', (d) => (d.buyer = US_BUYER)),
  'service for a business in the USA, not subject to VAT, in US dollars': withoutVat('O', 'Not taxable in Germany (§ 3a (2) UStG).', (d) => {
    d.buyer = US_BUYER;
    d.currency = 'USD';
  }),
  'small business without VAT (§ 19 UStG)': withoutVat('E', 'No VAT charged: small business under § 19 UStG.', (d) => {
    delete d.seller.vatId;
    d.seller.taxNumber = '123/456/78901';
  }),
  'every optional field filled in': sample((d) => {
    Object.assign(d, { orderReference: 'PO-77', buyerReference: 'REF-1', note: 'Thank you.' });
    Object.assign(d.seller, { phone: '+49 30 1234567', contactName: 'Erika Muster' });
    Object.assign(d.buyer, { vatId: 'DE987654321', email: 'einkauf@beispiel.example' });
    Object.assign(d.lines[1], { description: 'Twelve months', unitPrice: 249.505 });
    delete d.totals;
  }),
  'credit note': sample((d) => Object.assign(d, { typeCode: '381', precedingInvoiceNumber: 'RE-2026-0041', precedingInvoiceDate: '2026-10-20' })),
  'corrected invoice replacing an earlier plain PDF': sample((d) =>
    Object.assign(d, { typeCode: '384', precedingInvoiceNumber: 'RE-2026-0042', precedingInvoiceDate: '2026-11-03', number: 'RE-2026-0042-K' }),
  ),
};

/** What XRechnung asks for on top: the buyer reference (Leitweg-ID), a contact at the seller, an electronic address of the buyer. */
const forXRechnung = (invoice: InvoiceDraft): InvoiceDraft => {
  const draft = structuredClone(invoice) as any;
  draft.buyerReference ??= '99000000-BEISPIEL-00';
  draft.seller = { contactName: 'Erika Muster', phone: '+49 30 1234567', ...draft.seller };
  draft.buyer = { email: 'einkauf@beispiel.example', ...draft.buyer };
  return draft;
};
// An intra-community supply is left out: as an XRechnung it needs a delivery address, which the data cannot hold, and `check` refuses it.
const { 'intra-community supply of goods': _refused, ...SHARED } = CASES;
const XRECHNUNG_CASES: Record<string, InvoiceDraft> = Object.fromEntries(
  Object.entries({
    ...SHARED,
    'no bank account': sample((d) => {
      delete d.iban;
      delete d.bic;
    }),
    'cash discount in the payment terms': sample((d) => (d.paymentTerms = 'Zahlbar innerhalb von 30 Tagen.\n#SKONTO#TAGE=14#PROZENT=2.00#')),
    'credit note with negative amounts and neither due date nor bank account': sample((d) => {
      for (const line of d.lines) line.quantity = -line.quantity;
      for (const field of ['dueDate', 'paymentTerms', 'iban', 'bic', 'totals']) delete d[field];
      Object.assign(d, { typeCode: '381', precedingInvoiceNumber: 'RE-2026-0041', precedingInvoiceDate: '2026-10-20' });
    }),
  }).map(([name, invoice]) => [name, forXRechnung(invoice)]),
);
const XRECHNUNG_3_0 = 'urn:cen.eu:en16931:2017#compliant#urn:xeinkauf.de:kosit:xrechnung_3.0';

const status = (report: string, part: 'pdf' | 'xml') => new RegExp(`<${part}>[\\s\\S]*?<summary status="(\\w+)"`).exec(report)?.[1];
const problems = (report: string) => [...report.matchAll(/<(?:error|warning)[^>]*>([^<]+)/g)].map((m) => m[1]!.trim());

describe.skipIf(!jar)('reference validation with Mustang', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pdf-to-einvoice-'));
  const samplePdf = () => new Uint8Array(file('sample-invoice.pdf'));
  /** Writes the file and returns what the validator says about it. */
  const validate = async (name: string, content: Uint8Array | string) => {
    const path = join(dir, name.replace(/[^\w.]+/g, '-'));
    writeFileSync(path, content);
    const { stdout } = await promisify(execFile)('java', ['-jar', jar!, '--no-notices', '--action', 'validate', '--source', path], {
      maxBuffer: 64 * 1024 * 1024,
    }).catch((e) => e as { stdout: string });
    return { pdf: status(stdout, 'pdf'), xml: status(stdout, 'xml'), problems: problems(stdout), report: stdout };
  };

  // Without a delivery date and a country of delivery there is nothing to say about the delivery, and nothing is made
  // up: the element the syntax demands stays empty, as in official samples of the standard. The validator accepts the
  // file and remarks on the empty element.
  const REMARKS: Record<string, unknown[]> = { 'service period instead of a delivery date': [expect.stringContaining('PEPPOL-EN16931-R008')] };

  it.concurrent.each(Object.entries(CASES))(
    '%s',
    async (name, invoice) => {
      const { pdf } = await createEInvoice({ pdf: samplePdf(), invoice });
      expect(await validate(`${name}.pdf`, pdf)).toMatchObject({ pdf: 'valid', xml: 'valid', problems: REMARKS[name] ?? [] });
    },
    120_000,
  );

  it('a PDF that came with a script is a valid PDF/A-3 once the script is removed', async () => {
    const doc = await PDFDocument.load(samplePdf(), { updateMetadata: false });
    doc.catalog.set(PDFName.of('OpenAction'), doc.context.obj({ Type: 'Action', S: 'JavaScript', JS: PDFString.of("app.alert('x')") }));
    const { pdf, findings } = await createEInvoice({ pdf: await doc.save(), invoice: sample() });
    expect(findings.map((finding) => finding.code)).toEqual(['pdf-actions']);
    expect(await validate('with-script.pdf', pdf)).toMatchObject({ pdf: 'valid', xml: 'valid', problems: [] });
  }, 120_000);

  describe('XRechnung', () => {
    it.concurrent.each(Object.entries(XRECHNUNG_CASES))(
      'as UBL: %s',
      async (name, invoice) => {
        const { xml } = await createXRechnung({ invoice });
        const result = await validate(`${name}.ubl.xml`, xml);
        expect(result).toMatchObject({ xml: 'valid', problems: [] });
        expect(result.report).toContain(`<profile>${XRECHNUNG_3_0}</profile>`);
      },
      120_000,
    );

    it.concurrent.each(Object.entries(XRECHNUNG_CASES))(
      'as CII: %s',
      async (name, invoice) => {
        const { xml } = await createXRechnung({ invoice, syntax: 'cii' });
        const result = await validate(`${name}.cii.xml`, xml);
        expect(result).toMatchObject({ xml: 'valid', problems: [] });
        expect(result.report).toContain(`<profile>${XRECHNUNG_3_0}</profile>`);
      },
      120_000,
    );

    it.concurrent.each(Object.entries(XRECHNUNG_CASES))(
      'in a hybrid PDF: %s',
      async (name, invoice) => {
        const { pdf } = await createEInvoice({ pdf: samplePdf(), invoice, profile: 'xrechnung' });
        const result = await validate(`${name}.xrechnung.pdf`, pdf);
        expect(result).toMatchObject({ pdf: 'valid', xml: 'valid', problems: [] });
        expect(result.report).toContain(`<profile>${XRECHNUNG_3_0}</profile>`);
      },
      120_000,
    );

    // The cases above prove something only while the validator applies the XRechnung rules to the files. These make sure it does:
    // the same files, with one thing taken out that only XRechnung asks for.
    it.concurrent.each([
      ['UBL', 'ubl', /<cbc:BuyerReference>[^<]*<\/cbc:BuyerReference>/],
      ['CII', 'cii', /<ram:BuyerReference>[^<]*<\/ram:BuyerReference>/],
    ] as const)(
      'the validator applies the XRechnung rules to %s',
      async (_name, syntax, buyerReference) => {
        const { xml } = await createXRechnung({ invoice: XRECHNUNG_CASES['domestic invoice with VAT']!, syntax });
        expect(xml).toMatch(buyerReference);
        const result = await validate(`without-buyer-reference.${syntax}.xml`, xml.replace(buyerReference, ''));
        expect(result.xml).toBe('invalid');
        expect(result.problems).toEqual([expect.stringContaining('[BR-DE-15]')]);
      },
      120_000,
    );
  });
});
