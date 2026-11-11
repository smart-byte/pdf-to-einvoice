import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

/** One piece of text as the PDF places it: in points, with the origin at the bottom left of its page. */
export interface Piece {
  /** Page number, starting at 1. */
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
  text: string;
}

export interface Layout {
  /** The text as people read it: one line per printed row, three spaces between columns, pages one after another. */
  text: string;
  /**
   * The same text by column: lines that stand below each other at one left edge, such as an address. Unlike a row,
   * a block does not mix with the column beside it.
   */
  blocks: string[][];
  /** Every piece of text with its place on the page, e.g. to show where a value was read. */
  pieces: Piece[];
  /** The size of each page in points. */
  pages: { width: number; height: number }[];
}

/** Pieces whose baselines are closer than this (in points) belong to one row. */
const ROW_TOLERANCE = 3;
/** A horizontal gap wider than this (in points) separates two columns; it is written as three spaces. */
const COLUMN_GAP = 12;
/** Pieces closer than this share of their height touch: a PDF may split a word into pieces, which then join without a space. */
const WORD_GAP = 0.1;
/** Lines of one block start at the same left edge, give or take this many points. */
const EDGE_TOLERANCE = 2;
/** Lines of one block are at most this many line heights apart; an address may be set with double spacing. */
const LINE_GAP = 2.5;

/** A piece with its text as the PDF holds it: the spaces it starts or ends with tell words apart. */
interface Raw {
  piece: Piece;
  str: string;
}

/** A run of pieces in one row without a column gap between them. */
interface Cell {
  x: number;
  y: number;
  height: number;
  text: string;
}

/** Splits the pieces of one row, left to right, into cells at the column gaps. */
function cellsOf(row: Raw[]): Cell[] {
  row.sort((a, b) => a.piece.x - b.piece.x);
  const cells: Cell[] = [];
  let before: Raw | undefined;
  for (const raw of row) {
    const { piece } = raw;
    const gap = before ? piece.x - (before.piece.x + before.piece.width) : Infinity;
    const cell = cells.at(-1);
    // A value set apart behind its colon ("Nummer    : 77") stays in the cell of its label.
    if (!before || !cell || (gap > COLUMN_GAP && !piece.text.startsWith(':'))) cells.push({ x: piece.x, y: piece.y, height: piece.height, text: piece.text });
    else {
      const spaced = gap > WORD_GAP * before.piece.height || /\s$/.test(before.str) || /^\s/.test(raw.str);
      cell.text += (spaced ? ' ' : '') + piece.text;
      cell.height = Math.max(cell.height, piece.height);
    }
    before = raw;
  }
  return cells;
}

/** Groups cells, given from the top of the page down, into blocks: each cell joins the block that ends right above it at its left edge. */
function blocksOf(cells: Cell[]): string[][] {
  const blocks: Cell[][] = [];
  for (const cell of cells) {
    const block = blocks.find((candidate) => {
      const last = candidate.at(-1)!;
      const below = last.y - cell.y;
      return Math.abs(last.x - cell.x) <= EDGE_TOLERANCE && below > 0 && below <= LINE_GAP * Math.max(last.height, cell.height);
    });
    if (block) block.push(cell);
    else blocks.push([cell]);
  }
  return blocks.map((block) => block.map((cell) => cell.text));
}

/**
 * Reads the text of a PDF with its layout: row by row, block by block and piece by piece. A scanned PDF without a
 * text layer yields empty text and no pieces.
 */
export async function extractLayout(pdf: Uint8Array): Promise<Layout> {
  // pdf.js takes ownership of the bytes it is given, so it gets a copy: a plain Uint8Array, which is what it accepts,
  // also when the caller passed a Node Buffer (whose slice() would be a Buffer on the same memory).
  const task = getDocument({ data: new Uint8Array(pdf), verbosity: 0, useSystemFonts: true });
  const doc = await task.promise;
  try {
    const layout: Layout = { text: '', blocks: [], pieces: [], pages: [] };
    const lines: string[] = [];
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n);
      const { width, height } = page.getViewport({ scale: 1 });
      layout.pages.push({ width, height });
      const content = await page.getTextContent();
      const pieces: Raw[] = [];
      for (const item of content.items) {
        if (!('str' in item) || !item.str.trim()) continue;
        const piece = { page: n, x: item.transform[4], y: item.transform[5], width: item.width, height: item.height, text: item.str.trim() };
        pieces.push({ piece, str: item.str });
        layout.pieces.push(piece);
      }
      pieces.sort((a, b) => b.piece.y - a.piece.y || a.piece.x - b.piece.x);
      const cells: Cell[] = [];
      let row: Raw[] = [];
      const flush = () => {
        const rowCells = cellsOf(row);
        if (rowCells.length) lines.push(rowCells.map((cell) => cell.text).join('   '));
        cells.push(...rowCells);
        row = [];
      };
      for (const raw of pieces) {
        if (row.length && Math.abs(row[0]!.piece.y - raw.piece.y) > ROW_TOLERANCE) flush();
        row.push(raw);
      }
      flush();
      layout.blocks.push(...blocksOf(cells));
    }
    layout.text = lines.join('\n');
    return layout;
  } finally {
    await task.destroy();
  }
}

/**
 * Returns the text of a PDF as people read it: one line per printed row, the
 * pieces of a row from left to right with three spaces between columns, pages one after another. A scanned PDF
 * without a text layer yields an empty string.
 */
export async function extractText(pdf: Uint8Array): Promise<string> {
  return (await extractLayout(pdf)).text;
}
