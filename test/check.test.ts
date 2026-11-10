import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { check } from '../src/check.js';
import type { InvoiceDraft } from '../src/model.js';

const sample = (): InvoiceDraft => JSON.parse(readFileSync(new URL('../examples/sample-invoice.json', import.meta.url), 'utf8'));

/** The sample with one change applied. */
const withChange = (change: (draft: any) => void): InvoiceDraft => {
  const draft = sample();
  change(draft);
  return draft;
};

const codesAt = (draft: InvoiceDraft, path: string, options?: { pdfText?: string }) =>
  check(draft, options)
    .findings.filter((f) => f.path === path)
    .map((f) => `${f.severity}:${f.code}`);

describe('check', () => {
  it('accepts a complete invoice and returns it with defaults and totals', () => {
    const result = check(sample());
    expect(result.findings).toEqual([]);
    expect(result.invoice).toMatchObject({ typeCode: '380', currency: 'EUR' });
    expect(result.totals).toMatchObject({ net: 1499, vat: 284.81, gross: 1783.81 });
  });

  it('returns no invoice while an error is open', () => {
    expect(check(withChange((d) => delete d.number)).invoice).toBeUndefined();
  });

  it('treats null and blank strings as missing', () => {
    expect(
      codesAt(
        withChange((d) => (d.number = '  ')),
        'number',
      ),
    ).toEqual(['error:required']);
    expect(
      codesAt(
        withChange((d) => (d.buyer.name = null)),
        'buyer.name',
      ),
    ).toEqual(['error:required']);
  });

  it.each(['number', 'issueDate', 'seller.name', 'seller.country', 'buyer.name', 'buyer.country'])('requires %s', (path) => {
    const draft = withChange((d) => {
      const keys = path.split('.');
      const last = keys.pop()!;
      delete keys.reduce((o, k) => o[k], d)[last];
    });
    expect(codesAt(draft, path)).toEqual(['error:required']);
  });

  it('requires at least one line', () => {
    expect(
      codesAt(
        withChange((d) => (d.lines = [])),
        'lines',
      ),
    ).toEqual(['error:required']);
  });

  it('requires name, quantity and unit price on every line', () => {
    const draft = withChange((d) => (d.lines[1] = { vatRate: 19 }));
    expect(codesAt(draft, 'lines.1.name')).toEqual(['error:required']);
    expect(codesAt(draft, 'lines.1.quantity')).toEqual(['error:required']);
    expect(codesAt(draft, 'lines.1.unitPrice')).toEqual(['error:required']);
  });

  it('rejects a date that does not exist', () => {
    expect(
      codesAt(
        withChange((d) => (d.issueDate = '2026-02-30')),
        'issueDate',
      ),
    ).toEqual(['error:format']);
    expect(
      codesAt(
        withChange((d) => (d.issueDate = '03.11.2026')),
        'issueDate',
      ),
    ).toEqual(['error:format']);
  });

  it('rejects a country that is not a two-letter code', () => {
    expect(
      codesAt(
        withChange((d) => (d.seller.country = 'Germany')),
        'seller.country',
      ),
    ).toEqual(['error:format']);
  });

  it('rejects an IBAN with a wrong check digit', () => {
    expect(
      codesAt(
        withChange((d) => (d.iban = 'DE03120300000000202051')),
        'iban',
      ),
    ).toEqual(['error:format']);
  });

  it('accepts an IBAN written with spaces', () => {
    expect(
      codesAt(
        withChange((d) => (d.iban = 'DE02 1203 0000 0000 2020 51')),
        'iban',
      ),
    ).toEqual([]);
  });

  it('rejects a negative unit price', () => {
    expect(
      codesAt(
        withChange((d) => (d.lines[0].unitPrice = -5)),
        'lines.0.unitPrice',
      ),
    ).toEqual(['error:format']);
  });

  it('requires a tax identifier of the seller', () => {
    expect(
      codesAt(
        withChange((d) => delete d.seller.vatId),
        'seller.vatId',
      ),
    ).toEqual(['error:seller-tax-id']);
  });

  it('accepts a tax number in place of the VAT ID', () => {
    const draft = withChange((d) => {
      delete d.seller.vatId;
      d.seller.taxNumber = '123/456/78901';
    });
    expect(codesAt(draft, 'seller.vatId')).toEqual([]);
  });

  it('requires a due date or payment terms when money is owed', () => {
    const draft = withChange((d) => {
      delete d.dueDate;
      delete d.paymentTerms;
    });
    expect(codesAt(draft, 'dueDate')).toEqual(['error:payment-terms']);
  });

  it('requires a VAT rate above zero for the standard category', () => {
    expect(
      codesAt(
        withChange((d) => (d.lines[0].vatRate = 0)),
        'lines.0.vatRate',
      ),
    ).toEqual(['error:vat-rate']);
  });

  it('requires a zero rate, a reason and the buyer VAT ID for reverse charge', () => {
    const draft = withChange((d) => {
      for (const line of d.lines) Object.assign(line, { vatCategory: 'AE', vatRate: 19 });
      delete d.totals;
    });
    expect(codesAt(draft, 'lines.0.vatRate')).toEqual(['error:vat-rate']);
    expect(codesAt(draft, 'vatExemptionReason')).toEqual(['error:exemption-reason']);
    expect(codesAt(draft, 'buyer.vatId')).toEqual(['error:buyer-vat-id']);
  });

  it('reports printed totals that contradict the calculation', () => {
    const draft = withChange((d) => (d.totals.gross = 1783.8));
    expect(codesAt(draft, 'totals.gross')).toEqual(['error:totals-mismatch']);
  });

  it('warns when an address is incomplete', () => {
    expect(
      codesAt(
        withChange((d) => delete d.buyer.street),
        'buyer.street',
      ),
    ).toEqual(['warning:address']);
  });

  it('warns when the date of supply is missing', () => {
    expect(
      codesAt(
        withChange((d) => delete d.deliveryDate),
        'deliveryDate',
      ),
    ).toEqual(['warning:delivery-date']);
  });

  it('accepts a service period as the date of supply', () => {
    const draft = withChange((d) => {
      delete d.deliveryDate;
      Object.assign(d, { periodStart: '2026-10-01', periodEnd: '2026-10-31' });
    });
    expect(codesAt(draft, 'deliveryDate')).toEqual([]);
  });

  it('rejects a service period that ends before it starts', () => {
    const draft = withChange((d) => Object.assign(d, { periodStart: '2026-10-31', periodEnd: '2026-10-01' }));
    expect(codesAt(draft, 'periodEnd')).toEqual(['error:format']);
  });

  it('warns when a corrected invoice does not name the invoice it corrects', () => {
    expect(
      codesAt(
        withChange((d) => (d.typeCode = '384')),
        'precedingInvoiceNumber',
      ),
    ).toEqual(['warning:preceding-invoice']);
  });

  it('still returns the invoice when only warnings are open', () => {
    expect(check(withChange((d) => delete d.buyer.street)).invoice).toBeDefined();
  });
});

