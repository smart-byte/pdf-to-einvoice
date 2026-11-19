// The rows of the text of a page and their cells. extractLayout() writes three spaces between columns, so a row splits
// into cells.

/** A value that starts with a colon stays with its label: "Nummer   : 77" is one cell. */
export const cells = (row: string) => row.split(/\s{3,}(?!:)/).map((cell) => cell.trim());
/** A line with a label and its value, such as "Kundennummer: 77" or "GLN 4012345000009". */
export const KEY_VALUE = /\S\s*:\s*\S|^\p{L}[\p{L}.-]*\s+\d[\d ]{7,}$/u;
/** How many rows a text may wrap into: a description, a name, a note. */
export const MAX_WRAPPED = 4;
