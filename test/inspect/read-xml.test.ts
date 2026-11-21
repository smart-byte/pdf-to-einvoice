import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { check } from '../../src/domain/check.js';
import { createEInvoice } from '../../src/generate/create.js';
import type { InvoiceDraft } from '../../src/domain/model.js';
import { readInvoiceXml } from '../../src/inspect/read-xml.js';

const file = (name: string) => readFileSync(new URL(`../../examples/${name}`, import.meta.url));
const samplePdf = () => new Uint8Array(file('sample-invoice.pdf'));
const printedTotals = () => JSON.parse(file('sample-invoice.json').toString()).totals;
/** The sample data without its printed totals, with one change applied. */
const sample = (change: (draft: any) => void = () => {}): InvoiceDraft => {
  const draft = JSON.parse(file('sample-invoice.json').toString());
  delete draft.totals;
  change(draft);
  return draft;
};
const xmlOf = async (invoice: InvoiceDraft) => (await createEInvoice({ pdf: samplePdf(), invoice })).xml;

/** Writes the data as an e-invoice, reads its XML back and expects every value that went in, plus the calculated totals. */
async function roundTrip(input: InvoiceDraft) {
  const created = await createEInvoice({ pdf: samplePdf(), invoice: input });
  const { invoice } = readInvoiceXml(created.xml);
  expect(invoice).toMatchObject(input);
  const { net, vat, gross, due, lineNet } = created.totals;
  expect(invoice.totals).toEqual({ net, vat, gross, due });
  expect(invoice.lines?.map((line) => line.netAmount)).toEqual(lineNet);
  return invoice;
}

describe('readInvoiceXml returns what createEInvoice wrote', () => {
  it('for the sample', async () => {
    const invoice = await roundTrip(sample());
    expect(invoice.totals).toEqual(printedTotals());
    expect(invoice.typeCode).toBe('380');
  });

  it('for two VAT rates', async () => {
    const invoice = await roundTrip(sample((d) => (d.lines[1].vatRate = 7)));
    expect(invoice.totals?.vat).toBe(224.93);
  });

  it('for a reverse charge with the buyer VAT ID and the exemption reason', async () => {
    await roundTrip(
      sample((d) => {
        for (const line of d.lines) Object.assign(line, { vatCategory: 'AE', vatRate: 0 });
        Object.assign(d.buyer, { country: 'AT', vatId: 'ATU12345678' });
        d.vatExemptionReason = 'Steuerschuldnerschaft des Leistungsempfängers (Reverse Charge).';
      }),
    );
  });

  it('for a service period instead of a delivery date', async () => {
    const invoice = await roundTrip(
      sample((d) => {
        delete d.deliveryDate;
        Object.assign(d, { periodStart: '2026-10-01', periodEnd: '2026-10-31' });
      }),
    );
    expect(invoice.deliveryDate).toBeUndefined();
  });

  it('for a seller with a tax number only', async () => {
    const invoice = await roundTrip(
      sample((d) => {
        delete d.seller.vatId;
        d.seller.taxNumber = '12/345/67890';
      }),
    );
    expect(invoice.seller?.vatId).toBeUndefined();
  });

  it('for a prepaid amount', async () => {
    const invoice = await roundTrip(sample((d) => (d.prepaidAmount = 500)));
    expect(invoice.totals).toMatchObject({ gross: 1783.81, due: 1283.81 });
  });

  it('for a credit note that names the invoice it refers to', async () => {
    const invoice = await roundTrip(
      sample((d) => {
        Object.assign(d, {
          typeCode: '381',
          precedingInvoiceNumber: 'RE-2026-0040',
          precedingInvoiceDate: '2026-10-01',
        });
        for (const line of d.lines) line.quantity = -line.quantity;
      }),
    );
    expect(invoice.totals?.gross).toBe(-1783.81);
  });

  it('for notes, references, contacts and line details', async () => {
    await roundTrip(
      sample((d) => {
        Object.assign(d, { note: 'Vielen Dank für Ihren Auftrag.', buyerReference: '04011000-12345-06' });
        Object.assign(d.seller, { phone: '+49 30 1234567', contactName: 'Erika Muster', taxNumber: '12/345/67890' });
        Object.assign(d.buyer, {
          name: 'Beispiel & Söhne AG',
          email: 'einkauf@beispiel.example',
          phone: '030 7654321',
          contactName: 'Max Kunde',
        });
        Object.assign(d.lines[0], {
          description: 'Workshop <vor Ort>',
          quantity: 1.5,
          unit: 'DAY',
          unitPrice: 899.99,
          netAmount: 1349.99,
        });
      }),
    );
  });

  it('for a sale that is not subject to VAT, with rate 0', async () => {
    const invoice = await roundTrip(
      sample((d) => {
        for (const line of d.lines) Object.assign(line, { vatCategory: 'O', vatRate: 0 });
        d.vatExemptionReason = 'Nicht steuerbar.';
        // Category O moves the VAT ID out of the tax registration (see src/generate/ubl.ts); it does not come back as vatId.
        delete d.seller.vatId;
        d.seller.taxNumber = '12/345/67890';
      }),
    );
    expect(invoice.lines?.[0]?.vatRate).toBe(0);
  });

  it('for discounts on lines, as a percentage and as an amount with a reason', async () => {
    const input = sample((d) => {
      d.lines[0].discount = { percent: 10 };
      d.lines[1].discount = { amount: 50, reason: 'Treuerabatt' };
    });
    await roundTrip(input);
    expect(readInvoiceXml(await xmlOf(input))).toMatchObject({ adjustedLines: [], contradictions: [] });
  });

  it('for discounts on lines with a negative quantity', async () => {
    const invoice = await roundTrip(
      sample((d) => {
        for (const line of d.lines) line.quantity = -line.quantity;
        d.lines[0].discount = { percent: 10 };
        d.lines[1].discount = { amount: -50 };
      }),
    );
    expect(invoice.lines?.[0]?.discount?.amount).toBe(-100);
  });

  it('for a single line, as a list of one', async () => {
    const invoice = await roundTrip(sample((d) => (d.lines.length = 1)));
    expect(invoice.lines).toHaveLength(1);
  });
});

