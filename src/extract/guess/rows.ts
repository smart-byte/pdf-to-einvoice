// What the reader knows of the rows of a page. How a row splits into cells, util/rows.ts says.

/** A line with a label and its value, such as "Kundennummer: 77" or "GLN 4012345000009". */
export const KEY_VALUE = /\S\s*:\s*\S|^\p{L}[\p{L}.-]*\s+\d[\d ]{7,}$/u;
/** How many rows a text may wrap into: a description, a name, a note. */
export const MAX_WRAPPED = 4;
