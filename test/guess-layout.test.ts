import { describe, expect, it } from 'vitest';
import { guessFromText, languageOf } from '../src/guess.js';

// The shape of a real invoice, with made-up data: sender line, address block next to a block of labels,
// a table without quantity and unit price, a row that wraps, a date written with slashes.
const royalties = [
  'RECHNUNG',
  'Muster Software GmbH · Beispielweg 1, DE-12345 Musterstadt · +49 30 1234567 · rechnung@muster-software.example',
  'BILL TO DETAILS',
  'Beispiel AG   Nr.: 2617',
  'Erika Muster   Datum: 08/10/2026',
  'Hauptstraße 5   Zeitraum: Q2 2026',
  'D-54321 Beispielstadt',
  'Projekt: Portal   P.O.:',
  'Pos.   Beschreibung   Menge   Satz   MwSt.   Betrag',
  '1   Lizenzgebühren gemäß Report für das   7 %   351,41 €',
  '2. Quartal 2026 Beispielspiel',
  'Netto   351,41 €',
  'MwSt. 7%   24,60 €',
  'Gesamt   376,01 €',
  'IBAN DE02 1203 0000 0000 2020 51',
  'Muster Software GmbH · Beispielweg 1 · DE-12345 Musterstadt · USt-IdNr. DE123456789 · muster-software.example',
].join('\n');

const hours = [
  'Muster Software GmbH · Beispielweg 1 · 12345 Musterstadt',
  'Beispiel AG   Rechnungsnummer   RE-2026-0042',
  'Hauptstraße 5   Rechnungsdatum   03.11.2026',
  '54321 Beispielstadt   Leistungsdatum   31.10.2026',
  'Pos.   Bezeichnung   Menge   Einzelpreis   Gesamt',
  '1   Beratung E-Rechnung   10 Std.   100,00 €   1.000,00 €',
  '2   Softwarelizenz (Jahr)   2 Stk.   249,50 €   499,00 €',
  'Nettobetrag   1.499,00 €',
  'Umsatzsteuer 19 %   284,81 €',
  'Gesamtbetrag   1.783,81 €',
  'USt-IdNr. DE123456789',
].join('\n');

describe('guessFromText on the layout of a German invoice', () => {
  it('reads the seller from the sender line', () => {
    expect(guessFromText(royalties).seller).toEqual({
      name: 'Muster Software GmbH',
      street: 'Beispielweg 1',
      postalCode: '12345',
      city: 'Musterstadt',
      country: 'DE',
      vatId: 'DE123456789',
      // The phone number in the sender line has no label: digits alone may be anything.
      email: 'rechnung@muster-software.example',
    });
  });

  it('reads the buyer from the address block, with the contact person', () => {
    expect(guessFromText(royalties).buyer).toEqual({
      name: 'Beispiel AG',
      contactName: 'Erika Muster',
      street: 'Hauptstraße 5',
      postalCode: '54321',
      city: 'Beispielstadt',
      country: 'DE',
    });
  });

  it('takes the country of the buyer from the seller when VAT is charged and the address names none', () => {
    expect(guessFromText(hours).buyer).toEqual({ name: 'Beispiel AG', street: 'Hauptstraße 5', postalCode: '54321', city: 'Beispielstadt', country: 'DE' });
  });

  it('reads a slashed date after a German label as day first', () => {
    expect(guessFromText(royalties).issueDate).toBe('2026-10-08');
  });

  it('reads a quarter as the service period', () => {
    expect(guessFromText(royalties)).toMatchObject({ periodStart: '2026-04-01', periodEnd: '2026-06-30' });
  });

  it('reads a table row without quantity and price as one unit at the row total, joined with the row it wraps into', () => {
    expect(guessFromText(royalties).lines).toEqual([
      { name: 'Lizenzgebühren gemäß Report für das 2. Quartal 2026 Beispielspiel', quantity: 1, unit: 'C62', unitPrice: 351.41, vatCategory: 'S', vatRate: 7 },
    ]);
  });

  it('reads quantity, unit and unit price from table rows, and the VAT rate from the totals', () => {
    expect(guessFromText(hours).lines).toEqual([
      { name: 'Beratung E-Rechnung', quantity: 10, unit: 'HUR', unitPrice: 100, vatCategory: 'S', vatRate: 19 },
      { name: 'Softwarelizenz (Jahr)', quantity: 2, unit: 'C62', unitPrice: 249.5, vatCategory: 'S', vatRate: 19 },
    ]);
  });

  it('reads no lines when the rows do not add up to the printed net total', () => {
    expect(guessFromText(hours.replace('499,00 €', '500,00 €')).lines).toBeUndefined();
  });

  it.each([
    ['Zeitraum: Oktober 2026', '2026-10-01', '2026-10-31'],
    ['Leistungszeitraum 10/2026', '2026-10-01', '2026-10-31'],
    ['Leistungsmonat: 02.2028', '2028-02-01', '2028-02-29'],
    ['Leistungsdatum: Okt. 2026', '2026-10-01', '2026-10-31'],
    ['Service period: March 2026', '2026-03-01', '2026-03-31'],
    ['Leistungszeitraum: 01.10.2026 - 15.10.2026', '2026-10-01', '2026-10-15'],
    ['Zeitraum: 01.10.2026 bis 31.12.2026', '2026-10-01', '2026-12-31'],
  ])('reads "%s" as the service period', (text, periodStart, periodEnd) => {
    expect(guessFromText(text)).toMatchObject({ periodStart, periodEnd });
  });

  it('keeps a full date after the label a date of supply', () => {
    expect(guessFromText('Leistungsdatum 31.10.2026')).toEqual({ deliveryDate: '2026-10-31' });
  });

  it('reads a row that holds nothing but a month as the service period', () => {
    expect(guessFromText('Beispiel AG\nDecember 2024\nInvoice 2410')).toMatchObject({ periodStart: '2024-12-01', periodEnd: '2024-12-31' });
  });

  it('does not take a month inside a sentence, or one that does not exist, for a service period', () => {
    expect(guessFromText('Unser Angebot vom Oktober 2026 liegt bei\nMonat 13/2026')).toEqual({});
  });
});

describe('languageOf', () => {
  it('recognises a German invoice, even with English headings in it', () => {
    expect(languageOf(royalties)).toBe('de');
  });

  it('recognises an English invoice', () => {
    expect(languageOf('Invoice No: INV-7\nInvoice date: November 3, 2026\nSubtotal $1,499.00\nTotal amount due $1,499.00')).toBe('en');
  });

  it('falls back to English when the text gives no clue', () => {
    expect(languageOf('2617 351,41')).toBe('en');
  });
});
