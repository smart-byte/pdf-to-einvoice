import { describe, expect, it } from 'vitest';
import { guessFromText } from '../src/guess.js';

// Layouts that do not put things where the reader used to look for them, rebuilt with made-up data. Each is read
// by what has to fit together: amounts that add up, the party that shows its tax details, a label and its value.

const MUSTER = { name: 'Muster Software GmbH', street: 'Beispielweg 1', postalCode: '12345', city: 'Musterstadt' };
const BEISPIEL = { name: 'Beispiel AG', street: 'Hauptstraße 5', postalCode: '54321', city: 'Beispielstadt' };

/** An address beside a block of labels, a sender line of two parts, prices that include VAT, tax details in footer columns. */
const parcel = {
  text: [
    'Rechnung',
    'Musterpost AG - 12345 Musterstadt',
    'Rechnungsnummer M0012345X',
    'Erika Muster   Kundennummer',
    'Warenkorb ID 7ABC',
    'Hauptstraße 5',
    'Rechnungsdatum 21.10.2026',
    '54321 Beispielstadt   Auftragsdatum 20.10.2026',
    '*USt.: Umsatzsteuer',
    'Artikelbezeichnung   Menge   Einzelpreis   USt.   Gesamtpreis',
    'inkl. USt.*   inkl. USt.',
    '5 kg - Paket - Inland   1   7,49 €   0 %   7,49 €',
    'Gesamtsumme Netto   7,49 €',
    'Umsatzsteuer 0 %   0,00 €',
    'Gesamtsumme Brutto   7,49 €',
    'Der Betrag von 7,49 € ist bereits bezahlt.',
    'Musterpost AG   Kontoverbindung   Sitz Musterstadt',
    '12345 Musterstadt   Musterbank   Amtsgericht Musterstadt',
    'Gläubiger-Identifikationsnummer:   HRB 12345',
    'DE98ZZZ09999999999   USt-ldNr.: DE 123456789',
    'IBAN: DE02 1203 0000 0000 2020 51   StNr 123/4567/8901',
  ].join('\n'),
  blocks: [
    ['Rechnung', 'Musterpost AG - 12345 Musterstadt', 'Erika Muster', 'Hauptstraße 5', '54321 Beispielstadt'],
    ['Rechnungsnummer M0012345X', 'Kundennummer', 'Warenkorb ID 7ABC', 'Rechnungsdatum 21.10.2026', 'Auftragsdatum 20.10.2026'],
    ['Musterpost AG', '12345 Musterstadt'],
    ['Kontoverbindung', 'Musterbank', 'Gläubiger-Identifikationsnummer:', 'DE98ZZZ09999999999', 'IBAN: DE02 1203 0000 0000 2020 51'],
    ['Sitz Musterstadt', 'Amtsgericht Musterstadt', 'HRB 12345', 'USt-ldNr.: DE 123456789', 'StNr 123/4567/8901'],
  ],
};

/** A value below its label in a side column, totals under a row of headings, the date beside the title, a second page of details. */
const charging = {
  text: [
    'Musterstrom',
    'Energie Beispielland AG',
    'Musterstrom Energie Beispielland AG · Beispielweg 1 · 12345 Musterstadt',
    'Erika Muster',
    'Hauptstraße 5',
    'Beispielweg 1',
    '54321 Beispielstadt   12345 Musterstadt',
    'musterstrom.example/laden',
    'Ihre Musterstrom Rechnung   12. Oktober 2026',
    'für Strom unterwegs im August 2026',
    'Guten Tag Erika Muster,',
    'hier ist Ihre Abrechnung für den letzten Monat. Sie hat die   Rechnungs-Nr.',
    'Einzelheiten stehen auf der zweiten Seite.   100 200 300 400',
    'Kundenkonto',
    'Der Betrag wird von Ihrem Konto abgebucht.   700000000001',
    'Nettobetrag   Umsatzsteuer Bruttobetrag   (bei Zahlung angeben)',
    'Vertrag',
    'Monatspauschale   10,00 €   1,90 €   (19%)   11,90 €   V-000-1',
    '1   Lieferland',
    'Summe   10,00 €   1,90 €   11,90 €',
    'Deutschland',
    'Rechnungsendbetrag   11,90 €',
    'Wir buchen 11,90 € nicht vor dem Fälligkeitstag 12.10.2026 ab.',
    'Musterbank · BIC BYLADEM1001 · IBAN DE02 1203 0000 0000 2020 51',
    'Sitz der Gesellschaft: Musterstadt · Amtsgericht Musterstadt · HRB 12345 · DE123456789',
    'Übersicht der Pauschalen',
    'Monat   Beschreibung   Nettobetrag Bruttobetrag',
    'August 2026 01.08.2026 - 31.08.2026 Tarif Basis: 11,90 €   10,00 €   11,90 €',
  ].join('\n'),
  blocks: [
    ['Musterstrom', 'Energie Beispielland AG'],
    ['Musterstrom Energie Beispielland AG · Beispielweg 1 · 12345 Musterstadt'],
    ['Erika Muster', 'Hauptstraße 5', '54321 Beispielstadt'],
    ['Beispielweg 1', '12345 Musterstadt', 'musterstrom.example/laden'],
    ['Rechnungs-Nr.', '100 200 300 400', 'Kundenkonto', '700000000001', '(bei Zahlung angeben)', 'Vertrag', 'V-000-1'],
  ],
};

