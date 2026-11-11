import { describe, expect, it } from 'vitest';
import { guessFromText } from '../src/guess.js';

// Contact data and the buyer reference, which XRechnung asks for. Layouts met in real invoices, rebuilt with made-up data.

/** Every value behind its label, each party under its heading. */
const labelled = [
  'Rechnung Nr. 4711 vom 05.03.2024',
  'Leitweg-ID:   04011000-12345-34',
  'Verkäufer',
  'Name:   Lieferant GmbH',
  'Ansprechpartner:   Max Mustermann',
  'Anschrift:   Lieferantenstraße 20',
  'DE 80333 München',
  'Telefon:   +49 89 1234567',
  'E-Mail:   max@lieferant.example',
  'Käufer',
  'Name:   Stadt Musterstadt',
  'Ansprechpartner:   Erika Beispiel',
  'Anschrift:   Rathausplatz 1',
  'DE 12345 Musterstadt',
  'E-Mail:   rechnung@musterstadt.example',
  'Pos   Beschreibung   Betrag',
  '1   Beratung   100,00',
].join('\n');

/** A letterhead with the contact data of the issuer, no headings. */
const letterhead = (...contact: string[]) =>
  [
    'Muster Software GmbH',
    'Beispielweg 1',
    '12345 Musterstadt',
    ...contact,
    'Beispiel AG',
    'Hauptstraße 5',
    '54321 Beispielstadt',
    'Rechnung 2301   09.08.2024',
    'Endbetrag   119,00',
  ].join('\n');

/** The same letterhead, with an explicit seller heading. */
const sellerLetterhead = (...contact: string[]) => `Verkäufer:\n${letterhead(...contact)}`;

/** Two columns side by side, as extractLayout() returns them: the rows, and each column as a block. */
const columns = (left: string[], right: string[]) => ({
  text: Array.from({ length: Math.max(left.length, right.length) }, (_, i) => [left[i], right[i]].filter(Boolean).join('   ')).join('\n'),
  blocks: [left, right],
});

