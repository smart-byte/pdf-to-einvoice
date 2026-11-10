import { readFileSync } from 'node:fs';
import { PDFArray, PDFBool, PDFDict, PDFDocument, PDFName, PDFRawStream, StandardFonts, decodePDFRawStream } from '@cantoo/pdf-lib';
import { describe, expect, it } from 'vitest';
import { createEInvoice, InvoiceError } from '../src/create.js';
import { readEmbeddedXml } from '../src/pdf.js';
import type { InvoiceDraft } from '../src/model.js';

const file = (name: string) => readFileSync(new URL(`../examples/${name}`, import.meta.url));
const samplePdf = () => new Uint8Array(file('sample-invoice.pdf'));
const sample = (change: (draft: any) => void = () => {}): InvoiceDraft => {
  const draft = JSON.parse(file('sample-invoice.json').toString());
  change(draft);
  return draft;
};

/** A PDF whose text uses a standard font that is referenced but not embedded. */
async function pdfWithoutEmbeddedFont(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.addPage().drawText('Invoice', { font: await doc.embedFont(StandardFonts.Helvetica) });
  return doc.save();
}

/** The drawing instructions of page 1, decoded. */
const firstPageContent = async (pdf: Uint8Array) => {
  const doc = await PDFDocument.load(pdf);
  const contents = doc.getPage(0).node.Contents();
  const streams = contents instanceof PDFArray ? contents.asArray().map((ref) => doc.context.lookup(ref)) : [contents];
  return streams.map((s) => Buffer.from(decodePDFRawStream(s as PDFRawStream).decode()).toString('latin1')).join('');
};

const failure = (promise: Promise<unknown>) =>
  promise.then(
    () => undefined,
    (e: InvoiceError) => e,
  );

describe('createEInvoice', () => {
  it('embeds the invoice data as XML into the PDF', async () => {
    const result = await createEInvoice({ pdf: samplePdf(), invoice: sample() });
    expect(result.xml).toContain('<ram:ID>RE-2026-0042</ram:ID>');
    expect(await readEmbeddedXml(result.pdf)).toBe(result.xml);
  });

  it('declares the EN 16931 profile', async () => {
    const { xml } = await createEInvoice({ pdf: samplePdf(), invoice: sample() });
    expect(xml).toMatch(/<ram:GuidelineSpecifiedDocumentContextParameter>\s*<ram:ID>urn:cen\.eu:en16931:2017<\/ram:ID>/);
  });

  it('writes the calculated totals', async () => {
    const { xml } = await createEInvoice({ pdf: samplePdf(), invoice: sample() });
    expect(xml).toContain('<ram:TaxBasisTotalAmount>1499.00</ram:TaxBasisTotalAmount>');
    expect(xml).toContain('<ram:TaxTotalAmount currencyID="EUR">284.81</ram:TaxTotalAmount>');
    expect(xml).toContain('<ram:GrandTotalAmount>1783.81</ram:GrandTotalAmount>');
    expect(xml).toContain('<ram:DuePayableAmount>1783.81</ram:DuePayableAmount>');
  });

  it('keeps the precision of a unit price', async () => {
    const invoice = sample((d) => {
      d.lines[1].unitPrice = 249.505;
      delete d.totals;
    });
    const { xml } = await createEInvoice({ pdf: samplePdf(), invoice });
    expect(xml).toContain('<ram:ChargeAmount>249.505</ram:ChargeAmount>');
  });

  it('writes every optional value it is given', async () => {
    const values = { orderReference: 'PO-77', buyerReference: 'REF-1', note: 'Thank you.' };
    const invoice = sample((d) => {
      Object.assign(d, values);
      Object.assign(d.seller, { phone: '+49 30 1234567', contactName: 'Erika Muster' });
      d.lines[1].description = 'Twelve months';
    });
    const { xml, findings } = await createEInvoice({ pdf: samplePdf(), invoice });
    for (const value of [...Object.values(values), '+49 30 1234567', 'Erika Muster', 'Twelve months', 'rechnung@muster-software.example', 'BYLADEM1001']) {
      expect(xml).toContain(`>${value}<`);
    }
    expect(xml).toMatch(/<ram:BuyerOrderReferencedDocument>\s*<ram:IssuerAssignedID>PO-77</);
    expect(findings).toEqual([]);
  });

  it('leaves the page content untouched', async () => {
    const result = await createEInvoice({ pdf: samplePdf(), invoice: sample() });
    expect(await firstPageContent(result.pdf)).toBe(await firstPageContent(samplePdf()));
  });

  it('names itself as the program that produced the file', async () => {
    const { pdf } = await createEInvoice({ pdf: samplePdf(), invoice: sample() });
    const doc = await PDFDocument.load(pdf, { updateMetadata: false });
    expect(doc.getProducer()).toBe('pdf-to-einvoice');
    // PDF/A wants the document properties and the XMP metadata to say the same.
    expect(Buffer.from(pdf).toString('latin1')).toContain('<pdf:Producer>pdf-to-einvoice</pdf:Producer>');
  });

  it('reports nothing for the sample', async () => {
    const result = await createEInvoice({ pdf: samplePdf(), invoice: sample() });
    expect(result.findings).toEqual([]);
  });

  it('refuses data with errors and says which', async () => {
    const error = await failure(createEInvoice({ pdf: samplePdf(), invoice: sample((d) => delete d.number) }));
    expect(error).toBeInstanceOf(InvoiceError);
    expect(error?.code).toBe('invalid-invoice');
    expect(error?.findings.map((f) => f.path)).toEqual(['number']);
  });

  it('warns when the PDF uses fonts it does not embed', async () => {
    const result = await createEInvoice({ pdf: await pdfWithoutEmbeddedFont(), invoice: sample() });
    expect(result.findings).toMatchObject([{ severity: 'warning', code: 'pdf-fonts' }]);
    expect(result.findings[0]!.message).toContain('Helvetica');
  });

  it('refuses a file that is not a PDF', async () => {
    const error = await failure(createEInvoice({ pdf: new TextEncoder().encode('hello'), invoice: sample() }));
    expect(error?.code).toBe('invalid-pdf');
  });

  it('refuses a PDF that already carries an e-invoice', async () => {
    const first = await createEInvoice({ pdf: samplePdf(), invoice: sample() });
    const error = await failure(createEInvoice({ pdf: first.pdf, invoice: sample() }));
    expect(error?.code).toBe('already-einvoice');
  });
});

