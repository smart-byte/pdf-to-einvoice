import { describe, expect, it } from 'vitest';
import { guessFromText } from '../src/guess.js';

// Three more layouts met in real invoices, rebuilt with made-up data.

/** A letterhead block on top, a sender line with dashes, labels above their values, a two-digit year. */
const letterhead = [
  'Muster Software GmbH',
  'Beispielweg 1',
  '12345 Musterstadt',
  'Tel.: 030 / 12 34 567',
  'Muster Software GmbH – Beispielweg 1 – 12345 Musterstadt – Germany   Geschäftszeiten',
  'Mo-Fr 9:00 - 18:00',
  'Beispiel AG',
  'Erika Muster   Geschäftsführer',
  'Hauptstraße 5   Max Mustermann',
  'D-54321 Beispielstadt',
  'Leistungszeitraum',
  '01.01.2023 bis 15.06.2023',
  'Rechnung 2301   09.08.23',
  'Beschreibungen   Betrag',
  '1.   Erläuterungen zum Markt für Apps   6.000,00',
  '(iOS, Android) inkl. Rechte',
  '2.   Besprechungen der Feststellungen   5.000,00',
  'Nettosumme   11.000,00',
  '19% MwSt.   2.090,00',
  'Endbetrag   13.090,00',
  'Bankverbindung:',
  'BIC-/Swift-Code: BYLADEM1001',
  'IBAN Nr.: DE02 1203 0000 0000 2020 51',
  'Bank Addresse:   Kontoinhaber:',
  'Musterbank – Nord   Muster Software GmbH',
  'Bankweg 13   Beispielweg 1',
  '12345 Musterstadt   12345 Musterstadt',
  'Muster Software GmbH - Beispielweg 1 - 12345 Musterstadt - Registergericht: Musterstadt - HRB: 12345 - USt-IdNr.: DE 123 456 789',
].join('\n');

/** The same letterhead in English, for a customer in the USA: no position numbers, no VAT. */
const abroad = [
  'Muster Software GmbH',
  'Beispielweg 1',
  '12345 Musterstadt',
  'Muster Software GmbH – Beispielweg 1 – 12345 Musterstadt – Germany   Business Hours',
  'Example Inc.',
  'Jane Doe   Managing Director',
  '8 Sample Road',
  'USA – Dover, DE 19901',
  'December 2024',
  'Invoice 2410   Dec 19, 2024',
  'Description   Amount',
  'Based on the project planning, the design   $12,000.00',
  'and component implementations will proceed.',
  'Total Amount   $12,000.00',
  'Note: exempt from VAT because the recipient of the developed',
  'software is based in the USA',
  'Should you have any questions regarding this invoice, please contact me.',
  'Muster Software GmbH - Beispielweg 1 - DE-12345 Musterstadt - registered at Musterstadt HRB 12345 - VAT: DE 123 456 789',
  'Musterbank - BIC: BYLADEM1001 - IBAN: DE02 1203 0000 0000 2020 51',
].join('\n');

/** Labels beside the address, and a description that wraps around the row with number and amount. */
const wrapped = [
  'INVOICE',
  'Muster Software GmbH · Beispielweg 1, DE-12345 Musterstadt · +49 30 1234567 · rechnung@muster-software.example',
  'BILL TO   DETAILS',
  'Example Inc.   No.:   2616',
  'Jane Doe   Date:   25/09/2026',
  '8 Sample Road   Period: August 2026',
  'Dover, DE 19901, USA',
  'Project:   Example App   P.O.:',
  'No.   Description   Amount',
  'Based on the project planning and designs, the',
  '1   12.000,00 US$',
  'design and component implementations will proceed.',
  'Subtotal   12.000,00 US$',
  'Total   12.000,00 US$',
  'Note: exempt from VAT because',
  'the recipient and owner of the',
  'developed software is based in',
  'the USA.',
  'PAYMENT',
  'Account Holder   Muster Software GmbH',
  'Routing Number   084009519',
  'SWIFT/BIC   BYLADEM1001',
  'Muster Software GmbH · Beispielweg 1 · DE-12345 Musterstadt · USt-IdNr. DE123456789 · muster-software.example',
].join('\n');