describe('readInvoiceXml reads discounts and charges on the whole invoice', () => {
  /** The XML of the sample with one line of 100.00 at 19 % and the given discounts. */
  const oneLine = (discounts: unknown[]) =>
    xmlOf(
      sample((d) => {
        d.lines = [{ ...d.lines[0], quantity: 1 }];
        d.discounts = discounts;
      }),
    );
  /** Writes the data, reads it back and checks what was read: the same totals, nothing to report. */
  async function again(input: InvoiceDraft) {
    const created = await createEInvoice({ pdf: samplePdf(), invoice: input });
    const read = readInvoiceXml(created.xml);
    const checked = check(read.invoice);
    expect(checked.findings).toEqual([]);
    const { net, vat, gross, lineTotal, allowances, charges, vatBreakdown } = created.totals;
    expect(checked.totals).toMatchObject({ net, vat, gross, lineTotal, allowances, charges, vatBreakdown });
    expect(read).toMatchObject({ contradictions: [], percentages: {} });
    return read.invoice;
  }

  it('as one entry for each VAT group, with its percentage, its category and rate, and a reason code as the reason', async () => {
    // 1000.00 at 19 %, 449.10 at 7 % after the discount on the line; 10 % off both, and freight.
    const invoice = await again(
      sample((d) => {
        d.lines[1].vatRate = 7;
        d.lines[1].discount = { percent: 10 };
        d.discounts = [{ percent: 10 }];
        d.charges = [{ amount: 5, reason: 'Fracht', vatRate: 19 }];
      }),
    );
    expect(invoice.discounts).toEqual([
      { percent: 10, amount: 100, reason: '95', vatCategory: 'S', vatRate: 19 },
      { percent: 10, amount: 44.91, reason: '95', vatCategory: 'S', vatRate: 7 },
    ]);
    expect(invoice.charges).toEqual([{ amount: 5, reason: 'Fracht', vatCategory: 'S', vatRate: 19 }]);
  });

  it('with the signs of a credit note', async () => {
    const invoice = await again(
      sample((d) => {
        for (const line of d.lines) line.quantity = -line.quantity;
        d.discounts = [{ percent: 10 }];
        d.charges = [{ amount: -5, reason: 'Fracht' }];
      }),
    );
    expect(invoice.discounts?.[0]).toMatchObject({ percent: 10, amount: -149.9 });
    expect(invoice.charges?.[0]).toMatchObject({ amount: -5 });
  });

  it('in a VAT group without lines, and in category O, which states no rate', async () => {
    const freight = await again(
      sample((d) => {
        for (const line of d.lines) line.vatRate = 7;
        d.charges = [{ amount: 10, reason: 'Fracht', vatRate: 19 }];
      }),
    );
    expect(freight.charges).toEqual([{ amount: 10, reason: 'Fracht', vatCategory: 'S', vatRate: 19 }]);
    const notTaxed = await again(
      sample((d) => {
        for (const line of d.lines) Object.assign(line, { vatCategory: 'O', vatRate: 0 });
        d.vatExemptionReason = 'Nicht steuerbar';
        delete d.seller.vatId;
        d.seller.taxNumber = '123/456/78901';
        d.discounts = [{ amount: 20, reason: 'Treuerabatt' }];
      }),
    );
    expect(notTaxed.discounts).toEqual([{ amount: 20, reason: 'Treuerabatt', vatCategory: 'O', vatRate: 0 }]);
  });

  it('keeps an amount and leaves out a percentage that does not give it from the lines of its VAT group', async () => {
    // The XML takes 10 % of 200.00, which is 20.00; the lines of its VAT group come to 100.00.
    const xml = (await oneLine([{ percent: 20 }]))
      .replace(
        /<ram:CalculationPercent>20(\.0+)?<\/ram:CalculationPercent>/,
        '<ram:CalculationPercent>10</ram:CalculationPercent>',
      )
      .replace('<ram:BasisAmount>100.00</ram:BasisAmount>', '<ram:BasisAmount>200.00</ram:BasisAmount>');
    const read = readInvoiceXml(xml);
    expect(read.invoice.discounts).toEqual([{ amount: 20, reason: '95', vatCategory: 'S', vatRate: 19 }]);
    expect(read.contradictions).toEqual([]);
    expect(read.percentages).toEqual({ 'discounts.0': 10 });
  });

  it('guesses no VAT group for an entry whose XML names no VAT category', async () => {
    const xml = (
      await xmlOf(
        sample((d) => {
          Object.assign(d.lines[1], { vatCategory: 'Z', vatRate: 0 });
          d.discounts = [{ amount: 10, vatRate: 19 }];
        }),
      )
    ).replace(/<ram:CategoryTradeTax>[\s\S]*?<\/ram:CategoryTradeTax>/, '');
    const { invoice } = readInvoiceXml(xml);
    expect(invoice.discounts).toEqual([{ amount: 10, reason: '95' }]);
    expect(check(invoice).findings).toContainEqual(
      expect.objectContaining({ path: 'discounts.0.vatRate', code: 'adjustment-group' }),
    );
  });

  it('names an entry whose percentage, base and amount disagree in the XML, whatever the lines say', async () => {
    // Base 50, 10 %, amount 10: against the lines (100.00) 10 % is 10 again, so only the XML shows the contradiction.
    const xml = (await oneLine([{ percent: 10 }])).replace(
      '<ram:BasisAmount>100.00</ram:BasisAmount>',
      '<ram:BasisAmount>50.00</ram:BasisAmount>',
    );
    const read = readInvoiceXml(xml);
    expect(read.contradictions).toEqual(['discounts.0.percent']);
    expect(read.percentages).toEqual({});
    expect(read.invoice.discounts?.[0]).toMatchObject({ percent: 10, amount: 10 });
  });
});