describe('guessFromText on contact data', () => {
  it('gives each party the values under its heading', () => {
    const guess = guessFromText(labelled);
    expect(guess.seller).toMatchObject({ contactName: 'Max Mustermann', phone: '+49 89 1234567', email: 'max@lieferant.example' });
    expect(guess.buyer?.email).toBe('rechnung@musterstadt.example');
  });

  it('reads the phone number and e-mail address under the seller heading', () => {
    const guess = guessFromText(sellerLetterhead('Tel.: 030 / 12 34 567', 'E-Mail: info@muster-software.example'));
    expect(guess.seller).toMatchObject({ phone: '030 / 12 34 567', email: 'info@muster-software.example' });
    expect(guess.buyer?.email).toBeUndefined();
  });

  it('reads a contact beside a recognised seller address even without a heading', () => {
    const text = [
      'Muster Software GmbH · Beispielweg 1 · 12345 Musterstadt',
      'Tel.: 030 / 12 34 567',
      'E-Mail: info@muster-software.example',
      '',
      'Beispiel AG',
      'Hauptstraße 5',
      '54321 Beispielstadt',
      'Rechnung 2301   09.08.2024',
    ].join('\n');
    expect(guessFromText(text).seller).toMatchObject({ phone: '030 / 12 34 567', email: 'info@muster-software.example' });
  });

  it('reads a value printed twice once', () => {
    expect(guessFromText(sellerLetterhead('Telefon: +49 711-50885524', 'Bei Rückfragen:', 'Telefon: +49 711-50885524')).seller?.phone).toBe('+49 711-50885524');
  });

  it('leaves two phone numbers that nothing tells apart unread', () => {
    expect(guessFromText(letterhead('Telefon: 030 111 222', 'Mobil: 0171 333 444')).seller?.phone).toBeUndefined();
  });

  it('leaves two e-mail addresses that nothing tells apart unread', () => {
    const guess = guessFromText(letterhead('info@muster-software.example', 'buchhaltung@beispiel.example'));
    expect(guess.seller?.email).toBeUndefined();
    expect(guess.buyer?.email).toBeUndefined();
  });

  it('prefers the value under the heading of the seller to another one elsewhere on the page', () => {
    const text = [
      'Verkäufer:',
      'Muster GmbH',
      'Beispielweg 1',
      'DE 12345 Musterstadt',
      'Telefon : +49 932 431 500',
      'Rechnung 2301   09.08.2024',
      'Telefon: +49 932 431 0',
    ].join('\n');
    expect(guessFromText(text).seller?.phone).toBe('+49 932 431 500');
  });

  it('does not take a fax number for a phone number', () => {
    expect(guessFromText(sellerLetterhead('Telefax: 030 999 888', 'Tel./Fax: 030 999 777', 'Telefon: 030 111 222')).seller?.phone).toBe('030 111 222');
  });

  it('ends a phone number where the next column starts', () => {
    expect(guessFromText(sellerLetterhead('Tel: 030 1234567   10115 Berlin')).seller?.phone).toBe('030 1234567');
  });

  it('gives an e-mail address under the heading of the buyer to the buyer, also beside the address of the seller', () => {
    const page = columns(
      ['Seller', 'Muster Inc.', '1 Example Road', 'Dover, DE 19901', 'support@muster.example'],
      ['Bill to', 'Beispiel GmbH', 'Hauptstraße 5', '54321 Beispielstadt', 'einkauf@beispiel.example'],
    );
    const guess = guessFromText(page.text, { blocks: page.blocks });
    expect(guess.seller?.email).toBe('support@muster.example');
    expect(guess.buyer?.email).toBe('einkauf@beispiel.example');
  });

  it('does not guess whose value it is where rows mix two columns and no blocks tell them apart', () => {
    const page = columns(
      ['Muster Inc.', '1 Example Road', 'Dover, DE 19901'],
      ['Bill to', 'Beispiel GmbH', 'Hauptstraße 5', '54321 Beispielstadt', 'einkauf@beispiel.example'],
    );
    const guess = guessFromText(page.text);
    expect(guess.seller?.email).toBeUndefined();
    expect(guess.buyer?.email).toBeUndefined();
  });

  it('gives what is labelled as the customer’s to the buyer', () => {
    const guess = guessFromText(letterhead('Kunden-E-Mail: einkauf@beispiel.example', 'Ihre Telefonnummer: 0171 333 444'));
    expect(guess.seller?.email).toBeUndefined();
    expect(guess.seller?.phone).toBeUndefined();
    expect(guess.buyer?.email).toBe('einkauf@beispiel.example');
  });

  it('recognises a customer named after the e-mail label', () => {
    const guess = guessFromText(letterhead('E-Mail des Kunden: einkauf@beispiel.example'));
    expect(guess.seller?.email).toBeUndefined();
    expect(guess.buyer?.email).toBe('einkauf@beispiel.example');
  });

  it('does not give a buyer or delivery contact to the seller across a blank line', () => {
    for (const heading of ['Käufer:', 'Lieferadresse:']) {
      const rows = [heading, 'Stadt Beispiel', 'Rathausplatz 2', '54321 Beispielstadt', '', 'E-Mail: einkauf@beispiel.example', 'Telefon: 030 555666'];
      for (const options of [{}, { blocks: [rows] }]) {
        const guess = guessFromText(rows.join('\n'), options);
        expect(guess.seller?.email).toBeUndefined();
        expect(guess.seller?.phone).toBeUndefined();
      }
    }
  });

  it('does not give an address belonging to an unheaded buyer to the seller', () => {
    const rows = [
      'Muster Software GmbH · Beispielweg 1 · 12345 Musterstadt',
      '',
      'Stadt Beispiel',
      'Rathausplatz 2',
      '54321 Beispielstadt',
      'E-Mail: einkauf@beispiel.example',
      '',
      'Rechnung 2301   09.08.2024',
    ];
    const guess = guessFromText(rows.join('\n'), { blocks: [rows] });
    expect(guess.seller?.email).toBeUndefined();
  });

  it('does not assume an otherwise unassigned single contact is the seller’s', () => {
    const text = ['Rechnung 2301   09.08.2024', 'Kontakt: fremd@beispiel.example', 'Telefon: 040 555666', 'Endbetrag 119,00'].join('\n');
    const guess = guessFromText(text);
    expect(guess.seller?.email).toBeUndefined();
    expect(guess.seller?.phone).toBeUndefined();
  });

  it('does not select a number merely near the seller when another number is also printed', () => {
    const text = [
      'Muster Software GmbH · Beispielweg 1 · 12345 Musterstadt',
      'Telefon: 030 111222',
      '',
      'Telefon: 040 555666',
      'Rechnung 2301   09.08.2024',
    ].join('\n');
    expect(guessFromText(text).seller?.phone).toBeUndefined();
  });

  it('gives nobody the contact data of a delivery address', () => {
    const text = letterhead('Lieferadresse:', 'Lager Nord', 'Hafenstraße 9', '20457 Hamburg', 'Tel.: 040 555 666', 'lager@beispiel.example');
    const guess = guessFromText(text);
    expect(guess.seller?.phone).toBeUndefined();
    expect(guess.seller?.email).toBeUndefined();
    expect(guess.buyer?.email).toBeUndefined();
  });

  it('reads the contact after its label, with a title, and from the line below', () => {
    expect(guessFromText(sellerLetterhead('Ihr Ansprechpartner: Max Mustermann')).seller?.contactName).toBe('Max Mustermann');
    expect(guessFromText(sellerLetterhead('Sachbearbeiterin: Frau Dr. Erika Muster, Tel. 030 111 222')).seller).toMatchObject({
      contactName: 'Frau Dr. Erika Muster',
      phone: '030 111 222',
    });
    expect(guessFromText(sellerLetterhead('Contact person', 'Jane Doe')).seller?.contactName).toBe('Jane Doe');
  });

  it('takes no single word and no label for the name of a contact', () => {
    expect(guessFromText(letterhead('Ansprechpartner: Buchhaltung')).seller?.contactName).toBeUndefined();
    expect(guessFromText(letterhead('Ansprechpartner:   Telefon:   E-Mail:')).seller?.contactName).toBeUndefined();
  });
});

