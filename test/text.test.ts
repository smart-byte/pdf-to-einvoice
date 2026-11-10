import { readFileSync } from 'node:fs';
import { PDFDocument } from '@cantoo/pdf-lib';
import { describe, expect, it } from 'vitest';
import { check } from '../src/check.js';
import { guessFromText } from '../src/guess.js';
import { extractText } from '../src/text.js';

const file = (name: string) => readFileSync(new URL(`../examples/${name}`, import.meta.url));
const samplePdf = () => new Uint8Array(file('sample-invoice.pdf'));

describe('extractText', () => {
  it('reads the PDF row by row, left to right', async () => {
    const lines = (await extractText(samplePdf())).split('\n');
    // The address and the invoice number share a row; a wide gap keeps the columns apart.
    expect(lines).toContain('Beispiel AG   Rechnungsnummer   RE-2026-0042');
    expect(lines).toContain('1   Beratung E-Rechnung   10 Std.   100,00 €   1.000,00 €');
  });

  it('leaves the bytes it was given usable', async () => {
    const pdf = samplePdf();
    await extractText(pdf);
    expect(pdf.byteLength).toBeGreaterThan(0);
  });

  it('returns an empty string for a PDF without text', async () => {
    const doc = await PDFDocument.create();
    doc.addPage();
    expect(await extractText(await doc.save())).toBe('');
  });

  it('yields text in which every value of the sample invoice is found', async () => {
    const invoice = JSON.parse(file('sample-invoice.json').toString());
    expect(check(invoice, { pdfText: await extractText(samplePdf()) }).findings).toEqual([]);
  });
});

describe('guessFromText', () => {
  const german = [
    'Muster Software GmbH · Beispielweg 1 · 12345 Musterstadt',
    'Rechnungsnummer RE-2026-0042',
    'Rechnungsdatum 03.11.2026',
    'Leistungsdatum 31.10.2026',
    'Nettobetrag 1.499,00 €',
    'Umsatzsteuer 19 % 284,81 €',
    'Gesamtbetrag 1.783,81 €',
    'Zahlbar innerhalb von 14 Tagen ohne Abzug. Fällig am 17.11.2026.',
    'IBAN DE02 1203 0000 0000 2020 51 · BIC BYLADEM1001 · USt-IdNr. DE123456789',
  ].join('\n');

  it('finds the labelled values of a German invoice', () => {
    expect(guessFromText(german)).toEqual({
      number: 'RE-2026-0042',
      issueDate: '2026-11-03',
      deliveryDate: '2026-10-31',
      dueDate: '2026-11-17',
      currency: 'EUR',
      iban: 'DE02120300000000202051',
      bic: 'BYLADEM1001',
      seller: { name: 'Muster Software GmbH', street: 'Beispielweg 1', postalCode: '12345', city: 'Musterstadt', country: 'DE', vatId: 'DE123456789' },
      totals: { net: 1499, vat: 284.81, gross: 1783.81 },
    });
  });

  it('finds the labelled values of an English invoice', () => {
    const text = [
      'Invoice No: INV-7',
      'Invoice date: November 3, 2026',
      'Due date: 17 November 2026',
      'Subtotal $1,499.00',
      'Total $1,499.00',
      'Tax number 123/456/78901',
    ].join('\n');
    expect(guessFromText(text)).toEqual({
      number: 'INV-7',
      issueDate: '2026-11-03',
      dueDate: '2026-11-17',
      currency: 'USD',
      seller: { taxNumber: '123/456/78901' },
      totals: { net: 1499, gross: 1499 },
    });
  });

  it('takes a second VAT ID to be the buyer’s, and the countries from the prefixes', () => {
    const guess = guessFromText('USt-IdNr. DE123456789\nIhre USt-IdNr.: ATU12345678');
    expect(guess).toEqual({ seller: { vatId: 'DE123456789', country: 'DE' }, buyer: { vatId: 'ATU12345678', country: 'AT' } });
  });

  it('reads a bare "Nr." as the invoice number and "Gesamt" as the total', () => {
    expect(guessFromText('Beispiel AG   Nr.: 2617\nKunden-Nr.: 77\nGesamt 376,01 €')).toEqual({ number: '2617', currency: 'EUR', totals: { gross: 376.01 } });
  });

  it('reads a date with slashes when only one reading is possible', () => {
    expect(guessFromText('Datum: 25/10/2026')).toEqual({ issueDate: '2026-10-25' });
    expect(guessFromText('Date: 10/25/2026')).toEqual({ issueDate: '2026-10-25' });
  });

  it('does not guess a date written with slashes, which could be read two ways', () => {
    expect(guessFromText('Invoice date: 03/11/2026')).toEqual({});
  });

  it('ignores an IBAN whose check digits are wrong', () => {
    expect(guessFromText('IBAN DE03 1203 0000 0000 2020 51')).toEqual({});
  });

  it('returns an empty object when it recognises nothing', () => {
    expect(guessFromText('Hello world')).toEqual({});
  });
});
