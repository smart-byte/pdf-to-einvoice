import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

interface Piece {
  x: number;
  y: number;
  width: number;
  text: string;
}

/** Pieces whose baselines are closer than this (in points) belong to one row. */
const ROW_TOLERANCE = 3;
/** A horizontal gap wider than this (in points) separates two columns; it is written as three spaces. */
const COLUMN_GAP = 12;

/** Joins the pieces of one row, left to right, keeping columns apart. */
function joinRow(row: Piece[]): string {
  row.sort((a, b) => a.x - b.x);
  return row.map((piece, i) => (i === 0 ? '' : piece.x - (row[i - 1]!.x + row[i - 1]!.width) > COLUMN_GAP ? '   ' : ' ') + piece.text).join('');
}

/**
 * Returns the text of a PDF as people read it: one line per printed row, the
 * pieces of a row from left to right with three spaces between columns, pages one after another. A scanned PDF
 * without a text layer yields an empty string.
 */
export async function extractText(pdf: Uint8Array): Promise<string> {
  // pdf.js takes ownership of the buffer it is given, so it gets a copy.
  const task = getDocument({ data: pdf.slice(), verbosity: 0, useSystemFonts: true });
  const doc = await task.promise;
  try {
    const lines: string[] = [];
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n);
      const content = await page.getTextContent();
      const pieces: Piece[] = [];
      for (const item of content.items) {
        if ('str' in item && item.str.trim()) pieces.push({ x: item.transform[4], y: item.transform[5], width: item.width, text: item.str.trim() });
      }
      pieces.sort((a, b) => b.y - a.y || a.x - b.x);
      let row: Piece[] = [];
      const flush = () => {
        if (row.length) lines.push(joinRow(row));
        row = [];
      };
      for (const piece of pieces) {
        if (row.length && Math.abs(row[0]!.y - piece.y) > ROW_TOLERANCE) flush();
        row.push(piece);
      }
      flush();
    }
    return lines.join('\n');
  } finally {
    await task.destroy();
  }
}
