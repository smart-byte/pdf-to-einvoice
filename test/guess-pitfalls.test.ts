import { describe, expect, it } from 'vitest';
import { guessFromText } from '../src/guess.js';

// Invented invoices in two layouts that once misled the reader: a letterhead with the address of a customer abroad,
// and two address columns with the seller on the right. A wrong value is worse than a missing one.

/** The page as extractLayout() returns it: its rows, and the blocks where they differ from the rows. */
const page = (rows: string[], blocks: string[][]) => [rows.join('\n'), { blocks }] as const;

const FOOTER_ROWS = [
  'Beispiel Studio GmbH · Musterweg 3, 80331 München · Registergericht München, HRB 99999',
  'USt-IdNr. DE 123 456 789 · Beispielbank · BIC BYLADEM1001 · IBAN DE02 1203 0000 0000 2020 51',
];
const LETTERHEAD = ['Beispiel Studio GmbH', 'Musterweg 3 · 80331 München', 'Tel. +49 89 1234567'];

/** A letterhead, the customer's address on the left with its country and VAT ID below it. */
function letterhead(address: string[], country: string, vatId?: string) {
  const rows = [
    ...LETTERHEAD,
    `${address[0]}`,
    'Geschäftsführung',
    ...address.slice(1),
    'Anna Beispiel',
    `${country}   Leistungszeitraum: September 2026`,
    'Zahlbar ohne Abzug bis 20. Oktober 2026',
    ...(vatId ? [`USt-IdNr. ${vatId}`] : []),
    'Rechnung 2026-17   6. Oktober 2026',
    'Gestaltung   10 Std.   80,00 € 800,00 €',
    'Nettobetrag   800,00 €',
    'Gesamtbetrag   800,00 €',
    ...FOOTER_ROWS,
  ];
  const blocks = [
    ...LETTERHEAD.map((row) => [row]),
    [...address, country, ...(vatId ? [`USt-IdNr. ${vatId}`] : [])],
    ['Geschäftsführung'],
    ['Anna Beispiel'],
    ['Rechnung 2026-17'],
    FOOTER_ROWS,
  ];
  return page(rows, blocks);
}

/** Two columns: the customer on the left, the seller on the right, and the seller once more in the footer. */
function twoColumns(address: string[]) {
  const seller = ['Erika Beispiel Design', 'Erika Beispiel', 'Lindenallee 4', '04109 Leipzig'];
  const rows = [
    'Rechnung',
    'Rechnungsnr.: 2026-31',
    'Datum: 6. Oktober 2026',
    ...address.map((line, i) => (seller[i] ? `${line}   ${seller[i]}` : line)),
    ...seller.slice(address.length),
    'Tel.: 0341 1234567',
    'Pos.   Bezeichnung   Menge   Einheit   Einzelpreis   Gesamt',
    '1   Gestaltung Logo   12   Std.   80,00 €   960,00 €',
    'Zwischensumme (netto)   960,00 €',
    'Umsatzsteuer 19 %   182,40 €',
    'Gesamtbetrag   1.142,40 €',
    'Erika Beispiel Design   USt-IdNr.: DE 123 456 789   Beispielbank Leipzig',
    'Lindenallee 4   Steuernummer: 231/123/45678   IBAN: DE02 1203 0000 0000 2020 51',
    '04109 Leipzig   BIC: BYLADEM1001',
  ];
  const blocks = [
    ['Rechnung', 'Rechnungsnr.: 2026-31', 'Datum: 6. Oktober 2026'],
    address,
    ...seller.map((line) => [line]),
    ['Erika Beispiel Design', 'Lindenallee 4', '04109 Leipzig'],
    ['USt-IdNr.: DE 123 456 789', 'Steuernummer: 231/123/45678'],
  ];
  return page(rows, blocks);
}

describe('guessFromText with a customer abroad', () => {
  it('reads the country printed below the address, and the VAT ID below that as the customer’s', () => {
    const guess = guessFromText(...letterhead(['Beispielkunde Handels GmbH', 'Hauptplatz 9', '1010 Wien'], 'ÖSTERREICH', 'ATU12345678'));
    expect(guess.buyer).toMatchObject({ name: 'Beispielkunde Handels GmbH', postalCode: '1010', city: 'Wien', country: 'AT', vatId: 'ATU12345678' });
    expect(guess.seller).toMatchObject({ vatId: 'DE123456789', country: 'DE' });
  });

  it('reads a Dutch postal code with its letters', () => {
    const guess = guessFromText(...letterhead(['Voorbeeld B.V.', 'Voorbeeldstraat 5', '1234 AB Voorbeeldstad'], 'NIEDERLANDE'));
    expect(guess.buyer).toMatchObject({ name: 'Voorbeeld B.V.', postalCode: '1234 AB', city: 'Voorbeeldstad', country: 'NL' });
  });

  it('does not take the seller’s address for the customer’s when it cannot read the customer’s', () => {
    const guess = guessFromText(...twoColumns(['Sample Trading Ltd', '7 Sample Road', 'Manchester', 'M1 1AA', 'UNITED KINGDOM']));
    expect(guess.buyer?.name).toBeUndefined();
    expect(guess.buyer?.street).toBeUndefined();
  });

  it('reads the customer beside the seller’s column when the seller repeats in the footer', () => {
    const guess = guessFromText(...twoColumns(['Beispielkunde GmbH', 'Industriestraße 1', '90402 Nürnberg']));
    expect(guess.buyer).toMatchObject({ name: 'Beispielkunde GmbH', street: 'Industriestraße 1', postalCode: '90402', city: 'Nürnberg' });
  });
});