/** Every party under its label, prices with four decimals before the quantity, columns that run into each other, a long list of sums. */
const sections = [
  'Handelsrechnung Nr. R-2026-17 vom 12.05.2026',
  'Währung   : EUR',
  'Liefer- und Leistungsdatum   : 11.05.2026',
  'Verkäufer:',
  'Nummer   : 100200',
  'Muster Software GmbH',
  'Beispielweg 1',
  'DE 12345 Musterstadt',
  'Steuernummer : 123/456/78901',
  'USt.-Id.-Nr. : DE123456789',
  'Käufer:',
  'Nummer   : K-77',
  'Beispiel AG',
  'Hauptstraße 5',
  'DE 54321 Beispielstadt',
  'USt.-Id.-Nr. : DE987654321',
  'Qualifizierung der Textart: REG',
  'Muster Software GmbH',
  'Beispielweg 1',
  '12345 Musterstadt',
  'Geschäftsführer: Max Mustermann',
  'Warenempfänger',
  'Beispiel Lager',
  'Lagerstraße 9',
  '54321 Beispielstadt',
  'Pos   Beschreibung   Nettopreis   Menge   Steuer   Entgelt',
  '1   Papier   12,5000   4 Stk 19 % VAT (S)   50,00',
  'P100   A4',
  'Bruttopreis : 12,50',
  '2   Äpfel   3,0000   10 kg   7 % VAT (S)   30,00',
  'Umsatzsteueraufschlüsselung:',
  'VAT (S)   30,00   7   2,10',
  'VAT (S)   50,00   19   9,50',
  'Belegsummen:',
  'Positionssumme   80,00',
  'Gesamtbetrag der Zuschläge   0,00',
  'Gesamtbetrag der Abschläge   -0,00',
  'Rechnungssumme ohne USt.   80,00',
  'Steuerbetrag in   EUR   11,60',
  'Bruttosumme   91,60',
  'Erhaltene Anzahlungen   -0,00',
  'Zahlbetrag   91,60',
].join('\n');