describe('check against the PDF text', () => {
  const pdfText = [
    'Muster Software GmbH · Beispielweg 1 · 12345 Musterstadt',
    'Beispiel AG, Hauptstraße 5, 54321 Beispielstadt',
    'Rechnung Nr. RE-2026-0042   Rechnungsdatum 03.11.2026   Leistungsdatum 31.10.2026',
    '1  Beratung E-Rechnung   10 Std.   100,00 €   1.000,00 €',
    '2  Softwarelizenz (Jahr)   2 Stk.   249,50 €   499,00 €',
    'Netto 1.499,00 €   USt 19 % 284,81 €   Gesamtbetrag 1.783,81 €',
    'Zahlbar bis 17. November 2026. IBAN DE02 1203 0000 0000 2020 51  USt-IdNr. DE123456789',
  ].join('\n');

  it('finds every value of the sample in its own text', () => {
    expect(check(sample(), { pdfText }).findings).toEqual([]);
  });

  it('warns about an invoice number the PDF does not show', () => {
    expect(
      codesAt(
        withChange((d) => (d.number = 'RE-2026-0043')),
        'number',
        { pdfText },
      ),
    ).toEqual(['warning:not-in-pdf']);
  });

  it('warns about a date the PDF does not show', () => {
    expect(
      codesAt(
        withChange((d) => (d.dueDate = '2026-11-18')),
        'dueDate',
        { pdfText },
      ),
    ).toEqual(['warning:not-in-pdf']);
  });

  it('warns about a unit price the PDF does not show', () => {
    const draft = withChange((d) => {
      d.lines[1].unitPrice = 249.4;
      delete d.totals;
    });
    expect(codesAt(draft, 'lines.1.unitPrice', { pdfText })).toEqual(['warning:not-in-pdf']);
  });

  it('warns when the calculated total is not on the PDF', () => {
    const draft = withChange((d) => {
      d.lines[0].quantity = 11;
      delete d.totals;
    });
    expect(codesAt(draft, 'totals.gross', { pdfText })).toEqual(['warning:not-in-pdf']);
  });

  it('finds a line name whose words are spread over several table rows', () => {
    const wrapped = pdfText.replace('1  Beratung E-Rechnung   10 Std.   100,00 €   1.000,00 €', '1  Beratung   10 Std.   100,00 €   1.000,00 €\n   E-Rechnung');
    expect(check(sample(), { pdfText: wrapped }).findings).toEqual([]);
  });

  it('still warns about a line name of which a word is missing from the PDF', () => {
    expect(
      codesAt(
        withChange((d) => (d.lines[0].name = 'Beratung XRechnung')),
        'lines.0.name',
        { pdfText },
      ),
    ).toEqual(['warning:not-in-pdf']);
  });

  it('says so once when the PDF has no text to compare with', () => {
    expect(check(sample(), { pdfText: '  ' }).findings.map((f) => f.code)).toEqual(['no-pdf-text']);
  });
});
