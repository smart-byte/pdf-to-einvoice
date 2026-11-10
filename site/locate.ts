import { amountSpellings, dateSpellings } from '../src/check.js';

/** A rectangle on the page. `y` is its upper edge; the unit is up to the caller, as long as all pieces share it. */
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** A run of text as the PDF holds it, with the rectangle it is printed in. */
export interface Piece extends Rect {
  text: string;
}

export interface LocateOptions {
  /**
   * Looks only in the rows of these places, and there to their right before their left. Made for the numbers of a
   * line item: next to its name stands its quantity, in front of it often just the position number.
   */
  beside?: Rect[];
  /** Measures a text, so that a value inside a longer piece is placed by the widths of its letters. Without it every letter counts the same. */
  widthOf?: (text: string) => number;
}

interface Row {
  /** The text of the row from left to right, lower case and without whitespace. */
  text: string;
  /** For every character of `text`: its piece, its position there, and whether whitespace or the start of a piece comes before it. */
  chars: { piece: Piece; at: number; gap: boolean }[];
  top: number;
  bottom: number;
}

const bottom = (rect: Rect) => rect.y + rect.height;
const overlap = (a: Rect, b: Rect) => a.x < b.x + b.width && b.x < a.x + a.width;
/** Lower case, letter by letter, so that a position in the result is a position in the original. */
const fold = (text: string) => text.replace(/\s+/g, '').replace(/./gs, (letter) => letter.toLowerCase());
/** The space that groups thousands, as in "1 783,81": it belongs to the number. */
const GROUPING = /^\d[  ]\d{3}(?!\d)/;

/** Pieces whose lower edges are close belong to one row, whatever the size of their letters. */
function rowsOf(pieces: Piece[]): Row[] {
  const rows: Piece[][] = [];
  for (const piece of pieces.filter((p) => p.text.trim()).sort((a, b) => bottom(a) - bottom(b))) {
    const row = rows.at(-1);
    if (row && bottom(piece) - bottom(row[0]!) < 0.4 * Math.min(piece.height, row[0]!.height)) row.push(piece);
    else rows.push([piece]);
  }
  return rows.map((row) => {
    const chars: Row['chars'] = [];
    let text = '';
    for (const piece of row.sort((a, b) => a.x - b.x)) {
      let gap = true;
      for (let at = 0; at < piece.text.length; at++) {
        if (/\s/.test(piece.text[at]!)) {
          gap ||= !GROUPING.test(piece.text.slice(at - 1));
          continue;
        }
        for (const letter of piece.text[at]!.toLowerCase()) {
          text += letter;
          chars.push({ piece, at, gap });
          gap = false;
        }
      }
    }
    return { text, chars, top: Math.min(...row.map((p) => p.y)), bottom: Math.max(...row.map(bottom)) };
  });
}

