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

describe('guessFromText with amounts', () => {
  it('takes the currency of the totals where the page names another one as well', () => {
    const text = [
      'Rechnung 2026-5   6. Oktober 2026',
      'Workshop   20 Std.   120,00 $   2.400,00 $',
      'Nettobetrag   2.400,00 $',
      'zzgl. 19 % USt.   456,00 $',
      'Gesamtbetrag   2.856,00 $',
      'Die Umsatzsteuer beträgt 390,24 € (Kurs 1 € = 1,1685 $).',
    ];
    expect(guessFromText(text.join('\n'))).toMatchObject({ currency: 'USD', totals: { net: 2400, vat: 456, gross: 2856 } });
  });

  it('reads totals of nothing as nothing', () => {
    const text = [
      'Pos.   Bezeichnung   Menge   Einheit   Einzelpreis   Gesamt',
      '1   Nachbesserung ohne Berechnung   0   Std.   70,00 €   0,00 €',
      'Zwischensumme (netto)   0,00 €',
      'Umsatzsteuer 19 %   0,00 €',
      'Gesamtbetrag   0,00 €',
    ];
    expect(guessFromText(text.join('\n')).totals).toEqual({ net: 0, vat: 0, gross: 0 });
  });

  it('reads the negative amounts of a cancellation', () => {
    const text = [
      'Stornorechnung 2026-6   7. Oktober 2026',
      'Beratung   -10 Std.   95,50 € -955,00 €',
      'Nettobetrag   -955,00 €',
      'zzgl. 19 % USt.   -181,45 €',
      'Gesamtbetrag   -1.136,45 €',
    ];
    expect(guessFromText(text.join('\n')).totals).toEqual({ net: -955, vat: -181.45, gross: -1136.45 });
  });

  it('does not take an English totals row for an item, and reads a price and a total that share a cell', () => {
    const text = [
      'Invoice 2026-40   October 6, 2026',
      'Description   Quantity   Unit price   Amount',
      'Design review   4 days   $1,200.00 $4,800.00',
      'Travel expenses   1 flat rate   $350.25 $350.25',
      'Net amount   $5,150.25',
      'Total amount   $5,150.25',
    ];
    const guess = guessFromText(text.join('\n'));
    expect(guess.totals).toEqual({ net: 5150.25, gross: 5150.25 });
    expect(guess.lines).toEqual([
      { name: 'Design review', quantity: 4, unit: 'DAY', unitPrice: 1200, vatCategory: 'S' },
      { name: 'Travel expenses', quantity: 1, unit: 'LS', unitPrice: 350.25, vatCategory: 'S' },
    ]);
  });
});

describe('guessFromText with units', () => {
  const table = (...items: string[]) =>
    ['Pos.   Bezeichnung   Menge   Einheit   Einzelpreis   Gesamt', ...items, 'Zwischensumme (netto)   1.000,00 €', 'Gesamtbetrag   1.000,00 €'].join('\n');

  it('reads a unit that stands in a column of its own', () => {
    const text = table(
      '1   Gestaltung   8   Std.   80,00 €   640,00 €',
      '2   Fahrt   400   km   0,30 €   120,00 €',
      '3   Betreuung   2   Wochen   100,00 €   200,00 €',
      '4   Material   1   pauschal   40,00 €   40,00 €',
    );
    expect(guessFromText(text).lines?.map((line) => line.unit)).toEqual(['HUR', 'KMT', 'WEE', 'LS']);
  });

  it('leaves a unit it does not know open instead of taking it for pieces', () => {
    const text = table('1   Lizenz   10 Nutzer   60,00 €   600,00 €', '2   Schulung   4 Stk   100,00 €   400,00 €');
    expect(guessFromText(text).lines?.map((line) => line.unit)).toEqual([undefined, 'C62']);
  });
});

describe('guessFromText with the title of the document', () => {
  it('reads number and date after a title such as Teilrechnung, and the kind of invoice it names', () => {
    const titles: [string, string | undefined][] = [
      ['Teilrechnung', '326'],
      ['Abschlagsrechnung', '386'],
      ['Stornorechnung', '384'],
      ['Rechnungskorrektur', '384'],
      ['Credit note', '381'],
      ['Rechnung', undefined],
      ['Schlussrechnung', undefined],
      // A Gutschrift may be a credit note or an invoice that the buyer issued: a person says which.
      ['Gutschrift', undefined],
    ];
    for (const [title, type] of titles) {
      const guess = guessFromText(`${title} 2026-13   6. Oktober 2026\nNettobetrag   100,00 €`);
      expect(guess, title).toMatchObject({ number: '2026-13', issueDate: '2026-10-06' });
      expect(guess.typeCode, title).toBe(type);
    }
  });

  it('takes the kind of invoice from the title only, not from a document the text names', () => {
    const guess = guessFromText('Rechnung 2026-14   6. Oktober 2026\nDiese Rechnung ersetzt die Stornorechnung 2026-12.');
    expect(guess).toMatchObject({ number: '2026-14' });
    expect(guess.typeCode).toBeUndefined();
  });

  it('reads a service period over several months', () => {
    expect(guessFromText('Leistungszeitraum: September 2026 bis Januar 2027')).toMatchObject({ periodStart: '2026-09-01', periodEnd: '2027-01-31' });
  });
});

describe('guessFromText with an invoice that charges no VAT', () => {
  const invoice = (note: string, address: string[] = []) =>
    [
      'Rechnung 2026-20   6. Oktober 2026',
      ...address,
      'Beratung   10 Std.   100,00 €   1.000,00 €',
      'Nettobetrag   1.000,00 €',
      'Gesamtbetrag   1.000,00 €',
      `Ohne Umsatzsteuer – ${note}`,
    ].join('\n');

  it.each([
    ['Steuerfreie innergemeinschaftliche Lieferung.', 'K'],
    ['Steuerfreie Ausfuhrlieferung.', 'G'],
    ['Steuerschuldnerschaft des Leistungsempfängers.', 'AE'],
    ['Reverse charge.', 'AE'],
    ['Steuerfrei nach § 4 Nr. 14 UStG.', 'E'],
    ['Gemäß § 19 UStG wird keine Umsatzsteuer berechnet.', 'E'],
    ['Not subject to VAT in Germany.', 'O'],
  ])('takes the category from the printed reason: %s', (note, category) => {
    const guess = guessFromText(invoice(note));
    expect(guess.lines).toMatchObject([{ vatCategory: category, vatRate: 0 }]);
    expect(guess.vatExemptionReason).toContain(note);
  });

  it('believes the printed reason before the country of the customer', () => {
    const address = ['Voorbeeld B.V.', 'Voorbeeldstraat 5', '1234 AB Voorbeeldstad', 'NIEDERLANDE'];
    expect(guessFromText(invoice('Steuerfreie innergemeinschaftliche Lieferung.', address)).lines).toMatchObject([{ vatCategory: 'K', vatRate: 0 }]);
  });
});

describe('guessFromText with payment terms', () => {
  it.each(['Die Zahlung ist bis zum 31. Oktober 2026 fällig.', 'Die Zahlung ist sofort fällig.', 'Zahlung ist innerhalb von 14 Tagen zu leisten.'])(
    'reads terms that start with the payment: %s',
    (terms) => {
      expect(guessFromText(`Rechnung 2026-21   6. Oktober 2026\n${terms}`).paymentTerms).toBe(terms);
    },
  );
});