/** French labels, two addresses side by side, a street that starts with four digits, a discount in percent, two VAT rates. */
const boutique = {
  text: [
    'Moulin Exemple SARL - 1500 chemin des vignes - 84000 Villexemple - France',
    'TVA : FR12345678901 - SIRET : 12345678900010',
    'Facture FA-2026-0042',
    'Adresse de livraison',
    'Boutique Exemple',
    'Boutique Exemple',
    'Jeanne Exemple',
    '12 rue du Port',
    '12 rue du Port',
    '13001 Villemodèle',
    'France   13001 Villemodèle',
    'France',
    'Date de facture   14/10/2026',
    "Date d'échéance   14/11/2026",
    'N° TVA client   FR98765432109',
    'Description   Quantité   Prix unitaire   Rem.   Prix HT',
    'Miel 500g   20 Unit(s)   6,50 €   10%   117,00 €',
    'Savon 100g   15 Unit(s)   2,40 €   36,00 €',
    'Taxe   Base   Montant   Total HT   153,00 €',
    'TVA collectée 20,0%   117,00 €   23,40 €',
    'Total taxes   25,38 €',
    'TVA collectée 5,5%   36,00 €   1,98 €',
    'Total TTC   178,38 €',
    'IBAN : FR76 3000 6000 0112 3456 7890 189 - BIC : AGRIFRPP',
  ].join('\n'),
  blocks: [
    ['Moulin Exemple SARL - 1500 chemin des vignes - 84000 Villexemple - France', 'TVA : FR12345678901 - SIRET : 12345678900010'],
    ['Facture FA-2026-0042'],
    ['Adresse de livraison', 'Boutique Exemple', '12 rue du Port', '13001 Villemodèle', 'France'],
    ['Boutique Exemple', 'Jeanne Exemple', '12 rue du Port', '13001 Villemodèle', 'France'],
    ['Date de facture', "Date d'échéance", 'N° TVA client'],
    ['14/10/2026', '14/11/2026', 'FR98765432109'],
  ],
};

/** The quantity in front, written like an amount; a unit price with three decimals; the number and its date in one sentence. */
const balloons = [
  'Invoice # RE-2026/417 issued at 2026-10-21',
  'Date of delivery 2026-10-14',
  'Amount   Product   VAT   Price   Total',
  '2.00   Layout (hours)   7%   90.00 €   180.00 €',
  '300.00   Stickers: various colours,   19%   0.35 €   105.00 €',
  '~ 50 mm',
  '500.00   Flyer (pieces)   19%   0.045 €   22.50 €',
  'Net total: 307.50 €',
  'plus VAT',
  'VAT   Net amount   VAT amount',
  '7%   180.00 €   12.60 €',
  '19%   127.50 €   24.23 €',
  'VAT total: 36.83 €',
  'Due payable: 344.33 €',
  'Please remit until 2026-11-11 .',
  'VAT-ID: DE123456789',
].join('\n');

describe('guessFromText with the blocks of the page', () => {
  it('reads an address that the rows mix with the column beside it', () => {
    expect(guessFromText(parcel.text, parcel)).toEqual({
      number: 'M0012345X',
      issueDate: '2026-10-21',
      currency: 'EUR',
      iban: 'DE02120300000000202051',
      seller: { name: 'Musterpost AG', postalCode: '12345', city: 'Musterstadt', country: 'DE', vatId: 'DE123456789', taxNumber: '123/4567/8901' },
      buyer: { name: 'Erika Muster', street: 'Hauptstraße 5', postalCode: '54321', city: 'Beispielstadt' },
      lines: [{ name: '5 kg - Paket - Inland', quantity: 1, unit: 'C62', unitPrice: 7.49, vatCategory: 'S', vatRate: 0 }],
      totals: { net: 7.49, vat: 0, gross: 7.49 },
    });
  });

  it('reads no buyer from mixed rows alone, rather than a wrong one', () => {
    const { buyer, ...rest } = guessFromText(parcel.text, parcel);
    expect(buyer).toBeDefined();
    expect(guessFromText(parcel.text)).toEqual(rest);
  });

  it('reads a value below its label, totals under their headings, and the date beside the title', () => {
    expect(guessFromText(charging.text, charging)).toEqual({
      number: '100200300400',
      issueDate: '2026-10-12',
      periodStart: '2026-08-01',
      periodEnd: '2026-08-31',
      dueDate: '2026-10-12',
      currency: 'EUR',
      iban: 'DE02120300000000202051',
      bic: 'BYLADEM1001',
      seller: {
        name: 'Musterstrom Energie Beispielland AG',
        street: 'Beispielweg 1',
        postalCode: '12345',
        city: 'Musterstadt',
        country: 'DE',
        vatId: 'DE123456789',
      },
      buyer: { name: 'Erika Muster', street: 'Hauptstraße 5', postalCode: '54321', city: 'Beispielstadt', country: 'DE' },
      lines: [{ name: 'Monatspauschale', quantity: 1, unit: 'C62', unitPrice: 10, vatCategory: 'S', vatRate: 19 }],
      totals: { net: 10, vat: 1.9, gross: 11.9 },
    });
  });

  it('does not take the row below a label for its value when the label ends a longer row', () => {
    expect(guessFromText(charging.text).number).toBeUndefined();
  });

  it('reads French labels, the address that is not the delivery address, and neither rate nor quantity from a row with a discount', () => {
    expect(guessFromText(boutique.text, boutique)).toEqual({
      number: 'FA-2026-0042',
      issueDate: '2026-10-14',
      dueDate: '2026-11-14',
      currency: 'EUR',
      iban: 'FR7630006000011234567890189',
      bic: 'AGRIFRPP',
      seller: {
        name: 'Moulin Exemple SARL',
        street: '1500 chemin des vignes',
        postalCode: '84000',
        city: 'Villexemple',
        country: 'FR',
        vatId: 'FR12345678901',
      },
      buyer: {
        name: 'Boutique Exemple',
        contactName: 'Jeanne Exemple',
        street: '12 rue du Port',
        postalCode: '13001',
        city: 'Villemodèle',
        country: 'FR',
        vatId: 'FR98765432109',
      },
      lines: [
        { name: 'Miel 500g', unit: 'C62', vatCategory: 'S' },
        { name: 'Savon 100g', quantity: 15, unit: 'C62', unitPrice: 2.4, vatCategory: 'S' },
      ],
      totals: { net: 153, vat: 25.38, gross: 178.38 },
    });
  });
});

