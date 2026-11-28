import { amountSpellings, dateSpellings } from '../../src/domain/spellings.js';

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

/**
 * Finds where a value is printed: the rectangles of all its occurrences among the pieces of a page, from top to
 * bottom. Text is compared without regard to case and whitespace (an IBAN is printed in groups), a date
 * (`YYYY-MM-DD`) and a number in the ways they are commonly printed. A value may span adjacent pieces of a row, and
 * a text may wrap over rows; then each part gets its rectangle. A value that is not printed yields no rectangle.
 */
export function locate(pieces: Piece[], value: unknown, options: LocateOptions = {}): Rect[] {
  const { beside, widthOf = (text: string) => text.length } = options;
  const sought = soughtOf(value);
  if (!sought) return [];
  const { kind, spellings } = sought;
  const needles = [...new Set(spellings.map(fold))].filter(Boolean);
  const rows = rowsOf(pieces).filter(
    (row) =>
      !beside || beside.some((rect) => rect.y + rect.height / 2 > row.top && rect.y + rect.height / 2 < row.bottom),
  );
  const hits = rows.flatMap((row) => {
    const found = needles.flatMap((needle) => hitsIn(row, needle, kind, widthOf)).sort((a, b) => a.x - b.x);
    return beside ? besideOnly(row, found, beside) : found;
  });
  if (hits.length || kind !== 'text') return hits;
  const find = (needle: string) => rows.flatMap((row) => hitsIn(row, needle, 'text', widthOf));
  return wrapped(spellings[0]!.trim().split(/\s+/).map(fold), find).flat();
}

type Kind = 'number' | 'date' | 'text';

/** What is looked for: the kind of a value and the ways it is printed; none for a value that is not printed. */
function soughtOf(value: unknown): { kind: Kind; spellings: string[] } | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    const plain = String(Math.abs(value));
    return { kind: 'number', spellings: [...amountSpellings(value), plain, plain.replace('.', ',')] };
  }
  if (typeof value !== 'string') return undefined;
  if (/^\d{4}-(0[1-9]|1[0-2])-\d{2}$/.test(value)) return { kind: 'date', spellings: dateSpellings(value) };
  return { kind: 'text', spellings: [value] };
}

/** The hits of a row of `beside` that are not on these places themselves, those to their right where there are some. */
function besideOnly(row: Row, found: Rect[], beside: Rect[]): Rect[] {
  const others = found.filter(
    (hit) => !beside.some((rect) => bottom(rect) > row.top && rect.y < row.bottom && overlap(rect, hit)),
  );
  const right = others.filter((hit) =>
    beside.some((rect) => bottom(rect) > row.top && rect.y < row.bottom && hit.x >= rect.x + rect.width),
  );
  return right.length ? right : others;
}

interface Row {
  /** The text of the row from left to right, lower case and without whitespace. */
  text: string;
  /** For every character of `text`: its piece, its position there, and whether whitespace or the start of a piece comes before it. */
  chars: { piece: Piece; at: number; gap: boolean }[];
  top: number;
  bottom: number;
}

/** Pieces whose lower edges are close belong to one row, whatever the size of their letters. */
function rowsOf(pieces: Piece[]): Row[] {
  const rows: Piece[][] = [];
  for (const piece of pieces.filter((each) => each.text.trim()).sort((a, b) => bottom(a) - bottom(b))) {
    const row = rows.at(-1);
    if (row && inRowOf(row[0]!, piece)) row.push(piece);
    else rows.push([piece]);
  }
  return rows.map(rowOf);
}

/** Whether the lower edge of `piece` is within 0.4 of the smaller letters of that of `first`. */
function inRowOf(first: Piece, piece: Piece): boolean {
  return bottom(piece) - bottom(first) < 0.4 * Math.min(piece.height, first.height);
}

/** The pieces of one row, from left to right, as one text. */
function rowOf(row: Piece[]): Row {
  const chars: Row['chars'] = [];
  let text = '';
  for (const piece of row.sort((a, b) => a.x - b.x)) {
    for (const { letter, at, gap } of lettersOf(piece)) {
      text += letter;
      chars.push({ piece, at, gap });
    }
  }
  return { text, chars, top: Math.min(...row.map((piece) => piece.y)), bottom: Math.max(...row.map(bottom)) };
}

