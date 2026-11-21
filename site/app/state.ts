// What the page knows about the invoice it works on. Every module may read it; only the functions of this module
// change it, so each change has a name and one place.
import type { CheckResult } from '../../src/domain/check.js';
import type { Finding } from '../../src/domain/finding.js';
import type { InvoiceDraft } from '../../src/domain/model.js';
import { merge, setPath } from './draft.js';

export type Format = 'pdf' | 'xrechnung';
export type Mode = 'create' | 'validate';
/**
 * Why nobody has looked at a value yet: a suggestion that is not on the PDF, a VAT category inferred from the buyer's
 * country, or what a language model read.
 */
export type Unchecked = 'suggested' | 'inferred' | 'model';
/** The lists of the draft the form adds items to and removes them from. */
export type List = 'lines' | 'discounts' | 'charges';

interface State {
  pdf?: Uint8Array;
  fileName: string;
  pdfText: string;
  draft: InvoiceDraft;
  /** Fields the user has typed into; reading the PDF again never overwrites them. */
  touched: Set<string>;
  /** What the check found: of the form, each time it changes; of an existing e-invoice, once, when it was opened. */
  result?: CheckResult;
  /** Findings about the file itself, e.g. fonts that are not embedded. */
  fileFindings: Finding[];
  /** `validate` shows what an existing e-invoice says; nothing can be edited or created then. */
  mode: Mode;
  /** What "Create" makes: the hybrid PDF, or an XRechnung for a public body. It stays when another PDF is opened. */
  format: Format;
  /**
   * Values nobody has looked at yet, by the path of their field or of a whole line item ("lines.2"). Each stays until
   * the user changes the value or says it is right.
   */
  toCheck: Map<string, Unchecked>;
}

/** The state as the other modules get it: to read. */
type View = Readonly<Omit<State, 'touched' | 'toCheck'>> & {
  readonly touched: ReadonlySet<string>;
  readonly toCheck: ReadonlyMap<string, Unchecked>;
};

const own: State = {
  fileName: '',
  pdfText: '',
  draft: blank(),
  touched: new Set(),
  fileFindings: [],
  mode: 'create',
  format: 'pdf',
  toCheck: new Map(),
};
export const state: View = own;

/** The format the form is shown and checked for. An existing e-invoice is looked at as it is. */
export const shownFormat = (): Format => (own.mode === 'validate' ? 'pdf' : own.format);

/** Another file was opened: everything about the one before is forgotten. The chosen format stays. */
export function startOver(file: { pdf: Uint8Array; fileName: string; pdfText: string; mode: Mode }): void {
  Object.assign(own, {
    ...file,
    draft: blank(),
    touched: new Set(),
    fileFindings: [],
    toCheck: new Map(),
    result: undefined,
  });
}

/** An existing e-invoice: the data of its XML where it could be read, what was found about the file, and the verdict. */
export function setExisting(read: { draft?: InvoiceDraft; fileFindings: Finding[]; result: CheckResult }): void {
  Object.assign(own, { draft: read.draft ?? blank(), fileFindings: read.fileFindings, result: read.result });
}

/**
 * Fills in what was read from the PDF, except where the user has typed (see `merge`). With `why`, each value that was
 * filled in is still to be checked. Returns their paths.
 */
export function fill(
  read: object,
  { onlyEmpty = false, why }: { onlyEmpty?: boolean; why?: Unchecked } = {},
): string[] {
  const filled = merge(own, read, { onlyEmpty });
  if (why) for (const path of filled) own.toCheck.set(path, why);
  return filled;
}

/** A value nobody has looked at yet. */
export function mark(path: string, why: Unchecked): void {
  own.toCheck.set(path, why);
}

/** A value the PDF does not state, put into its field as a suggestion the user has to confirm. */
export function suggest(path: string, value: unknown): void {
  setPath(own.draft, path, value);
  mark(path, 'suggested');
}

/** The user says a value is right. */
export function confirm(path: string): void {
  own.toCheck.delete(path);
}

/** The user typed into a field. Whoever changes a value has looked at it, and at the line item it is a cell of. */
export function enter(path: string, value: unknown): void {
  setPath(own.draft, path, value);
  own.touched.add(path);
  own.toCheck.delete(path);
  own.toCheck.delete(path.replace(/^(lines\.\d+)\..*$/, '$1'));
}

/** One more empty item at the end of a list. Returns its index. */
export function addItem(list: List): number {
  const items: object[] = (own.draft[list] ??= []);
  own.touched.add(`${list}.added`);
  return items.push({}) - 1;
}

/**
 * Item `i` of a list is gone: the items below move up by one, and what was typed or is still to be checked moves with
 * them. The line items stay a list when the last one goes; discounts and charges are left out with theirs.
 */
export function removeItem(list: List, i: number): void {
  const items: object[] = own.draft[list] ?? [];
  items.splice(i, 1);
  if (list !== 'lines' && !items.length) delete own.draft[list];
  const moved = (path: string): string[] => {
    const at = new RegExp(`^${list}\\.(\\d+)(.*)$`).exec(path);
    if (!at || Number(at[1]) < i) return [path];
    return Number(at[1]) === i ? [] : [`${list}.${Number(at[1]) - 1}${at[2]}`];
  };
  own.toCheck = new Map(
    [...own.toCheck].flatMap(([path, why]) => moved(path).map((to): [string, Unchecked] => [to, why])),
  );
  own.touched = new Set([...own.touched].flatMap(moved));
  own.touched.add(`${list}.removed`);
}

export function chooseFormat(format: Format): void {
  own.format = format;
}

/** What the check found about the form as it is now. */
export function setResult(result: CheckResult): void {
  own.result = result;
}

/** A draft with nothing in it. The form always shows a line item to fill in, so there is an empty one. */
function blank(): InvoiceDraft {
  return { lines: [{}] };
}
