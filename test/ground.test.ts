import { describe, expect, it } from 'vitest';
import { keepWhatThePdfShows } from '../src/ground.js';

const pdfText = [
  'Muster Software GmbH · Beispielweg 1 · 12345 Musterstadt · Deutschland',
  'Beispiel AG, Hauptstraße 5, 54321 Beispielstadt',
  'Rechnung Nr. RE-2026-0042   Rechnungsdatum 03.11.2026',
  '1  Beratung E-Rechnung   10 Std.   100,00 €   1.000,00 €',
  'Netto 1.000,00 €   USt 19 % 190,00 €   Gesamtbetrag 1.190,00 €',
  'IBAN DE02 1203 0000 0000 2020 51  USt-IdNr. DE123456789  rechnung@muster-software.example',
].join('\n');

describe('keepWhatThePdfShows', () => {
  it('keeps values that are printed on the PDF', () => {
    const draft = {
      number: 'RE-2026-0042',
      issueDate: '2026-11-03',
      iban: 'DE02120300000000202051',
      seller: { name: 'Muster Software GmbH', postalCode: '12345', country: 'DE', vatId: 'DE123456789', email: 'rechnung@muster-software.example' },
      lines: [{ name: 'Beratung E-Rechnung', quantity: 10, unit: 'HUR', unitPrice: 100, vatCategory: 'S', vatRate: 19 }],
      totals: { net: 1000, gross: 1190 },
    };
    expect(keepWhatThePdfShows(draft, pdfText)).toEqual(draft);
  });

  it('drops a name the PDF does not show, such as a translated one', () => {
    expect(keepWhatThePdfShows({ buyer: { name: 'Example AG', street: 'Hauptstraße 5' } }, pdfText)).toEqual({ buyer: { street: 'Hauptstraße 5' } });
  });

  it('drops invented identifiers, dates and amounts', () => {
    const invented = {
      dueDate: '2026-11-17',
      buyer: { vatId: 'ATU12345678' },
      totals: { vat: 284.81 },
      lines: [{ name: 'Beratung E-Rechnung', unitPrice: 99 }],
    };
    expect(keepWhatThePdfShows(invented, pdfText)).toEqual({ lines: [{ name: 'Beratung E-Rechnung' }] });
  });

  it('drops a date that does not exist instead of failing on it', () => {
    // A small model writes such dates. "13/01/2026" is the 13th of January, not the first day of a 13th month.
    const text = `${pdfText}\nDatum 13/01/2026   Fällig 31.02.2026`;
    expect(keepWhatThePdfShows({ number: 'RE-2026-0042', issueDate: '2026-13-01', dueDate: '2026-02-31', deliveryDate: '2026-00-10' }, text)).toEqual({
      number: 'RE-2026-0042',
    });
  });

  it('drops a value that sits in the wrong kind of field', () => {
    const draft = { seller: { taxNumber: 'rechnung@muster-software.example', email: 'Beispielweg 1', vatId: 'Musterstadt' } };
    expect(keepWhatThePdfShows(draft, pdfText)).toEqual({});
  });

  it('keeps a country only when the PDF names it', () => {
    expect(keepWhatThePdfShows({ seller: { country: 'DE' }, buyer: { country: 'AT' } }, pdfText)).toEqual({ seller: { country: 'DE' } });
  });

  it('drops a VAT treatment whose rate is not printed', () => {
    const draft = { lines: [{ name: 'Beratung E-Rechnung', vatCategory: 'K', vatRate: 0 }] };
    expect(keepWhatThePdfShows(draft, pdfText)).toEqual({ lines: [{ name: 'Beratung E-Rechnung' }] });
  });

  it('drops a quantity that is not printed', () => {
    expect(keepWhatThePdfShows({ lines: [{ quantity: 7 }, { quantity: 10 }] }, pdfText)).toEqual({ lines: [{}, { quantity: 10 }] });
  });

  it('keeps a quantity printed with a thousands separator', () => {
    const text = `${pdfText}\n2  Schrauben   24.000 Stk.   0,01 €   240,00 €`;
    expect(keepWhatThePdfShows({ lines: [{ quantity: 24000 }, { quantity: 2400 }] }, text)).toEqual({ lines: [{ quantity: 24000 }, {}] });
  });

  it('keeps a service period printed as its months, from the first day of the one to the last day of the other', () => {
    const text = `${pdfText}\nLeistungszeitraum: September 2026 bis Januar 2027`;
    const period = { periodStart: '2026-09-01', periodEnd: '2027-01-31' };
    expect(keepWhatThePdfShows(period, text)).toEqual(period);
    expect(keepWhatThePdfShows({ periodStart: '2026-09-02', periodEnd: '2027-01-30' }, text)).toEqual({});
  });

  it('does not take a single day of a month for a period', () => {
    for (const day of ['15. September 2026', '15.09.2026', '2026-09-15']) {
      expect(keepWhatThePdfShows({ periodStart: '2026-09-01' }, `${pdfText}\nLieferdatum ${day}`), day).toEqual({});
    }
  });

  it('does not take part of a date for an amount', () => {
    expect(keepWhatThePdfShows({ totals: { due: 3.11, gross: 1190 } }, pdfText)).toEqual({ totals: { gross: 1190 } });
  });

  it('drops a postal code that drags the city along', () => {
    expect(keepWhatThePdfShows({ seller: { postalCode: '12345 Musterstadt' } }, pdfText)).toEqual({});
  });

  it('drops a buyer that carries the name of the seller', () => {
    const draft = { seller: { name: 'Muster Software GmbH' }, buyer: { name: 'Muster Software GmbH', city: 'Beispielstadt' } };
    expect(keepWhatThePdfShows(draft, pdfText)).toEqual({ seller: { name: 'Muster Software GmbH' }, buyer: { city: 'Beispielstadt' } });
  });

  it('drops a reason for charging no VAT when every line charges VAT', () => {
    const draft = { vatExemptionReason: 'Beratung E-Rechnung', lines: [{ vatCategory: 'S', vatRate: 19 }] };
    expect(keepWhatThePdfShows(draft, pdfText)).toEqual({ lines: [{ vatCategory: 'S', vatRate: 19 }] });
  });

  it('drops fields a reader cannot verify against the page', () => {
    expect(keepWhatThePdfShows({ typeCode: '389', buyerReference: 'Rechnung Nr. RE-2026-0042', note: 'Beispiel' }, pdfText)).toEqual({});
  });
});