type Kind = 'number' | 'date' | 'text';
const SEPARATOR = /[.,']/;

/**
 * Whether characters `start` to `end` of a row are a value of their own and not a part of a longer one: "10" is not
 * found in "100,00", "3.11" not in "03.11.2026", "DE" not in "DE02 1203 …". A text may not continue as a word, a
 * number not as a number; what stands behind a space or in another piece does not continue anything.
 */
function standsAlone({ text, chars }: Row, start: number, end: number, kind: Kind): boolean {
  const part = kind === 'text' ? /[\p{L}\p{N}]/u : /\d/;
  const before = (i: number) => (i >= 0 && !chars[i + 1]!.gap ? text[i]! : '');
  const after = (i: number) => (i < text.length && !chars[i]!.gap ? text[i]! : '');
  const [first, last] = [text[start]!, text[end - 1]!];
  if (kind === 'number' && chars.slice(start + 1, end).some((char) => char.gap)) return false;
  if (part.test(first) && part.test(before(start - 1))) return false;
  if (part.test(last) && part.test(after(end))) return false;
  if (/\d/.test(first) && SEPARATOR.test(before(start - 1)) && /\d/.test(before(start - 2))) return false;
  if (/\d/.test(last) && SEPARATOR.test(after(end)) && /\d/.test(after(end + 1))) return false;
  return true;
}

/** Every place in a row where `needle` stands: one rectangle around the parts of the pieces it covers. */
function hitsIn(row: Row, needle: string, kind: Kind, widthOf: (text: string) => number): Rect[] {
  const hits: Rect[] = [];
  for (let start = row.text.indexOf(needle); start >= 0; start = row.text.indexOf(needle, start + 1)) {
    if (!standsAlone(row, start, start + needle.length, kind)) continue;
    const covered = row.chars.slice(start, start + needle.length);
    let [left, top, right, low] = [Infinity, Infinity, -Infinity, -Infinity];
    for (const piece of new Set(covered.map((char) => char.piece))) {
      const own = covered.filter((char) => char.piece === piece);
      const edge = (at: number) => piece.x + (piece.width * widthOf(piece.text.slice(0, at))) / (widthOf(piece.text) || 1);
      left = Math.min(left, edge(own[0]!.at));
      right = Math.max(right, edge(own.at(-1)!.at + 1));
      top = Math.min(top, piece.y);
      low = Math.max(low, bottom(piece));
    }
    hits.push({ x: left, y: top, width: right - left, height: low - top });
  }
  return hits;
}

/** A part of a wrapped text continues the one above: a row further down, in the same column. */
const follows = (above: Rect, below: Rect) => below.y > above.y + above.height / 2 && below.y < above.y + 2.5 * above.height && overlap(above, below);

/**
 * The places of a text that wraps over rows: the longest run of its first words, then the rest below it, and so on.
 * Only a text that is there to its last word has a place, so half a name is not marked.
 */
function wrapped(words: string[], find: (needle: string) => Rect[], above?: Rect): Rect[][] {
  for (let n = above ? words.length : words.length - 1; n > 0; n--) {
    const found = find(words.slice(0, n).join(''))
      .filter((hit) => !above || follows(above, hit))
      .flatMap((hit) =>
        n === words.length
          ? [[hit]]
          : wrapped(words.slice(n), find, hit)
              .slice(0, 1)
              .map((rest) => [hit, ...rest]),
      );
    if (found.length) return found;
  }
  return [];
}

/**
 * Finds where a value is printed: the rectangles of all its occurrences among the pieces of a page, from top to
 * bottom. Text is compared without regard to case and whitespace (an IBAN is printed in groups), a date
 * (`YYYY-MM-DD`) and a number in the ways they are commonly printed. A value may span adjacent pieces of a row, and
 * a text may wrap over rows; then each part gets its rectangle. A value that is not printed yields no rectangle.
 */
export function locate(pieces: Piece[], value: unknown, options: LocateOptions = {}): Rect[] {
  const { beside, widthOf = (text: string) => text.length } = options;
  let kind: Kind;
  let spellings: string[];
  if (typeof value === 'number' && Number.isFinite(value)) {
    const plain = String(Math.abs(value));
    [kind, spellings] = ['number', [...amountSpellings(value), plain, plain.replace('.', ',')]];
  } else if (typeof value !== 'string') return [];
  else if (/^\d{4}-(0[1-9]|1[0-2])-\d{2}$/.test(value)) [kind, spellings] = ['date', dateSpellings(value)];
  else [kind, spellings] = ['text', [value]];
  const needles = [...new Set(spellings.map(fold))].filter(Boolean);

  const rows = rowsOf(pieces).filter((row) => !beside || beside.some((rect) => rect.y + rect.height / 2 > row.top && rect.y + rect.height / 2 < row.bottom));
  const hits = rows.flatMap((row) => {
    const found = needles.flatMap((needle) => hitsIn(row, needle, kind, widthOf)).sort((a, b) => a.x - b.x);
    if (!beside) return found;
    const others = found.filter((hit) => !beside.some((rect) => bottom(rect) > row.top && rect.y < row.bottom && overlap(rect, hit)));
    const right = others.filter((hit) => beside.some((rect) => bottom(rect) > row.top && rect.y < row.bottom && hit.x >= rect.x + rect.width));
    return right.length ? right : others;
  });
  if (hits.length || kind !== 'text') return hits;
  const find = (needle: string) => rows.flatMap((row) => hitsIn(row, needle, 'text', widthOf));
  return wrapped(spellings[0]!.trim().split(/\s+/).map(fold), find).flat();
}