describe('readInvoiceXml', () => {
  it('returns the profile', async () => {
    expect(readInvoiceXml(await xmlOf(sample())).profile).toBe('urn:cen.eu:en16931:2017');
  });

  it('keeps identifiers that look like numbers as strings and turns amounts into numbers', async () => {
    const { invoice } = readInvoiceXml(
      await xmlOf(
        sample((d) => {
          Object.assign(d, { number: '0042', buyerReference: '1e3' });
          d.seller.postalCode = '01067';
        }),
      ),
    );
    expect(invoice).toMatchObject({
      number: '0042',
      buyerReference: '1e3',
      seller: { postalCode: '01067' },
      buyer: { postalCode: '54321' },
    });
    expect(invoice.lines?.[1]).toMatchObject({ quantity: 2, unitPrice: 249.5, netAmount: 499, vatRate: 19 });
  });

  it('reads the country of delivery', async () => {
    const { xml } = await createEInvoice({ pdf: samplePdf(), invoice: sample((d) => (d.deliveryCountry = 'IT')) });
    expect(readInvoiceXml(xml).invoice.deliveryCountry).toBe('IT');
  });

  it('reads the purchase order number', async () => {
    const order =
      '<ram:BuyerOrderReferencedDocument><ram:IssuerAssignedID>PO-0007</ram:IssuerAssignedID></ram:BuyerOrderReferencedDocument>';
    const xml = (await xmlOf(sample())).replace('</ram:BuyerTradeParty>', `</ram:BuyerTradeParty>${order}`);
    expect(readInvoiceXml(xml).invoice.orderReference).toBe('PO-0007');
  });

  it('takes the exemption reason code where no reason is written out', async () => {
    const reverseCharge = sample((d) => {
      for (const line of d.lines) Object.assign(line, { vatCategory: 'AE', vatRate: 0 });
      d.buyer.vatId = 'ATU12345678';
      d.vatExemptionReason = 'Reverse charge';
    });
    const code = '<ram:ExemptionReasonCode>VATEX-EU-AE</ram:ExemptionReasonCode>';
    const xml = (await xmlOf(reverseCharge)).replace('<ram:ExemptionReason>Reverse charge</ram:ExemptionReason>', code);
    expect(readInvoiceXml(xml).invoice.vatExemptionReason).toBe('VATEX-EU-AE');
  });

  it('takes the VAT total in the invoice currency when a second one is given in the accounting currency', async () => {
    const xml = (await xmlOf(sample())).replace(
      '<ram:TaxTotalAmount ',
      '<ram:TaxTotalAmount currencyID="GBP">250.00</ram:TaxTotalAmount><ram:TaxTotalAmount ',
    );
    expect(readInvoiceXml(xml).invoice.totals?.vat).toBe(284.81);
  });

  it('reads character references', async () => {
    const xml = (await xmlOf(sample())).replace('Beispiel AG', 'B&#228;cker &amp; S&#xF6;hne');
    expect(readInvoiceXml(xml).invoice.buyer?.name).toBe('Bäcker & Söhne');
  });

  it('does not depend on the namespace prefixes', async () => {
    const xml = (await xmlOf(sample())).replaceAll('ram:', 'a:').replace('xmlns:ram=', 'xmlns:a=');
    expect(readInvoiceXml(xml).invoice).toMatchObject(sample());
  });

  it('reads no tax number from the identifier of a party, such as a customer number', async () => {
    const withIds = (xml: string) =>
      xml
        .replace('<ram:BuyerTradeParty>', '<ram:BuyerTradeParty><ram:ID>0042</ram:ID>')
        .replace(/(<ram:SellerTradeParty>\s*)<ram:ID>[^<]*<\/ram:ID>/, '$1<ram:ID>LIEF-0042</ram:ID>')
        .replace(/<ram:SpecifiedTaxRegistration>[\s\S]*?<\/ram:SpecifiedTaxRegistration>/g, '');
    const notSubjectToVat = sample((d) => {
      for (const line of d.lines) Object.assign(line, { vatCategory: 'O', vatRate: 0 });
      d.vatExemptionReason = 'Nicht steuerbar.';
      delete d.seller.vatId;
      delete d.buyer.vatId;
      d.seller.taxNumber = '12/345/67890';
    });
    const xml = withIds(await xmlOf(notSubjectToVat));
    expect(xml).toContain('<ram:ID>LIEF-0042</ram:ID>');
    const { invoice } = readInvoiceXml(xml);
    expect(invoice.buyer?.taxNumber).toBeUndefined();
    expect(invoice.seller?.taxNumber).toBeUndefined();
  });

  it.each([
    ['12/345/67890', '12/345/67890'],
    ['12 345 67890', '12 345 67890'],
    ['LIEF-0042', undefined],
    ['4711', undefined],
  ])('reads the identifier %s of a seller without a tax registration as the tax number %s', async (id, taxNumber) => {
    // The shape of a tax number is the one `check` and the comparison with the page know (domain/formats.ts).
    const notSubjectToVat = sample((d) => {
      for (const line of d.lines) Object.assign(line, { vatCategory: 'O', vatRate: 0 });
      d.vatExemptionReason = 'Nicht steuerbar.';
      delete d.seller.vatId;
      delete d.buyer.vatId;
      d.seller.taxNumber = '12/345/67890';
    });
    const xml = (await xmlOf(notSubjectToVat))
      .replace(/(<ram:SellerTradeParty>\s*)<ram:ID>[^<]*<\/ram:ID>/, `$1<ram:ID>${id}</ram:ID>`)
      .replace(/<ram:SpecifiedTaxRegistration>[\s\S]*?<\/ram:SpecifiedTaxRegistration>/g, '');
    expect(xml).toContain(`<ram:ID>${id}</ram:ID>`);
    expect(readInvoiceXml(xml).invoice.seller?.taxNumber).toBe(taxNumber);
  });

  it('takes the reason code of a line discount where no reason is written out', async () => {
    const { invoice } = readInvoiceXml(await xmlOf(sample((d) => (d.lines[0].discount = { percent: 10 }))));
    expect(invoice.lines?.[0]?.discount?.reason).toBe('95');
  });

  it('keeps a line with a charge among the adjusted lines', async () => {
    const xml = (await xmlOf(sample((d) => (d.lines[0].discount = { amount: 10 })))).replace(
      '<udt:Indicator>false</udt:Indicator>',
      '<udt:Indicator>true</udt:Indicator>',
    );
    const read = readInvoiceXml(xml);
    expect(read.adjustedLines).toEqual([0]);
    expect(read.invoice.lines?.[0]).not.toHaveProperty('discount');
  });

  it('refuses a UBL invoice', () => {
    const ubl = '<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"><ID>RE-1</ID></Invoice>';
    expect(() => readInvoiceXml(ubl)).toThrow(/CrossIndustryInvoice/);
  });

  it('refuses what is not well-formed XML', () => {
    expect(() => readInvoiceXml('<rsm:CrossIndustryInvoice><ram:ID>1</rsm:CrossIndustryInvoice>')).toThrow(
      /not well-formed/,
    );
  });
});