describe('guessFromText on parties under their labels', () => {
  const guess = guessFromText(sections);

  it('reads seller and buyer by their labels, each with the VAT ID that stands in its block', () => {
    expect(guess.seller).toEqual({ ...MUSTER, country: 'DE', vatId: 'DE123456789', taxNumber: '123/456/78901' });
    expect(guess.buyer).toEqual({ ...BEISPIEL, country: 'DE', vatId: 'DE987654321' });
  });

  it('reads the number and the date from the sentence that names both', () => {
    expect(guess).toMatchObject({ number: 'R-2026-17', issueDate: '2026-05-12', deliveryDate: '2026-05-11' });
  });

  it('reads quantity and unit price as the two numbers that multiply to the row total', () => {
    expect(guess.lines).toEqual([
      { name: 'Papier', quantity: 4, unit: 'C62', unitPrice: 12.5, vatCategory: 'S', vatRate: 19 },
      { name: 'Äpfel', quantity: 10, unit: 'KGM', unitPrice: 3, vatCategory: 'S', vatRate: 7 },
    ]);
  });

  it('reads the totals that add up, not the amount beside "ohne USt."', () => {
    expect(guess.totals).toEqual({ net: 80, vat: 11.6, gross: 91.6 });
  });

  it('reads the name above a labelled value that stands inside the address', () => {
    const text = ['Käufer :', 'Beispiel AG', 'Handelsname: 12345678900010', 'Erika Muster', 'Hauptstraße 5', 'DE 54321 Beispielstadt'];
    expect(guessFromText(text.join('\n')).buyer).toEqual({ ...BEISPIEL, contactName: 'Erika Muster', country: 'DE' });
  });

  it('takes the first line under a heading for the name, also above a person and a department', () => {
    const text = ['Verkäufer:', 'Muster Software GmbH', 'Max Mustermann', 'Einkauf', 'Beispielweg 1', 'DE 12345 Musterstadt', 'Telefon : +49301234567'];
    expect(guessFromText(text.join('\n')).seller).toEqual({ ...MUSTER, contactName: 'Max Mustermann', country: 'DE', phone: '+49301234567' });
  });

  it('does not take a line that holds an identifier for the name', () => {
    const address = ['GLN 4012345000009', 'Kunden-Nr. : 0042', 'Beispiel AG', 'Hauptstraße 5', '54321 Beispielstadt'];
    expect(guessFromText(['Käufer:', ...address].join('\n')).buyer).toEqual(BEISPIEL);
    expect(guessFromText(['GLN 4012345000009', ...address.slice(2)].join('\n')).buyer).toEqual(BEISPIEL);
  });

  it('takes the address under a buyer label, also when another address comes first', () => {
    const text = [
      'Lieferadresse:',
      'Beispiel Lager',
      'Lagerstraße 9',
      '54321 Beispielstadt',
      'Rechnungsadresse:',
      'Beispiel AG',
      'Hauptstraße 5',
      '54321 Beispielstadt',
    ];
    expect(guessFromText(text.join('\n')).buyer).toEqual(BEISPIEL);
  });
});