describe('guessFromText on the buyer reference', () => {
  it('reads a Leitweg-ID after its label', () => {
    expect(guessFromText(labelled).buyerReference).toBe('04011000-12345-34');
    expect(guessFromText(letterhead('Leitwege-ID:   991-01234-44')).buyerReference).toBe('991-01234-44');
  });

  it('reads the reference of the buyer after its name in the standard, as it is printed', () => {
    expect(guessFromText(letterhead('Referenz des Käufers : 05 158 004 - 11023 - 45')).buyerReference).toBe('05 158 004 - 11023 - 45');
    expect(guessFromText(letterhead('Buyer reference: TEAM-7   Order: 4500012345')).buyerReference).toBe('TEAM-7');
  });

  it('takes nothing for a Leitweg-ID that does not have its shape', () => {
    expect(guessFromText(letterhead('Leitweg-ID: siehe Auftrag')).buyerReference).toBeUndefined();
    expect(guessFromText(letterhead('Leitweg-ID:', 'Zahlungsreferenz: 4711')).buyerReference).toBeUndefined();
  });

  it('leaves two different references unread', () => {
    expect(guessFromText(letterhead('Leitweg-ID: 04011000-12345-34', 'Referenz des Käufers: 991-01234-44')).buyerReference).toBeUndefined();
  });

  it('does not take another reference for it', () => {
    expect(guessFromText(letterhead('Ihr Zeichen: AB-12', 'Zahlungsreferenz: 4711', 'Your Reference   PO445')).buyerReference).toBeUndefined();
  });
});