/**
 * The letters of a piece in lower case, each with its position in the piece and whether a gap comes before it: the
 * start of the piece, or whitespace other than that between the groups of digits of a number.
 */
function lettersOf(piece: Piece): { letter: string; at: number; gap: boolean }[] {
  const letters: { letter: string; at: number; gap: boolean }[] = [];
  let gap = true;
  for (let at = 0; at < piece.text.length; at++) {
    if (/\s/.test(piece.text[at]!)) {
      gap ||= !GROUPING.test(piece.text.slice(at - 1));
      continue;
    }
    for (const letter of piece.text[at]!.toLowerCase()) {
      letters.push({ letter, at, gap });
      gap = false;
    }
  }
  return letters;
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
      const edge = (at: number) =>
        piece.x + (piece.width * widthOf(piece.text.slice(0, at))) / (widthOf(piece.text) || 1);
      left = Math.min(left, edge(own[0]!.at));
      right = Math.max(right, edge(own.at(-1)!.at + 1));
      top = Math.min(top, piece.y);
      low = Math.max(low, bottom(piece));
    }
    hits.push({ x: left, y: top, width: right - left, height: low - top });
  }
  return hits;
}

/**
 * Whether characters `start` to `end` of a row are a value of their own and not a part of a longer one: "10" is not
 * found in "100,00", "3.11" not in "03.11.2026", "DE" not in "DE02 1203 …". A text may not continue as a word, a
 * number not as a number; what stands behind a space or in another piece does not continue anything.
 */
function standsAlone(row: Row, start: number, end: number, kind: Kind): boolean {
  if (kind === 'number' && row.chars.slice(start + 1, end).some((char) => char.gap)) return false;
  const part = kind === 'text' ? /[\p{L}\p{N}]/u : /\d/;
  const front: Edge = [row.text[start]!, charBefore(row, start - 1), charBefore(row, start - 2)];
  const back: Edge = [row.text[end - 1]!, charAfter(row, end), charAfter(row, end + 1)];
  return !continues(front, part) && !continues(back, part);
}

/** A character at one end of a value, the one next to it outside, and the one beyond that. */
type Edge = [end: string, next: string, beyond: string];

/** The character at `i` where nothing comes between it and the next one; none otherwise. */
function charBefore({ text, chars }: Row, i: number): string {
  return i >= 0 && !chars[i + 1]!.gap ? text[i]! : '';
}

/** The character at `i` where nothing comes between it and the one before; none otherwise. */
function charAfter({ text, chars }: Row, i: number): string {
  return i < text.length && !chars[i]!.gap ? text[i]! : '';
}

/** Whether a value goes on past one of its ends: a part as a part, or a digit past a separator as a number. */
function continues([end, next, beyond]: Edge, part: RegExp): boolean {
  if (part.test(end) && part.test(next)) return true;
  return /\d/.test(end) && SEPARATOR.test(next) && /\d/.test(beyond);
}

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

/** A part of a wrapped text continues the one above: a row further down, in the same column. */
function follows(above: Rect, below: Rect): boolean {
  return below.y > above.y + above.height / 2 && below.y < above.y + 2.5 * above.height && overlap(above, below);
}

function bottom(rect: Rect): number {
  return rect.y + rect.height;
}

function overlap(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width;
}

/** Lower case, letter by letter, so that a position in the result is a position in the original. */
function fold(text: string): string {
  return text.replace(/\s+/g, '').replace(/./gs, (letter) => letter.toLowerCase());
}

/**
 * The page to show for a value, counted from 0: the one already shown if the value stands there, otherwise the first
 * page that has it. `has` says whether a page has the value. A value that is printed nowhere names no page.
 */
export function pageToShow<Page>(pages: Page[], shown: number, has: (page: Page) => boolean): number | undefined {
  if (pages[shown] !== undefined && has(pages[shown])) return shown;
  const first = pages.findIndex(has);
  return first < 0 ? undefined : first;
}

/** The space that groups thousands, as in "1 783,81": it belongs to the number. */
const GROUPING = /^\d[  ]\d{3}(?!\d)/;
const SEPARATOR = /[.,']/;
