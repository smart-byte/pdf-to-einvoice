// Paths into the draft, e.g. "seller.name" or "lines.0.unitPrice", and merging what was read into it.
import { invoiceJsonSchema, type InvoiceDraft } from '../../src/domain/model.js';
import { toNumber } from '../../src/domain/spellings.js';
import { valueAt } from '../../src/util/objects.js';

/** What merging needs of the page: the draft, and the fields the user has typed into. */
export interface Target {
  draft: InvoiceDraft;
  touched: Set<string>;
}

/**
 * Copies the values of `extra` into the draft, except where the user has already typed. With `onlyEmpty`, values
 * that are already there stay as well: what the patterns found is not replaced by what a model read. Returns what
 * was filled in: the paths of the fields, and one path per line item ("lines.2") where the lines were taken over.
 */
export function merge(target: Target, extra: object, { onlyEmpty = false } = {}): string[] {
  return copyInto({ target, onlyEmpty }, extra, '');
}

/** A merge under way: where it goes, and whether it fills empty fields only. */
interface Merging {
  target: Target;
  onlyEmpty: boolean;
}

/** Copies the values of an object of `extra`, found at `prefix`, into the draft. Returns the paths it filled in. */
function copyInto(merging: Merging, from: object, prefix: string): string[] {
  return Object.entries(from).flatMap(([key, value]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    if (isEmpty(value)) return [];
    if (key === 'lines' && Array.isArray(value)) return takeLines(merging, value);
    return typeof value === 'object' ? copyInto(merging, value, path) : takeValue(merging, path, value);
  });
}

/**
 * The line items are taken over as a whole, unless the user has typed into one, or there are some and only empty
 * fields are filled. Returns one path per line item taken over.
 */
function takeLines({ target, onlyEmpty }: Merging, lines: unknown[]): string[] {
  const typed = [...target.touched].some((path) => path.startsWith('lines.'));
  if (typed || (onlyEmpty && hasContent(target.draft.lines)) || !hasContent(lines)) return [];
  target.draft.lines = lines.map(normalise) as InvoiceDraft['lines'];
  return lines.map((_, i) => `lines.${i}`);
}

/**
 * A value is taken over unless the user has typed into its field, or the field holds one and only empty fields are
 * filled. Returns its path where it was.
 */
function takeValue({ target, onlyEmpty }: Merging, path: string, value: unknown): string[] {
  if (target.touched.has(path) || (onlyEmpty && !isEmpty(valueAt(target.draft, path)))) return [];
  setPath(target.draft, path, isNumberField(path) ? numberOf(value) : value);
  return [path];
}

/** Writes a value at a path, making the objects and lists on the way; an empty value removes the field. */
export function setPath(object: object, path: string, value: unknown): void {
  const keys = path.split('.');
  const last = keys.pop()!;
  const parent = keys.reduce<Tree>(
    (node, key, i) => (node[key] ??= /^\d+$/.test(keys[i + 1] ?? last) ? [] : {}) as Tree,
    object as Tree,
  );
  if (value === undefined || value === '') delete parent[last];
  else parent[last] = value;
}

/** An object or a list of the draft, by key or index. */
type Tree = Record<string, unknown>;

/** How many values a draft holds: every text and number in it, at any depth. */
export function countValues(draft: unknown): number {
  if (typeof draft === 'string' || typeof draft === 'number') return 1;
  if (!draft || typeof draft !== 'object') return 0;
  return Object.values(draft).reduce<number>((count, value) => count + countValues(value), 0);
}

export function isEmpty(value: unknown): boolean {
  return value === undefined || value === null || value === '';
}

function hasContent(lines: unknown): boolean {
  return Array.isArray(lines) && lines.some((line) => Object.values(line ?? {}).some((value) => !isEmpty(value)));
}

/** Turns the number-like strings of a model answer into numbers, everywhere in the draft. */
export function normaliseDraft(draft: any): InvoiceDraft {
  return {
    ...draft,
    lines: Array.isArray(draft?.lines) ? draft.lines.map(normalise) : undefined,
    totals: draft?.totals ? normalise(draft.totals) : undefined,
  };
}

function normalise(line: unknown) {
  return Object.fromEntries(
    Object.entries(line ?? {}).map(([key, value]) => [key, isNumberField(key) ? numberOf(value) : value]),
  );
}

/**
 * A number for a string that prints one, read as the reader reads the page: "1.499,00" is 1499, and so is "1.000"
 * (three digits behind the only separator are thousands). Models sometimes answer like this although asked for a
 * number. Anything else stays as it is.
 */
function numberOf(value: unknown): unknown {
  if (typeof value !== 'string' || !/\d/.test(value)) return value;
  const number = toNumber(value);
  return Number.isFinite(number) ? number : value;
}

/** Whether the field at a path, or of that name, holds a number. */
function isNumberField(path: string): boolean {
  return NUMBER_FIELDS.has(path.split('.').at(-1)!);
}

/** A part of the JSON Schema, as far as it is walked here. */
interface SchemaPart {
  type?: unknown;
  properties?: Record<string, SchemaPart>;
  items?: SchemaPart;
}
/** The names of the fields the schema of the invoice holds as numbers, at any depth: quantity, unitPrice, net, ... */
const NUMBER_FIELDS = new Set<string>();
(function collect(part: SchemaPart, name?: string) {
  if (part.type === 'number' && name) NUMBER_FIELDS.add(name);
  for (const [key, value] of Object.entries(part.properties ?? {})) collect(value, key);
  if (part.items) collect(part.items, name);
})(invoiceJsonSchema);
