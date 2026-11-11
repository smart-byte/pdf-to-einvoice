import { readFileSync } from 'node:fs';
import { PDFDocument, PDFName, PDFString, StandardFonts } from '@cantoo/pdf-lib';
import { describe, expect, it } from 'vitest';
import { createEInvoice } from '../src/create.js';
import type { InvoiceDraft } from '../src/model.js';
import { inspectPdf } from '../src/pdf.js';
import { extractText } from '../src/text.js';
import { validateEInvoice } from '../src/validate.js';

const file = (name: string) => readFileSync(new URL(`../examples/${name}`, import.meta.url));
const samplePdf = () => new Uint8Array(file('sample-invoice.pdf'));
const sample = (change: (draft: any) => void = () => {}): InvoiceDraft => {
  const draft = JSON.parse(file('sample-invoice.json').toString());
  change(draft);
  return draft;
};
const create = (invoice = sample()) => createEInvoice({ pdf: samplePdf(), invoice });

/** A bare PDF made outside the generator that carries the given XML: no PDF/A metadata, blank page unless text is drawn. */
async function pdfCarrying(xml: string, drawText = false): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage();
  if (drawText) page.drawText('Invoice', { font: await doc.embedFont(StandardFonts.Helvetica) });
  await doc.attach(new TextEncoder().encode(xml), 'factur-x.xml', { mimeType: 'text/xml' });
  return doc.save();
}

const codes = (findings: { code: string }[]) => findings.map((f) => f.code);