describe('guessFromText on seller and buyer without labels', () => {
  const letterhead = ['Muster Software GmbH', 'Beispielweg 1', '12345 Musterstadt'];
  const recipient = ['Beispiel AG', 'Hauptstraße 5', '54321 Beispielstadt'];
  const footer = 'Muster Software GmbH   Amtsgericht Musterstadt   HRB 12345';

  it('takes the party that repeats with its register entry for the seller, also when its address comes first', () => {
    const guess = guessFromText([...letterhead, ...recipient, 'Rechnungsnummer 4711', footer].join('\n'));
    expect(guess.seller).toEqual(MUSTER);
    expect(guess.buyer).toEqual(BEISPIEL);
  });

  it('reads no buyer when two addresses are left and nothing tells them apart', () => {
    const guess = guessFromText([...letterhead, ...recipient, 'Rechnungsnummer 4711'].join('\n'));
    expect(guess).toEqual({ number: '4711' });
  });

  it('reads a sender line of two parts', () => {
    expect(guessFromText('Musterpost AG - 12345 Musterstadt').seller).toEqual({ name: 'Musterpost AG', postalCode: '12345', city: 'Musterstadt' });
  });

  it('keeps a salutation and a second line with the legal form in the name', () => {
    expect(guessFromText('Herrn\nErik Beispiel\nHauptstraße 5\n54321 Beispielstadt').buyer).toMatchObject({ name: 'Herrn Erik Beispiel' });
    const insurer = 'Beispielhafte Hilfe\nVersicherungsverein Beispielstadt a.G.\nHauptstraße 5\n54321 Beispielstadt';
    expect(guessFromText(insurer).buyer).toEqual({ ...BEISPIEL, name: 'Beispielhafte Hilfe Versicherungsverein Beispielstadt a.G.' });
  });
});

describe('guessFromText on identifiers', () => {
  it('recognises a German VAT ID by its shape, without a label or with a misspelt one', () => {
    expect(guessFromText('Amtsgericht Musterstadt · HRB 12345 · DE123456789').seller).toEqual({ vatId: 'DE123456789', country: 'DE' });
    expect(guessFromText('USt-ldNr.: DE 123 456 789').seller).toEqual({ vatId: 'DE123456789', country: 'DE' });
  });

  it('takes neither an IBAN nor a SEPA creditor ID for a VAT ID', () => {
    expect(guessFromText('IBAN DE02 1203 0000 0000 2020 51')).toEqual({ iban: 'DE02120300000000202051' });
    expect(guessFromText('IBAN DE02120300000000202051')).toEqual({ iban: 'DE02120300000000202051' });
    expect(guessFromText('Gläubiger-ID: DE98ZZZ09999999999')).toEqual({});
  });

  it('takes a VAT ID that is labelled as the customer’s for the buyer’s, never for the seller’s', () => {
    expect(guessFromText('Customer VAT Number   ESB98765432')).toEqual({ buyer: { vatId: 'ESB98765432', country: 'ES' } });
  });

  it('does not cut an IBAN down to a part that happens to pass the check', () => {
    expect(guessFromText('IBAN : DE25 1000 0000 1000 1187 85')).toEqual({});
  });

  it('reads the number of a document whose title is not "Rechnung"', () => {
    expect(guessFromText('Rechnungskorrektur Nr. RK-2026-7 vom 22.08.2026')).toEqual({ number: 'RK-2026-7', issueDate: '2026-08-22' });
    expect(guessFromText('Gutschrift (Selbst ausgestellte Rechnung) Nr. 4711 vom\n09.04.2026')).toEqual({ number: '4711', issueDate: '2026-04-09' });
    expect(guessFromText('Rechnung des Versicherers Nr. 12.345.678.9-2026-3 vom\n14.10.2026')).toMatchObject({ number: '12.345.678.9-2026-3' });
  });

  it('does not take the number of an order for the number of the invoice', () => {
    expect(guessFromText('Rechnung zu Ihrer Bestellung Nr. 4711 vom 01.03.2026')).toEqual({});
  });
});

