// The text of a page as rows of cells: one line per printed row, three spaces between its columns. pdf/text.ts writes
// a page this way and the reader in extract/guess/ takes it apart again. Neither may import the other, so what the two
// have to agree on stands here.

/** What stands between two columns of a row. */
export const COLUMN_GAP = '   ';

/** A row written from its cells. */
export const rowOf = (cells: string[]): string => cells.join(COLUMN_GAP);

/**
 * The cells of a row: a gap of `COLUMN_GAP` or wider parts two of them. A value that starts with a colon stays with
 * its label: "Nummer   : 77" is one cell.
 */
export const cells = (row: string): string[] => row.split(BETWEEN_CELLS).map((cell) => cell.trim());

/** A column gap, as a pattern for text that is not split into cells: `\s{3,}`. */
export const GAP = `\\s{${COLUMN_GAP.length},}`;

const BETWEEN_CELLS = new RegExp(`${GAP}(?!:)`);