describe('createEInvoice for sales without VAT', () => {
  const withoutVat = (category: string, change: (draft: any) => void = () => {}) =>
    sample((d) => {
      for (const line of d.lines) Object.assign(line, { vatCategory: category, vatRate: 0 });
      d.vatExemptionReason = 'No VAT charged.';
      delete d.totals;
      change(d);
    });

  it('states the reason next to the zero VAT amount', async () => {
    const invoice = withoutVat('AE', (d) => (d.buyer.vatId = 'ATU12345678'));
    const { xml } = await createEInvoice({ pdf: samplePdf(), invoice });
    expect(xml).toContain('<ram:ExemptionReason>No VAT charged.</ram:ExemptionReason>');
    expect(xml).toContain('<ram:GrandTotalAmount>1499.00</ram:GrandTotalAmount>');
  });

  it('gives no VAT rate on a sale that is not subject to VAT', async () => {
    const { xml } = await createEInvoice({ pdf: samplePdf(), invoice: withoutVat('O') });
    expect(xml).not.toContain('RateApplicablePercent');
  });

  it('keeps the seller VAT ID as a plain identifier where the standard forbids it as a VAT ID', async () => {
    // EN 16931 rule BR-O-02: no VAT identifiers on an invoice that is not subject to VAT.
    const { xml } = await createEInvoice({ pdf: samplePdf(), invoice: withoutVat('O') });
    expect(xml).not.toContain('schemeID="VA"');
    expect(xml).toContain('<ram:ID>DE123456789</ram:ID>');
  });

  it('names the buyer country as the place of delivery of an intra-community supply', async () => {
    const invoice = withoutVat('K', (d) => Object.assign(d.buyer, { country: 'AT', vatId: 'ATU12345678' }));
    const { xml } = await createEInvoice({ pdf: samplePdf(), invoice });
    expect(xml).toMatch(/<ram:ShipToTradeParty>[\s\S]*<ram:CountryID>AT<\/ram:CountryID>[\s\S]*<\/ram:ShipToTradeParty>/);
  });
});

describe('createEInvoice repairs what PDF/A forbids', () => {
  // A 1x1 PNG.
  const PNG = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='), (c) => c.charCodeAt(0));
  const interpolated = async (pdf: Uint8Array) => {
    const doc = await PDFDocument.load(pdf);
    return doc.context
      .enumerateIndirectObjects()
      .map(([, object]) => (object instanceof PDFRawStream ? object.dict : object))
      .filter((object): object is PDFDict => object instanceof PDFDict && object.get(PDFName.of('Subtype')) === PDFName.of('Image'))
      .map((image) => image.get(PDFName.of('Interpolate'))?.toString())
      .filter(Boolean);
  };

  it('switches off image interpolation', async () => {
    const doc = await PDFDocument.create();
    const image = await doc.embedPng(PNG);
    doc.addPage().drawImage(image);
    await doc.flush();
    (doc.context.lookup(image.ref) as PDFRawStream).dict.set(PDFName.of('Interpolate'), PDFBool.True);
    const input = await doc.save();
    expect(await interpolated(input)).toEqual(['true']);

    const result = await createEInvoice({ pdf: input, invoice: sample() });
    expect(await interpolated(result.pdf)).toEqual(['false']);
  });
});

describe('createEInvoice without a delivery date', () => {
  const shipToCountry = (xml: string) => /<ram:ShipToTradeParty>[\s\S]*?<ram:CountryID>(\w+)<\/ram:CountryID>/.exec(xml)?.[1];
  const withPeriod = (d: any) => {
    delete d.deliveryDate;
    Object.assign(d, { periodStart: '2026-10-01', periodEnd: '2026-10-31' });
  };

  it('names the seller country as place of supply when VAT is charged', async () => {
    const { xml } = await createEInvoice({ pdf: samplePdf(), invoice: sample(withPeriod) });
    expect(shipToCountry(xml)).toBe('DE');
  });

  it('names the buyer country as place of supply when the VAT is owed abroad', async () => {
    const invoice = sample((d) => {
      withPeriod(d);
      for (const line of d.lines) Object.assign(line, { vatCategory: 'AE', vatRate: 0 });
      Object.assign(d.buyer, { country: 'AT', vatId: 'ATU12345678' });
      d.vatExemptionReason = 'Reverse charge.';
      delete d.totals;
    });
    const { xml } = await createEInvoice({ pdf: samplePdf(), invoice });
    expect(shipToCountry(xml)).toBe('AT');
  });

  it('adds no place of supply when the delivery date is given', async () => {
    const { xml } = await createEInvoice({ pdf: samplePdf(), invoice: sample() });
    expect(shipToCountry(xml)).toBeUndefined();
  });
});

describe('readEmbeddedXml', () => {
  it('returns null for a PDF without an invoice', async () => {
    expect(await readEmbeddedXml(samplePdf())).toBeNull();
  });
});
