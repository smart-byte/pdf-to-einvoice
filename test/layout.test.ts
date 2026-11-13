import { readFileSync } from 'node:fs';
import { PDFDocument, StandardFonts } from '@cantoo/pdf-lib';
import { describe, expect, it } from 'vitest';
import { extractLayout, extractText } from '../src/text.js';

type Drawn = [text: string, x: number, y: number, size?: number];

/** A page with texts drawn at their positions, in points from the bottom left. */
async function pdfWith(texts: Drawn[]): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage([595, 842]);
  for (const [text, x, y, size = 10] of texts) page.drawText(text, { x, y, size, font });
  return doc.save();
}

describe('extractLayout', () => {
  it('writes the minus sign of typesetting as a hyphen, the way amounts are read', async () => {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Symbol);
    doc.addPage([595, 842]).drawText('−1.234,50', { x: 60, y: 700, size: 10, font });
    expect((await extractLayout(await doc.save())).text).toBe('-1.234,50');
  });

  it('returns the rows that extractText returns', async () => {
    const pdf = new Uint8Array(readFileSync(new URL('../examples/sample-invoice.pdf', import.meta.url)));
    expect((await extractLayout(pdf)).text).toBe(await extractText(pdf));
  });

  it('keeps an address together as a block where the rows mix it with the column beside it', async () => {
    const layout = await extractLayout(
      await pdfWith([
        ['Erika Muster', 60, 700],
        ['Hauptstraße 5', 60, 685],
        ['54321 Beispielstadt', 60, 670],
        ['Rechnungsnummer R-1', 350, 705],
        ['Kundennummer 77', 350, 695],
        ['Rechnungsdatum 21.10.2026', 350, 685],
        ['Seite 1 von 1', 350, 675],
      ]),
    );
    expect(layout.text.split('\n')).toEqual([
      'Rechnungsnummer R-1',
      'Erika Muster',
      'Kundennummer 77',
      'Hauptstraße 5   Rechnungsdatum 21.10.2026',
      'Seite 1 von 1',
      '54321 Beispielstadt',
    ]);
    expect(layout.blocks).toEqual([
      ['Rechnungsnummer R-1', 'Kundennummer 77', 'Rechnungsdatum 21.10.2026', 'Seite 1 von 1'],
      ['Erika Muster', 'Hauptstraße 5', '54321 Beispielstadt'],
    ]);
  });

  it('keeps an address with double line spacing in one block, and what stands far below it in another', async () => {
    const layout = await extractLayout(
      await pdfWith([
        ['Erika Muster', 60, 700, 14],
        ['Hauptstraße 5', 60, 673, 12],
        ['54321 Beispielstadt', 60, 646, 12],
        ['Sehr geehrte Frau Muster,', 60, 560, 12],
      ]),
    );
    expect(layout.blocks).toEqual([['Erika Muster', 'Hauptstraße 5', '54321 Beispielstadt'], ['Sehr geehrte Frau Muster,']]);
  });

  it('joins the pieces of a word that the PDF holds apart, and keeps words apart', async () => {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    // pdf.js hands out a piece of its own whenever the font changes.
    const other = await doc.embedFont(StandardFonts.Courier);
    const page = doc.addPage([595, 842]);
    const width = (text: string) => font.widthOfTextAtSize(text, 12);
    page.drawText('Rechnung', { x: 60, y: 700, size: 12, font: other });
    page.drawText('RE-20', { x: 60 + other.widthOfTextAtSize('Rechnung ', 12), y: 700, size: 12, font });
    page.drawText('26/508', { x: 60 + other.widthOfTextAtSize('Rechnung ', 12) + width('RE-20'), y: 700, size: 12, font: other });
    expect(await extractText(await doc.save())).toBe('Rechnung RE-2026/508');
  });

  it('keeps a value that is set apart behind its colon in the cell of its label', async () => {
    const layout = await extractLayout(
      await pdfWith([
        ['Nummer', 60, 700],
        [': 77', 160, 700],
        ['Beispiel AG', 60, 688],
        ['Seite 1', 400, 688],
      ]),
    );
    expect(layout.text).toBe('Nummer : 77\nBeispiel AG   Seite 1');
    expect(layout.blocks).toEqual([['Nummer : 77', 'Beispiel AG'], ['Seite 1']]);
  });

  it('tells where every piece of text stands, and how large the pages are', async () => {
    const layout = await extractLayout(await pdfWith([['Musterwort', 72, 700, 12]]));
    expect(layout.pages).toEqual([{ width: 595, height: 842 }]);
    expect(layout.pieces).toHaveLength(1);
    const [piece] = layout.pieces;
    expect(piece).toMatchObject({ page: 1, text: 'Musterwort', height: 12 });
    expect(piece!.x).toBeCloseTo(72, 0);
    expect(piece!.y).toBeCloseTo(700, 0);
    expect(piece!.width).toBeGreaterThan(40);
  });

  it('returns no text, blocks or pieces for a PDF without text', async () => {
    const doc = await PDFDocument.create();
    doc.addPage([595, 842]);
    expect(await extractLayout(await doc.save())).toEqual({ text: '', blocks: [], pieces: [], pages: [{ width: 595, height: 842 }] });
  });
});
