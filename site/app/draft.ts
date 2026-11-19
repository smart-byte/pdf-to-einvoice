// Paths into the draft, e.g. "seller.name" or "lines.0.unitPrice", and merging what was read into it.
import type { InvoiceDraft } from '../../src/domain/model.js';
import { state } from './state.js';

export const getPath = (object: any, path: string) => path.split('.').reduce((o, key) => o?.[key], object);
export function setPath(object: any, path: string, value: unknown): void {
  const keys = path.split('.');
  const last = keys.pop()!;
  const parent = keys.reduce((o, key, i) => (o[key] ??= /^\d+$/.test(keys[i + 1] ?? last) ? [] : {}), object);
  if (value === undefined || value === '') delete parent[last];
  else parent[last] = value;
}

export const isEmpty = (value: unknown) => value === undefined || value === null || value === '';
const hasContent = (lines: unknown) => Array.isArray(lines) && lines.some((line) => Object.values(line ?? {}).some((v) => !isEmpty(v)));

/**
 * Copies the values of `extra` into the draft, except where the user has already typed. With `onlyEmpty`, values
 * that are already there stay as well: what the patterns found is not replaced by what a model read. Returns what
 * was filled in: the paths of the fields, and one path per line item ("lines.2") where the lines were taken over.
 */
export function merge(extra: any, onlyEmpty = false, prefix = '', filled: string[] = []): string[] {
  for (const [key, value] of Object.entries(extra ?? {})) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (isEmpty(value)) continue;
    if (key === 'lines' && Array.isArray(value)) {
      const typed = [...state.touched].some((p) => p.startsWith('lines.'));
      if (!typed && !(onlyEmpty && hasContent(state.draft.lines)) && hasContent(value)) {
        state.draft.lines = value.map(normalise) as InvoiceDraft['lines'];
        filled.push(...value.map((_, i) => `lines.${i}`));
      }
    } else if (typeof value === 'object') merge(value, onlyEmpty, path, filled);
    else if (!state.touched.has(path) && !(onlyEmpty && !isEmpty(getPath(state.draft, path)))) {
      setPath(state.draft, path, NUMERIC.test(path) ? toNumber(value) : value);
      filled.push(path);
    }
  }
  return filled;
}

const NUMERIC = /(quantity|unitPrice|netAmount|vatRate|prepaidAmount|totals\.\w+)$/;
/** Models sometimes answer "1.499,00" although asked for a number. */
function toNumber(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  const digits = value.replace(/[^\d,.-]/g, '');
  const decimal = Math.max(digits.lastIndexOf(','), digits.lastIndexOf('.'));
  const number = Number(decimal < 0 ? digits : `${digits.slice(0, decimal).replace(/[,.]/g, '')}.${digits.slice(decimal + 1)}`);
  return Number.isFinite(number) && digits ? number : value;
}
const normalise = (line: any) => Object.fromEntries(Object.entries(line ?? {}).map(([k, v]) => [k, NUMERIC.test(k) ? toNumber(v) : v]));
/** Turns the number-like strings of a model answer into numbers, everywhere in the draft. */
export const normaliseDraft = (draft: any): InvoiceDraft => ({
  ...draft,
  lines: Array.isArray(draft?.lines) ? draft.lines.map(normalise) : undefined,
  totals: draft?.totals ? normalise(draft.totals) : undefined,
});
