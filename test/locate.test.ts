import { describe, expect, it } from 'vitest';
import { locate, type Piece } from '../site/locate.js';

/** A piece of text: 10 high and, unless told otherwise, 10 wide per character. `y` is its upper edge. */
const piece = (text: string, x: number, y: number, width = text.length * 10): Piece => ({ text, x, y, width, height: 10 });

const page: Piece[] = [
  piece('Muster Software GmbH', 80, 40),
  piece('Rechnungsnummer', 340, 100),
  piece('RE-2026-0042', 500, 100),
  piece('Rechnungsdatum', 340, 120),
  piece('03.11.2026', 520, 120),
  piece('1', 50, 200),
  piece('Beratung E-Rechnung', 90, 200),
  piece('10 Std.', 330, 200),
  piece('100,00 €', 420, 200),
  piece('1.000,00 €', 520, 200),
  piece('2', 50, 220),
  piece('Softwarelizenz (Jahr)', 90, 220),
  piece('2 Stk.', 330, 220),
  piece('249,50 €', 420, 220),
  piece('499,00 €', 520, 220),
  piece('Gesamtbetrag', 340, 300),
  piece('1.783,81 €', 520, 300),
  piece('Muster Software GmbH · Beispielweg 1 · 12345 Musterstadt', 50, 700),
  piece('IBAN DE02 1203 0000 0000 2020 51 · USt-IdNr. DE123456789', 50, 720),
];

describe('locate', () => {
  it('finds a value that is a piece of its own', () => {
    expect(locate(page, 'RE-2026-0042')).toEqual([{ x: 500, y: 100, width: 120, height: 10 }]);
  });

  it('marks only the part of a piece that holds the value', () => {
    expect(locate(page, 'Beispielweg 1')).toEqual([{ x: 280, y: 700, width: 130, height: 10 }]);
  });

  it('ignores case and whitespace, as for an IBAN printed in groups', () => {
    expect(locate(page, 'de02120300000000202051')).toEqual([{ x: 100, y: 720, width: 270, height: 10 }]);
  });

  it('joins the adjacent pieces of a row', () => {
    const row = [piece('GmbH', 270, 11), piece('Muster', 100, 10), piece('Software', 170, 10)];
    expect(locate(row, 'Muster Software GmbH')).toEqual([{ x: 100, y: 10, width: 210, height: 11 }]);
  });

  it('marks every occurrence, such as the name in the letterhead and in the footer', () => {
    expect(locate(page, 'Muster Software GmbH')).toEqual([
      { x: 80, y: 40, width: 200, height: 10 },
      { x: 50, y: 700, width: 200, height: 10 },
    ]);
  });

  it('finds a date however it is printed', () => {
    expect(locate(page, '2026-11-03')).toEqual([{ x: 520, y: 120, width: 100, height: 10 }]);
    expect(locate([piece('Datum: 3. November 2026', 0, 0)], '2026-11-03')).toEqual([{ x: 70, y: 0, width: 160, height: 10 }]);
  });

  it('finds an amount however it is printed', () => {
    expect(locate(page, 1783.81)).toEqual([{ x: 520, y: 300, width: 80, height: 10 }]);
    expect(locate([piece('Total 1 783.81 EUR', 0, 0)], 1783.81)).toEqual([{ x: 60, y: 0, width: 80, height: 10 }]);
    expect(locate([piece('1,5 Std.', 0, 0)], 1.5)).toEqual([{ x: 0, y: 0, width: 30, height: 10 }]);
  });

  it('does not mark a short number inside a longer one', () => {
    expect(locate(page, 10)).toEqual([{ x: 330, y: 200, width: 20, height: 10 }]);
    expect(locate(page, 100)).toEqual([{ x: 420, y: 200, width: 60, height: 10 }]);
    expect(locate(page, 3.11)).toEqual([]);
    expect(locate(page, '12345')).toEqual([{ x: 440, y: 700, width: 50, height: 10 }]);
    expect(locate(page, 'DE')).toEqual([]);
    // The space that groups thousands does not end a number.
    expect(locate([piece('Total 1 783.81 EUR', 0, 0)], 1)).toEqual([]);
  });

  it('does not take the end of one column and the start of the next for a number', () => {
    expect(locate([piece('1', 0, 0), piece('10 Std.', 40, 0)], 110)).toEqual([]);
    expect(locate([piece('1', 0, 0), piece('10 Std.', 40, 0)], 1)).toEqual([{ x: 0, y: 0, width: 10, height: 10 }]);
  });

  it('follows a name that wraps over rows, part by part', () => {
    const table = [
      piece('1', 0, 0),
      piece('Softwarelizenz Premium', 40, 0),
      piece('249,50 €', 400, 0),
      piece('für ein weiteres (Jahr)', 40, 14),
      piece('2', 0, 40),
      piece('Wartung (Jahr)', 40, 40),
    ];
    expect(locate(table, 'Softwarelizenz Premium für ein weiteres (Jahr)')).toEqual([
      { x: 40, y: 0, width: 220, height: 10 },
      { x: 40, y: 14, width: 230, height: 10 },
    ]);
    // Every word has to be there: half a name is not a place.
    expect(locate(table, 'Softwarelizenz Premium für zwei (Jahr)')).toEqual([]);
    // The parts stand below each other, not anywhere on the page.
    expect(locate(table, 'Premium Wartung')).toEqual([]);
  });

  it('returns nothing for a value that is not printed, or is no text at all', () => {
    expect(locate(page, 'Anderes Büro KG')).toEqual([]);
    expect(locate(page, '')).toEqual([]);
    expect(locate(page, undefined)).toEqual([]);
    expect(locate([], 'RE-2026-0042')).toEqual([]);
  });

  it('with `beside`, looks only in the rows of those places, to their right first', () => {
    const name = locate(page, 'Softwarelizenz (Jahr)');
    expect(name).toEqual([{ x: 90, y: 220, width: 210, height: 10 }]);
    // The quantity, not the position number in front of the name and not a "2" elsewhere on the page.
    expect(locate(page, 2, { beside: name })).toEqual([{ x: 330, y: 220, width: 10, height: 10 }]);
    expect(locate(page, 249.5, { beside: name })).toEqual([{ x: 420, y: 220, width: 60, height: 10 }]);
    expect(locate(page, 100, { beside: name })).toEqual([]);
    expect(locate(page, 100, { beside: [] })).toEqual([]);
    // A quantity printed in front of the name is still found.
    expect(locate([piece('3 x', 0, 0), piece('Wartung', 50, 0)], 3, { beside: [{ x: 50, y: 0, width: 70, height: 10 }] })).toEqual([
      { x: 0, y: 0, width: 10, height: 10 },
    ]);
  });

  it('places a part of a piece by the widths of its letters when it can measure them', () => {
    const narrow = (text: string) => [...text].reduce((sum, letter) => sum + (letter === 'i' ? 1 : 3), 0);
    // "iiii " is 7 wide, "WWWW" 12, of 19 in all.
    expect(locate([piece('iiii WWWW', 0, 0, 190)], 'WWWW', { widthOf: narrow })).toEqual([{ x: 70, y: 0, width: 120, height: 10 }]);
  });
});