const SELLER = { name: 'Muster Software GmbH', street: 'Beispielweg 1', postalCode: '12345', city: 'Musterstadt', country: 'DE', vatId: 'DE123456789' };
const US_BUYER = { name: 'Example Inc.', contactName: 'Jane Doe', street: '8 Sample Road', postalCode: '19901', city: 'Dover', country: 'US' };

describe('guessFromText on a letterhead layout', () => {
  const guess = guessFromText(letterhead);

  it('reads the seller from a sender line written with dashes, and a VAT ID written with spaces', () => {
    expect(guess.seller).toEqual({ ...SELLER, phone: '030 / 12 34 567' });
  });

  it('takes the address block that is not the seller’s own for the buyer', () => {
    expect(guess.buyer).toEqual({
      name: 'Beispiel AG',
      contactName: 'Erika Muster',
      street: 'Hauptstraße 5',
      postalCode: '54321',
      city: 'Beispielstadt',
      country: 'DE',
    });
  });

  it('reads the number that follows the word Rechnung, and the date beside it', () => {
    expect(guess).toMatchObject({ number: '2301', issueDate: '2023-08-09' });
  });

  it('reads a value on the line below its label', () => {
    expect(guess).toMatchObject({ periodStart: '2023-01-01', periodEnd: '2023-06-15' });
  });

  it('reads the VAT rate from a totals row that starts with it', () => {
    expect(guess.lines).toEqual([
      { name: 'Erläuterungen zum Markt für Apps (iOS, Android) inkl. Rechte', quantity: 1, unit: 'C62', unitPrice: 6000, vatCategory: 'S', vatRate: 19 },
      { name: 'Besprechungen der Feststellungen', quantity: 1, unit: 'C62', unitPrice: 5000, vatCategory: 'S', vatRate: 19 },
    ]);
  });

  it('does not take the word before an IBAN for an invoice number', () => {
    expect(guessFromText('IBAN Nr.: DE02 1203 0000 0000 2020 51').number).toBeUndefined();
  });

  it('leaves a slashed date without a label unread, even beside a German word', () => {
    expect(guessFromText('Rechnung 2302   10/05/23')).toEqual({ number: '2302' });
  });
});

describe('guessFromText on invoices to a customer abroad', () => {
  it('reads an address in the American form, with the country in front or behind', () => {
    expect(guessFromText(abroad).buyer).toEqual(US_BUYER);
    expect(guessFromText(wrapped).buyer).toEqual(US_BUYER);
  });

  it('reads table rows without position numbers', () => {
    expect(guessFromText(abroad)).toMatchObject({
      number: '2410',
      issueDate: '2024-12-19',
      periodStart: '2024-12-01',
      periodEnd: '2024-12-31',
      currency: 'USD',
      totals: { gross: 12000 },
      lines: [{ name: 'Based on the project planning, the design and component implementations will proceed.', quantity: 1, unitPrice: 12000 }],
    });
  });

  it('reads a description that wraps around the row with number and amount', () => {
    expect(guessFromText(wrapped)).toMatchObject({
      number: '2616',
      issueDate: '2026-09-25',
      lines: [{ name: 'Based on the project planning and designs, the design and component implementations will proceed.', quantity: 1, unitPrice: 12000 }],
    });
  });

  it('takes an invoice without VAT to a customer outside the EU as not subject to VAT, with the printed reason', () => {
    for (const text of [abroad, wrapped]) {
      const guess = guessFromText(text);
      expect(guess.lines).toMatchObject([{ vatCategory: 'O', vatRate: 0 }]);
      expect(guess.vatExemptionReason).toMatch(/^exempt from VAT because the recipient .* is based in the USA\.?$/);
    }
  });

  it('keeps a BIC only together with an IBAN', () => {
    expect(guessFromText(wrapped).bic).toBeUndefined();
    expect(guessFromText(abroad)).toMatchObject({ bic: 'BYLADEM1001', iban: 'DE02120300000000202051' });
  });
});