describe('validateEInvoice', () => {
  it('reports a script in the file, which PDF/A forbids', async () => {
    const doc = await PDFDocument.load((await create()).pdf, { updateMetadata: false });
    doc.catalog.set(PDFName.of('OpenAction'), doc.context.obj({ S: 'JavaScript', JS: PDFString.of("app.alert('x')") }));
    const result = await validateEInvoice(await doc.save());
    expect(result.findings).toMatchObject([{ severity: 'warning', code: 'pdf-actions' }]);
    expect(result.findings[0]!.message).toContain('JavaScript');
  });

  it('accepts a created e-invoice without findings', async () => {
    const created = await create();
    const result = await validateEInvoice(created.pdf, { pdfText: await extractText(created.pdf) });
    expect(result).toMatchObject({
      isEInvoice: true,
      profile: 'urn:cen.eu:en16931:2017',
      xml: created.xml,
      invoice: { number: 'RE-2026-0042', seller: { vatId: 'DE123456789' } },
      totals: created.totals,
      findings: [],
    });
  });

  it('accepts its own e-invoice for a sale that is not subject to VAT', async () => {
    // For such invoices the VAT ID travels as the plain seller identifier (EN 16931 rule BR-O-02).
    const invoice = sample((d) => {
      for (const line of d.lines) Object.assign(line, { vatCategory: 'O', vatRate: 0 });
      d.vatExemptionReason = 'Not taxable in Germany.';
      delete d.totals;
    });
    const result = await validateEInvoice((await create(invoice)).pdf);
    expect(result.findings.filter((f) => f.severity === 'error')).toEqual([]);
    expect(result.invoice?.seller?.vatId).toBe('DE123456789');
  });

  it('reports a PDF without invoice XML and stops', async () => {
    const result = await validateEInvoice(samplePdf(), { pdfText: await extractText(samplePdf()) });
    expect(result).toEqual({ isEInvoice: false, findings: [expect.objectContaining({ severity: 'error', code: 'no-xml' })] });
  });

  it('reports a value of the XML that the visible PDF does not show', async () => {
    const created = await create(sample((d) => (d.number = 'RE-2026-0043')));
    const result = await validateEInvoice(created.pdf, { pdfText: await extractText(created.pdf) });
    expect(result.isEInvoice).toBe(true);
    expect(result.findings).toMatchObject([{ path: 'number', severity: 'warning', code: 'not-in-pdf' }]);
    expect(result.findings[0]!.message).toContain('RE-2026-0043');
  });

  it('does not compare with the page when no text is given', async () => {
    const created = await create(sample((d) => (d.number = 'RE-2026-0043')));
    expect((await validateEInvoice(created.pdf)).findings).toEqual([]);
  });

  it('warns when the PDF does not declare PDF/A-3', async () => {
    const result = await validateEInvoice(await pdfCarrying((await create()).xml));
    expect(result.isEInvoice).toBe(true);
    expect(result.findings).toMatchObject([{ severity: 'warning', code: 'pdf-a' }]);
  });

  describe('a line total that is not quantity times price', () => {
    // The sample bills 10 hours at 100.00. Here the price is 115.00, and a discount of 150.00 on the line explains the total.
    const discount =
      '<ram:SpecifiedTradeAllowanceCharge><ram:ChargeIndicator><udt:Indicator>false</udt:Indicator></ram:ChargeIndicator><ram:ActualAmount>150.00</ram:ActualAmount></ram:SpecifiedTradeAllowanceCharge>';
    const priced = async (extra = '') => {
      const xml = (await create()).xml;
      const changed = xml
        .replace(/<ram:ChargeAmount>100(\.0+)?<\/ram:ChargeAmount>/, '<ram:ChargeAmount>115.00</ram:ChargeAmount>')
        .replace('<ram:SpecifiedTradeSettlementLineMonetarySummation>', `${extra}<ram:SpecifiedTradeSettlementLineMonetarySummation>`);
      expect(changed).not.toBe(xml);
      return validateEInvoice(await pdfCarrying(changed));
    };
    const aboutLines = (findings: { code: string; severity: string; path: string }[]) =>
      findings.filter((f) => f.code === 'line-net').map((f) => `${f.severity} ${f.path}`);

    it('is accepted where the XML states a discount on the line', async () => {
      expect(aboutLines((await priced(discount)).findings)).toEqual([]);
    });

    it('is a warning where nothing in the XML explains it: the standard does not forbid it', async () => {
      const result = await priced();
      expect(aboutLines(result.findings)).toEqual(['warning lines.0.netAmount']);
      expect(result.findings.find((f) => f.code === 'line-net')!.message).toContain('1150.00');
    });
  });

  it('warns about fonts that are not embedded', async () => {
    const result = await validateEInvoice(await pdfCarrying((await create()).xml, true));
    expect(codes(result.findings)).toEqual(['pdf-a', 'pdf-fonts']);
    expect(result.findings[1]!.message).toContain('Helvetica');
  });

  it('does not accept a profile below EN 16931 as an e-invoice', async () => {
    const xml = (await create()).xml.replace('urn:cen.eu:en16931:2017', 'urn:factur-x.eu:1p0:basicwl');
    const result = await validateEInvoice(await pdfCarrying(xml));
    expect(result).toMatchObject({ isEInvoice: false, profile: 'urn:factur-x.eu:1p0:basicwl' });
    expect(result.findings).toMatchObject([{ severity: 'error', code: 'profile' }, { code: 'pdf-a' }]);
  });

  it('accepts the profiles built on EN 16931', async () => {
    const xrechnung = 'urn:cen.eu:en16931:2017#compliant#urn:xeinkauf.de:kosit:xrechnung_3.0';
    const xml = (await create()).xml.replace('urn:cen.eu:en16931:2017', xrechnung);
    expect(await validateEInvoice(await pdfCarrying(xml))).toMatchObject({ isEInvoice: true, profile: xrechnung });
  });

  it('reports XML that is not a Cross Industry Invoice', async () => {
    const result = await validateEInvoice(await pdfCarrying('<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"/>'));
    expect(result.isEInvoice).toBe(false);
    expect(result.invoice).toBeUndefined();
    expect(result.findings[0]).toMatchObject({ severity: 'error', code: 'xml-syntax' });
  });

  it('reports totals in the XML that contradict its lines', async () => {
    const xml = (await create()).xml.replace('<ram:GrandTotalAmount>1783.81<', '<ram:GrandTotalAmount>1800.00<');
    const result = await validateEInvoice(await pdfCarrying(xml));
    const mismatch = result.findings.find((f) => f.code === 'totals-mismatch');
    expect(mismatch).toMatchObject({ path: 'totals.gross', severity: 'error' });
    expect(mismatch!.message).toMatch(/XML.*1800\.00.*1783\.81/);
  });
});

describe('inspectPdf', () => {
  it('tells the PDF/A part the metadata declares', async () => {
    expect((await inspectPdf((await create()).pdf)).pdfaPart).toBe('3');
    expect((await inspectPdf(samplePdf())).pdfaPart).toBeNull();
  });
});