describe('guessFromText on the currency', () => {
  it('reads the currency after its label, also where the page shows another one', () => {
    expect(guessFromText('Rechnungswährung : GBP\nUmgerechnet 110,00 €').currency).toBe('GBP');
  });

  it('reads no currency from a page that shows two', () => {
    expect(guessFromText('Summe 100,00 €\nentspricht 110,00 USD').currency).toBeUndefined();
  });
});

describe('guessFromText on totals', () => {
  it('finds net, VAT and gross in a row without labels by the sum they form', () => {
    expect(guessFromText('Summe   10,00 €   1,90 €   11,90 €').totals).toEqual({ net: 10, vat: 1.9, gross: 11.9 });
  });

  it('reads no totals from amounts that could add up in two ways', () => {
    expect(guessFromText('A   10,00   1,90   11,90\nB   20,00   3,80   23,80').totals).toBeUndefined();
  });

  it('takes the amount after "inkl. MwSt." for the gross total, not for the VAT', () => {
    expect(guessFromText('Gesamtbetrag inkl. MwSt.   119,00 €').totals).toEqual({ gross: 119 });
  });

  it('reads no totals from labelled amounts that cannot belong together', () => {
    expect(guessFromText('Netto 200,00\nMwSt. 19 % 19,00\nGesamt 500,00').totals).toBeUndefined();
  });

  it('keeps net and gross where the VAT between them is printed in parts', () => {
    expect(guessFromText('Netto 200,00\nMwSt. 19 % 19,00\nMwSt. 7 % 7,00\nGesamt 226,00').totals).toEqual({ net: 200, gross: 226 });
  });

  it('does not believe a sum of other amounts against the labels', () => {
    const text = 'Nettobetrag   -7,67\nSteuerbetrag\n1,12\nBruttosumme   -8,79\nNachlass   0,08   0,02   0,10';
    expect(guessFromText(text).totals).toEqual({ net: -7.67, gross: -8.79 });
  });

  it('does not take the first cell of the next row for the value of a column heading', () => {
    expect(guessFromText('Menge   Produkt   Preis   Gesamtbetrag\n1,00   Design   160,00 €   160,00 €').totals).toBeUndefined();
  });
});

describe('guessFromText on payment terms', () => {
  const terms = (...rows: string[]) => guessFromText(['Rechnung RE-1', ...rows].join('\n')).paymentTerms;

  it('reads the sentence that says when to pay, as it is printed', () => {
    expect(terms('Zahlbar innerhalb von 14 Tagen ohne Abzug.')).toBe('Zahlbar innerhalb von 14 Tagen ohne Abzug.');
    expect(terms('Payment is due within 30 days of the invoice date.')).toBe('Payment is due within 30 days of the invoice date.');
    expect(terms('Paiement à 30 jours fin de mois.')).toBe('Paiement à 30 jours fin de mois.');
  });

  it('reads the terms after their label', () => {
    expect(terms('Zahlungsbedingungen: 30 Tage netto')).toBe('30 Tage netto');
    expect(terms('Payment terms   Net 30')).toBe('Net 30');
  });

  it('joins a sentence that wraps into the next row', () => {
    expect(terms('Bitte überweisen Sie den Rechnungsbetrag innerhalb von 14 Tagen', 'auf das unten genannte Konto.', 'Vielen Dank.')).toBe(
      'Bitte überweisen Sie den Rechnungsbetrag innerhalb von 14 Tagen auf das unten genannte Konto.',
    );
  });

  it('joins a row that ends in the middle of the terms with the next one, also where that starts with a capital', () => {
    expect(terms('Zahlbar innerhalb 30 Tagen netto bis 04.12.2026, 3%', 'Skonto innerhalb 10 Tagen bis 14.11.2026', 'Zu- und Abschläge:')).toBe(
      'Zahlbar innerhalb 30 Tagen netto bis 04.12.2026, 3% Skonto innerhalb 10 Tagen bis 14.11.2026',
    );
    expect(terms('Zahlbar sofort rein netto', 'Vielen Dank für Ihren Auftrag')).toBe('Zahlbar sofort rein netto');
  });

  it('takes the cell with the sentence, not the column beside it', () => {
    expect(terms('Zahlbar sofort ohne Abzug   Bank: Musterbank')).toBe('Zahlbar sofort ohne Abzug');
  });

  it('takes neither an amount to pay nor the way of paying for payment terms', () => {
    expect(terms('Zahlbetrag   1.190,00 €', 'Zahlungsart: Überweisung', 'Zahlungseingang 03.11.2026')).toBeUndefined();
  });
});

