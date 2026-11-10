import { readFileSync } from 'node:fs';
import { PDFArray, PDFBool, PDFDict, PDFDocument, PDFName, PDFRawStream, StandardFonts, decodePDFRawStream } from '@cantoo/pdf-lib';
import { describe, expect, it } from 'vitest';
import { createEInvoice, createXRechnung, InvoiceError } from '../src/create.js';
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

describe('XRechnung', () => {
  const XRECHNUNG_3_0 = 'urn:cen.eu:en16931:2017#compliant#urn:xeinkauf.de:kosit:xrechnung_3.0';
  /** The sample with what XRechnung asks for on top, and one change applied. */
  const xrechnung = (change: (draft: any) => void = () => {}) =>
    sample((d) => {
      d.buyerReference = '99000000-BEISPIEL-00';
      Object.assign(d.seller, { contactName: 'Erika Muster', phone: '+49 30 1234567' });
      d.buyer.email = 'einkauf@beispiel.example';
      change(d);
    });
  const both = async (invoice: InvoiceDraft) => ({
    ubl: (await createXRechnung({ invoice })).xml,
    cii: (await createXRechnung({ invoice, syntax: 'cii' })).xml,
  });

  describe('createXRechnung', () => {
    it('writes a UBL invoice that declares XRechnung 3.0, unless asked for CII', async () => {
      const result = await createXRechnung({ invoice: xrechnung() });
      expect(result.xml).toContain('<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"');
      expect(result.xml).toContain(`<cbc:CustomizationID>${XRECHNUNG_3_0}</cbc:CustomizationID>`);
      expect(result.xml).toContain('<cbc:BuyerReference>99000000-BEISPIEL-00</cbc:BuyerReference>');
      expect(result.xml).toContain('<cbc:PayableAmount currencyID="EUR">1783.81</cbc:PayableAmount>');
      expect(result.totals).toMatchObject({ net: 1499, vat: 284.81, gross: 1783.81 });
      expect(result.findings).toEqual([]);
    });

    it('writes a Cross Industry Invoice that declares XRechnung 3.0 when asked for CII', async () => {
      const { xml, findings } = await createXRechnung({ invoice: xrechnung(), syntax: 'cii' });
      expect(xml).toContain('<rsm:CrossIndustryInvoice');
      expect(xml).toMatch(new RegExp(`<ram:GuidelineSpecifiedDocumentContextParameter>\\s*<ram:ID>${XRECHNUNG_3_0}</ram:ID>`));
      expect(xml).toContain('<ram:BuyerReference>99000000-BEISPIEL-00</ram:BuyerReference>');
      expect(findings).toEqual([]);
    });

    it('refuses data that lacks what XRechnung asks for, and says what', async () => {
      const error = await failure(createXRechnung({ invoice: sample() }));
      expect(error).toBeInstanceOf(InvoiceError);
      expect(error?.code).toBe('invalid-invoice');
      expect(error?.findings.map((f) => f.code)).toEqual([
        'xrechnung-buyer-reference',
        'xrechnung-seller-contact',
        'xrechnung-seller-phone',
        'xrechnung-buyer-email',
      ]);
    });

    it('passes on the warnings of the check', async () => {
      const { findings } = await createXRechnung({ invoice: xrechnung((d) => delete d.buyer.street) });
      expect(findings).toMatchObject([{ path: 'buyer.street', severity: 'warning', code: 'address' }]);
    });

    it('writes every optional value it is given, in both syntaxes', async () => {
      const invoice = xrechnung((d) => {
        Object.assign(d, { orderReference: 'PO-77', note: 'Thank you.', precedingInvoiceNumber: 'RE-2026-0001', precedingInvoiceDate: '2026-09-09' });
        Object.assign(d, { periodStart: '2026-10-01', periodEnd: '2026-10-30', prepaidAmount: 100.5 });
        Object.assign(d.seller, { taxNumber: '123/456/78901' });
        Object.assign(d.buyer, { vatId: 'DE987654321', phone: '+49 40 7654321', contactName: 'Max Beispiel' });
        d.lines[1].description = 'Twelve months';
        delete d.totals;
      });
      const { lines, seller, buyer, ...head } = invoice as any;
      const names = lines.flatMap((line: any) => [line.name, line.description]);
      const given: string[] = [head, seller, buyer]
        .flatMap((part) => Object.values(part))
        .concat(names)
        .filter((value) => typeof value === 'string');
      expect(given).toHaveLength(37);
      const xml = await both(invoice);
      // A date reads 2026-11-17 in UBL and 20261117 in CII.
      expect(given.filter((value) => !xml.ubl.includes(`>${value}<`))).toEqual([]);
      expect(given.filter((value) => !xml.cii.includes(`>${value}<`) && !xml.cii.includes(`>${value.replaceAll('-', '')}<`))).toEqual([]);
      expect(xml.ubl).toContain('<cbc:PrepaidAmount currencyID="EUR">100.50</cbc:PrepaidAmount>');
      expect(xml.cii).toContain('<ram:TotalPrepaidAmount>100.50</ram:TotalPrepaidAmount>');
    });

    it('states payment instructions also where no bank account is given', async () => {
      const xml = await both(
        xrechnung((d) => {
          delete d.iban;
          delete d.bic;
        }),
      );
      // 1 stands for "instrument not defined" in the code list of payment means (UNTDID 4461).
      expect(xml.ubl).toMatch(/<cac:PaymentMeans>\s*<cbc:PaymentMeansCode>1<\/cbc:PaymentMeansCode>\s*<\/cac:PaymentMeans>/);
      expect(xml.cii).toMatch(/<ram:SpecifiedTradeSettlementPaymentMeans>\s*<ram:TypeCode>1<\/ram:TypeCode>\s*<\/ram:SpecifiedTradeSettlementPaymentMeans>/);
    });

    it('gives the rate 0 in the VAT breakdown of a sale that is not subject to VAT, and none on its lines', async () => {
      const xml = await both(
        xrechnung((d) => {
          for (const line of d.lines) Object.assign(line, { vatCategory: 'O', vatRate: 0 });
          d.vatExemptionReason = 'Not taxable in Germany.';
          delete d.totals;
        }),
      );
      expect(xml.ubl.match(/<cbc:Percent>/g)).toHaveLength(1);
      expect(xml.ubl).toMatch(/<cac:TaxSubtotal>[\s\S]*<cbc:Percent>0<\/cbc:Percent>[\s\S]*<\/cac:TaxSubtotal>/);
      expect(xml.cii.match(/<ram:RateApplicablePercent>/g)).toHaveLength(1);
      expect(xml.cii).toMatch(/<ram:ApplicableHeaderTradeSettlement>[\s\S]*<ram:RateApplicablePercent>0<\/ram:RateApplicablePercent>/);
    });

    it('names no place of delivery, of which it would know the country alone', async () => {
      const xml = await both(
        xrechnung((d) => {
          delete d.deliveryDate;
          Object.assign(d, { periodStart: '2026-10-01', periodEnd: '2026-10-31' });
        }),
      );
      expect(xml.ubl).not.toContain('<cac:Delivery>');
      expect(xml.cii).not.toContain('ShipToTradeParty');
    });

    it('writes a credit note as a UBL credit note that keeps its due date', async () => {
      const { xml } = await createXRechnung({ invoice: xrechnung((d) => (d.typeCode = '381')) });
      expect(xml).toContain('<CreditNote xmlns="urn:oasis:names:specification:ubl:schema:xsd:CreditNote-2"');
      expect(xml).toContain('<cbc:CreditNoteTypeCode>381</cbc:CreditNoteTypeCode>');
      expect(xml).toMatch(/<cbc:PaymentMeansCode>58<\/cbc:PaymentMeansCode>\s*<cbc:PaymentDueDate>2026-11-17<\/cbc:PaymentDueDate>/);
    });

    it('ends payment terms that grant a cash discount with a line break, as XRechnung wants it', async () => {
      const invoice = xrechnung((d) => (d.paymentTerms = 'Zahlbar in 30 Tagen.\n#SKONTO#TAGE=14#PROZENT=2.00#'));
      const xml = await both(invoice);
      expect((await createXRechnung({ invoice })).findings).toEqual([]);
      expect(xml.ubl).toContain('<cbc:Note>Zahlbar in 30 Tagen.\n#SKONTO#TAGE=14#PROZENT=2.00#\n</cbc:Note>');
      expect(xml.cii).toContain('<ram:Description>Zahlbar in 30 Tagen.\n#SKONTO#TAGE=14#PROZENT=2.00#\n</ram:Description>');
    });
  });

  describe('createEInvoice with the profile xrechnung', () => {
    it('attaches XML that declares XRechnung 3.0', async () => {
      const result = await createEInvoice({ pdf: samplePdf(), invoice: xrechnung(), profile: 'xrechnung' });
      expect(result.xml).toMatch(new RegExp(`<ram:GuidelineSpecifiedDocumentContextParameter>\\s*<ram:ID>${XRECHNUNG_3_0}</ram:ID>`));
      expect(await readEmbeddedXml(result.pdf)).toBe(result.xml);
      expect(result.findings).toEqual([]);
    });

    it('applies the XRechnung rules to the data', async () => {
      const error = await failure(createEInvoice({ pdf: samplePdf(), invoice: sample(), profile: 'xrechnung' }));
      expect(error?.code).toBe('invalid-invoice');
      expect(error?.findings.map((f) => f.path)).toEqual(['buyerReference', 'seller.contactName', 'seller.phone', 'buyer.email']);
    });

    it('writes the XML as createXRechnung does', async () => {
      const invoice = xrechnung((d) => {
        delete d.iban;
        delete d.bic;
        delete d.deliveryDate;
        Object.assign(d, { periodStart: '2026-10-01', periodEnd: '2026-10-31' });
      });
      const hybrid = await createEInvoice({ pdf: samplePdf(), invoice, profile: 'xrechnung' });
      expect(hybrid.xml).toBe((await createXRechnung({ invoice, syntax: 'cii' })).xml);
    });

    it('leaves the pages as they are', async () => {
      const result = await createEInvoice({ pdf: samplePdf(), invoice: xrechnung(), profile: 'xrechnung' });
      expect(await firstPageContent(result.pdf)).toBe(await firstPageContent(samplePdf()));
    });
  });
});
