// Whether the text of a page shows a value. One place for both comparisons with the page: `check` warns about what
// the data states and the page does not show, `keepWhatThePdfShows` drops what a language model returned and the page
// does not show. Both ask the same of a value: a number counts only where it stands on its own, not as a part of a
// longer one, and a text only where each of its words stands as a whole word.
import { escapeRegExp } from '../util/regexp.js';
import { amountSpellings } from './spellings.js';

/** The text of a page, prepared once in the forms a value is looked for in. */
export interface PageText {
  text: string;
  lower: string;
  /** Lower case, without any whitespace. */
  compact: string;
  /** Every word in lower case, as printed and without the punctuation at its edges. */
  words: Set<string>;
  /** Digits grouped by a space joined, also by one that does not break: "1 190,00" is "1190,00". */
  ungrouped: string;
  /** The digits alone. */
  digits: string;
}

export function pageTextOf(text: string): PageText {
  const lower = text.toLowerCase();
  return {
    text,
    lower,
    compact: lower.replace(/\s+/g, ''),
    words: new Set(lower.split(/[\s,;·|]+/).flatMap((word) => [word, word.replace(EDGE, '')])),
    ungrouped: text.replace(/(\d)[ \u00a0\u202f](?=\d{3}\b)/g, '$1'),
    digits: lower.replace(/\D/g, ''),
  };
}

/**
 * Whether one of the spellings stands on the page, whitespace and case aside: an identifier, which may be printed in
 * groups as an IBAN is, or a date in the ways it is written.
 */
export function showsSpelling(page: PageText, spellings: string[]): boolean {
  return spellings.some((spelling) => page.compact.includes(spelling.replace(/\s+/g, '').toLowerCase()));
}

/**
 * Whether every word of a text stands on the page as a whole word, in any order: a name may wrap, and in a table its
 * rows mix with other columns. "Example" is not shown by a page that merely has "info@shop.example".
 */
export function showsWords(page: PageText, text: string): boolean {
  return text
    .split(/[\s,;]+/)
    .every((word) => page.words.has(word.toLowerCase()) || page.words.has(word.toLowerCase().replace(EDGE, '')));
}

/**
 * Whether an amount stands on the page on its own, in one of the ways it is printed: "49" is not shown by "249,50",
 * "3.11" not by the date "03.11.2026".
 */
export function showsAmount(page: PageText, amount: number): boolean {
  return amountSpellings(amount).some((spelling) =>
    new RegExp(`${NO_NUMBER_BEFORE}${escapeRegExp(spelling)}(?![.,]?\\d)`).test(page.ungrouped),
  );
}

/** Whether a bare number, such as a quantity, stands on the page on its own. "24.000" shows 24000. */
export function showsCount(page: PageText, count: number): boolean {
  const plain = withEitherPoint(count);
  const grouped = Number.isInteger(count) ? String(count).replace(/\B(?=(\d{3})+(?!\d))/g, "[.,' ]") : plain;
  return new RegExp(`${NO_NUMBER_BEFORE}(?:${plain}|${grouped})(?![\\d]|[.,]\\d)`).test(page.text);
}

/**
 * Whether a percentage stands on the page on its own, before its sign: "10 %", "10,00 %" and "7,50 %" for 7.5, but
 * not the "10 %" in "110 %".
 */
export function showsPercent(page: PageText, percent: number): boolean {
  const zeros = Number.isInteger(percent) ? '(?:[.,]0+)?' : '0*';
  return new RegExp(`${NO_NUMBER_BEFORE}${withEitherPoint(percent)}${zeros}\\s?%`).test(page.text);
}

/** A number as a pattern that takes a comma for its decimal point as well. */
function withEitherPoint(number: number): string {
  return escapeRegExp(String(number)).replace('\\.', '[.,]');
}

/** What stands before a number that stands on its own: no digit, and no separator of a longer number. */
const NO_NUMBER_BEFORE = '(?<![\\d.,])';

// Whole words only, so the punctuation at the edges of a word is not part of it.
const EDGE = /^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu;