describe('guessFromText on table rows', () => {
  it('reads rows without a table heading it knows, the quantity in front, and a price with three decimals', () => {
    expect(guessFromText(balloons)).toEqual({
      number: 'RE-2026/417',
      issueDate: '2026-10-21',
      deliveryDate: '2026-10-14',
      paymentTerms: 'Please remit until 2026-11-11 .',
      currency: 'EUR',
      seller: { vatId: 'DE123456789', country: 'DE' },
      lines: [
        { name: 'Layout (hours)', quantity: 2, unit: 'C62', unitPrice: 90, vatCategory: 'S', vatRate: 7 },
        { name: 'Stickers: various colours, ~ 50 mm', quantity: 300, unit: 'C62', unitPrice: 0.35, vatCategory: 'S', vatRate: 19 },
        { name: 'Flyer (pieces)', quantity: 500, unit: 'C62', unitPrice: 0.045, vatCategory: 'S', vatRate: 19 },
      ],
      totals: { net: 307.5, vat: 36.83, gross: 344.33 },
    });
  });

  /** A description that wraps while the columns beside it go on: the rows mix it with them, its block does not. */
  const wrapping = {
    text: [
      'Pos   Beschreibung   Nettopreis   Menge   Entgelt',
      '1   Trennwand   10,00   2 m²   20,00',
      'TW-1   weiß 3 m',
      'Bruttopreis : 11,90',
      '2   Wartungs-   5,00   1 Stk   5,00',
      'WV-2   Vertrag',
      'Nettosumme   25,00',
    ].join('\n'),
    blocks: [
      ['Pos', '1', '2'],
      ['Beschreibung', 'Trennwand', 'weiß 3 m', 'Bruttopreis : 11,90', 'Wartungs-', 'Vertrag'],
      ['TW-1', 'WV-2'],
      ['Nettopreis', '10,00', '5,00'],
    ],
  };

  it('reads a description that wraps beside other columns from its block', () => {
    expect(guessFromText(wrapping.text, wrapping).lines).toEqual([
      { name: 'Trennwand weiß 3 m', quantity: 2, unit: 'MTK', unitPrice: 10, vatCategory: 'S' },
      { name: 'Wartungs-Vertrag', quantity: 1, unit: 'C62', unitPrice: 5, vatCategory: 'S' },
    ]);
  });

  /** An invoice over two pages as invoicing programs print it: page number and footer between the items, the table head once more. */
  const overTwoPages = (endOfPage: string[] = [], startOfPage: string[] = []) =>
    [
      'Rechnung RE-2026-0077',
      'Pos.   Bezeichnung   Menge   Einzelpreis   Gesamt',
      '1   Wartung Januar   2 Std.   100,00 €   200,00 €',
      '2   Wartung Februar   3 Std.   100,00 €   300,00 €',
      ...endOfPage,
      'Seite 1 von 2',
      'Muster Software GmbH · Beispielweg 1 · 12345 Musterstadt',
      'Pos.   Bezeichnung   Menge   Einzelpreis   Gesamt',
      ...startOfPage,
      '3   Wartung März   1 Std.   100,00 €   100,00 €',
      'Nettobetrag   600,00 €',
      'Umsatzsteuer 19 %   114,00 €',
      'Gesamtbetrag   714,00 €',
      'Seite 2 von 2',
    ].join('\n');
  const names = (text: string, blocks?: string[][]) => guessFromText(text, { blocks }).lines?.map((line) => line.name);

  it('reads a table that goes on over a page break, with its head printed again', () => {
    expect(names(overTwoPages())).toEqual(['Wartung Januar', 'Wartung Februar', 'Wartung März']);
  });

  it('does not take a subtotal at the end of a page or a carry-over at the start of the next for the end of the table', () => {
    expect(names(overTwoPages(['Zwischensumme   500,00 €'], ['Übertrag   500,00 €']))).toEqual(['Wartung Januar', 'Wartung Februar', 'Wartung März']);
    expect(names(overTwoPages(['Übertrag   500,00 €'], ['Übertrag   500,00 €']))).toHaveLength(3);
  });

  it('still reads an item whose amount happens to be the sum of the items above it', () => {
    const text = [
      'Bezeichnung   Betrag',
      'Einrichtung   500,00 €',
      'Betrieb   500,00 €',
      'Nettobetrag   1.000,00 €',
      'Umsatzsteuer 19 %   190,00 €',
      'Gesamtbetrag   1.190,00 €',
    ];
    expect(names(text.join('\n'))).toEqual(['Einrichtung', 'Betrieb']);
  });

  it('keeps text that stands below an item in another column out of its name', () => {
    const text = [
      'Bezeichnung   Menge   Einzelpreis   Gesamt',
      'Wartung Januar   2 Std.   100,00 €   200,00 €',
      'Vielen Dank für Ihren Auftrag',
      'Nettobetrag   200,00 €',
      'Umsatzsteuer 19 %   38,00 €',
      'Gesamtbetrag   238,00 €',
    ].join('\n');
    const blocks = [['Bezeichnung', 'Wartung Januar'], ['Vielen Dank für Ihren Auftrag'], ['Nettobetrag', 'Umsatzsteuer 19 %', 'Gesamtbetrag']];
    expect(names(text, blocks)).toEqual(['Wartung Januar']);
  });

  it('reads only the first line of such a description from the rows alone', () => {
    expect(guessFromText(wrapping.text).lines).toMatchObject([{ name: 'Trennwand' }, { name: 'Wartungs-' }]);
  });

  it('takes the text below a row for its name, not the text above, when the row holds more than number and amount', () => {
    const text = 'Lieferung frei Haus\n2   5,00   3 Stk   15,00\n10-\nTage-Pass\nNettosumme   15,00';
    expect(guessFromText(text).lines).toEqual([{ name: '10-Tage-Pass', quantity: 3, unit: 'C62', unitPrice: 5, vatCategory: 'S' }]);
  });

  it('reads no quantity that does not give the row total', () => {
    const text = 'Pos   Leistung   Preis   Menge   Betrag\n1   Kurierfahrt   3,00   7 km   22,50\nNettosumme   22,50';
    expect(guessFromText(text).lines).toEqual([{ name: 'Kurierfahrt', unit: 'C62', vatCategory: 'S' }]);
  });

  /** A table whose prices include VAT: its rows add up to the gross total. */
  const inclusive = (row: string, net: string, gross: string) =>
    [
      'Artikel   Menge   Einzelpreis inkl. USt.   USt.   Gesamtpreis inkl. USt.',
      row,
      `Gesamtsumme Netto   ${net} €`,
      'Umsatzsteuer 19 %   1,90 €',
      `Gesamtsumme Brutto   ${gross} €`,
    ].join('\n');

  it('derives net unit prices where the rows add up to the gross total', () => {
    expect(guessFromText(inclusive('Versandkarton   2   5,95 €   19 %   11,90 €', '10,00', '11,90')).lines).toEqual([
      { name: 'Versandkarton', quantity: 2, unit: 'C62', unitPrice: 5, vatCategory: 'S', vatRate: 19 },
    ]);
  });

  it('reads no lines where the derived net prices would not give the printed net total', () => {
    const guess = guessFromText(inclusive('Versandkarton   3   3,97 €   19 %   11,91 €', '10,01', '11,91'));
    expect(guess.totals).toEqual({ net: 10.01, vat: 1.9, gross: 11.91 });
    expect(guess.lines).toBeUndefined();
  });

  it('does not give a reason for charging no VAT that the invoice does not give', () => {
    expect(guessFromText(parcel.text, parcel).vatExemptionReason).toBeUndefined();
  });
});
