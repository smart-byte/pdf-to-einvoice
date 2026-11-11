import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import pdfWorkerUrl from 'pdfjs-dist/legacy/build/pdf.worker.mjs?url';
import sampleUrl from '../examples/sample-invoice.pdf?url';
import { check, type CheckResult, type Finding } from '../src/check.js';
import { keepWhatThePdfShows } from '../src/ground.js';
import { guessFromText, languageOf } from '../src/guess.js';
import { INVOICE_TYPES, VAT_CATEGORIES, type InvoiceDraft } from '../src/model.js';
import { inspectPdf } from '../src/pdf.js';
import { extractLayout } from '../src/text.js';
import { lang, setLang, STRINGS, t } from './i18n.js';
import { DEFAULT_MODEL, MODELS, hasWebGpu, readWithBrowserModel, readWithEndpoint } from './llm.js';
import { locate, pageToShow, type Piece, type Rect } from './locate.js';
import './styles.css';
import './theme-switch.js';

pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

const $ = <T extends HTMLElement>(selector: string) => document.querySelector<T>(selector)!;
/** Creates an element. `props` are assigned as properties; `dataset` entries become data attributes. */
function el<K extends keyof HTMLElementTagNameMap>(tag: K, props: Record<string, unknown> = {}, ...children: (Node | string)[]): HTMLElementTagNameMap[K] {
  const { dataset, ...rest } = props;
  const node = Object.assign(document.createElement(tag), rest);
  Object.assign(node.dataset, dataset);
  node.append(...children);
  return node;
}

interface State {
  pdf?: Uint8Array;
  fileName: string;
  pdfText: string;
  draft: InvoiceDraft;
  /** Fields the user has typed into; reading the PDF again never overwrites them. */
  touched: Set<string>;
  result?: CheckResult;
  /** Findings about the file itself, e.g. fonts that are not embedded. */
  fileFindings: Finding[];
  /** `validate` shows what an existing e-invoice says; nothing can be edited or created then. */
  mode: 'create' | 'validate';
  /** What "Create" makes: the hybrid PDF, or an XRechnung for a public body. It stays when another PDF is opened. */
  format: Format;
  /**
   * Values nobody has looked at yet, by the path of their field or of a whole line item ("lines.2"): a suggestion that
   * is not on the PDF, a VAT category inferred from the buyer's country, or what a language model read. Each stays
   * until the user changes the value or says it is right.
   */
  toCheck: Map<string, 'suggested' | 'inferred' | 'model'>;
}
type Format = 'pdf' | 'xrechnung';
const state: State = { fileName: '', pdfText: '', draft: {}, touched: new Set(), fileFindings: [], mode: 'create', format: 'pdf', toCheck: new Map() };
/** The format the form is shown and checked for. An existing e-invoice is looked at as it is. */
const shownFormat = (): Format => (state.mode === 'validate' ? 'pdf' : state.format);

// ---------------------------------------------------------------------------------------------------------------
// Paths into the draft, e.g. "seller.name" or "lines.0.unitPrice"

const getPath = (object: any, path: string) => path.split('.').reduce((o, key) => o?.[key], object);
function setPath(object: any, path: string, value: unknown): void {
  const keys = path.split('.');
  const last = keys.pop()!;
  const parent = keys.reduce((o, key, i) => (o[key] ??= /^\d+$/.test(keys[i + 1] ?? last) ? [] : {}), object);
  if (value === undefined || value === '') delete parent[last];
  else parent[last] = value;
}

const isEmpty = (value: unknown) => value === undefined || value === null || value === '';
const hasContent = (lines: unknown) => Array.isArray(lines) && lines.some((line) => Object.values(line ?? {}).some((v) => !isEmpty(v)));

/**
 * Copies the values of `extra` into the draft, except where the user has already typed. With `onlyEmpty`, values
 * that are already there stay as well: what the patterns found is not replaced by what a model read. Returns what
 * was filled in: the paths of the fields, and one path per line item ("lines.2") where the lines were taken over.
 */
function merge(extra: any, onlyEmpty = false, prefix = '', filled: string[] = []): string[] {
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
const normaliseDraft = (draft: any): InvoiceDraft => ({
  ...draft,
  lines: Array.isArray(draft?.lines) ? draft.lines.map(normalise) : undefined,
  totals: draft?.totals ? normalise(draft.totals) : undefined,
});

// ---------------------------------------------------------------------------------------------------------------
// The form

type FieldType = 'text' | 'date' | 'number' | 'select' | 'email' | 'tel';
interface Field {
  path: string;
  label: string;
  type?: FieldType;
  options?: [value: string, label: string][];
  wide?: boolean;
  /** A line under the field that says what goes in it. */
  help?: string;
  /** Shown for this format only. */
  only?: Format;
}

// XRechnung asks for the buyer reference up front, beside the buyer; for the hybrid PDF it is one of the further fields.
const BUYER_REFERENCE: Field = { path: 'buyerReference', label: 'f.buyerReference', help: 'f.buyerReference.help' };

const party = (who: 'seller' | 'buyer'): Field[] => [
  { path: `${who}.name`, label: 'f.name', wide: true },
  { path: `${who}.street`, label: 'f.street', wide: true },
  { path: `${who}.postalCode`, label: 'f.postalCode' },
  { path: `${who}.city`, label: 'f.city' },
  { path: `${who}.country`, label: 'f.country' },
  { path: `${who}.vatId`, label: 'f.vatId' },
  ...(who === 'seller'
    ? ([
        { path: 'seller.taxNumber', label: 'f.taxNumber' },
        { path: 'seller.email', label: 'f.email', type: 'email' },
        { path: 'seller.contactName', label: 'f.contactName', only: 'xrechnung' },
        { path: 'seller.phone', label: 'f.phone', type: 'tel', only: 'xrechnung' },
      ] satisfies Field[])
    : ([
        { path: 'buyer.email', label: 'f.email', type: 'email', only: 'xrechnung' },
        { ...BUYER_REFERENCE, only: 'xrechnung' },
      ] satisfies Field[])),
];

const SECTIONS: { title: string; fields: Field[]; collapsed?: boolean }[] = [
  {
    title: 's.invoice',
    fields: [
      { path: 'number', label: 'f.number' },
      { path: 'issueDate', label: 'f.issueDate', type: 'date' },
      { path: 'deliveryDate', label: 'f.deliveryDate', type: 'date' },
      { path: 'currency', label: 'f.currency' },
      { path: 'periodStart', label: 'f.periodStart', type: 'date' },
      { path: 'periodEnd', label: 'f.periodEnd', type: 'date' },
    ],
  },
  { title: 's.seller', fields: party('seller') },
  { title: 's.buyer', fields: party('buyer') },
  {
    title: 's.payment',
    fields: [
      { path: 'dueDate', label: 'f.dueDate', type: 'date' },
      { path: 'paymentTerms', label: 'f.paymentTerms', wide: true },
      { path: 'iban', label: 'f.iban' },
      { path: 'bic', label: 'f.bic' },
      { path: 'vatExemptionReason', label: 'f.vatExemptionReason', wide: true },
    ],
  },
  {
    title: 's.more',
    collapsed: true,
    fields: [
      { path: 'typeCode', label: 'f.typeCode', type: 'select', options: Object.keys(INVOICE_TYPES).map((code) => [code, `type.${code}`]) },
      { path: 'precedingInvoiceNumber', label: 'f.precedingInvoiceNumber' },
      { path: 'precedingInvoiceDate', label: 'f.precedingInvoiceDate', type: 'date' },
      { path: 'orderReference', label: 'f.orderReference' },
      { ...BUYER_REFERENCE, only: 'pdf' },
      { path: 'prepaidAmount', label: 'f.prepaidAmount', type: 'number' },
      { path: 'note', label: 'f.note', wide: true },
    ],
  },
];

const LINE_FIELDS: Field[] = [
  { path: 'name', label: 'l.name', wide: true },
  { path: 'quantity', label: 'l.quantity', type: 'number' },
  { path: 'unit', label: 'l.unit', type: 'select', options: ['C62', 'HUR', 'DAY', 'MON', 'KGM', 'MTR', 'LTR', 'LS'].map((code) => [code, `unit.${code}`]) },
  { path: 'unitPrice', label: 'l.unitPrice', type: 'number' },
  { path: 'vatCategory', label: 'l.vatCategory', type: 'select', options: Object.keys(VAT_CATEGORIES).map((code) => [code, `vat.${code}`]) },
  { path: 'vatRate', label: 'l.vatRate', type: 'number' },
];

const SELECT_DEFAULTS: Record<string, string> = { typeCode: '380', unit: 'C62', vatCategory: 'S' };

function control(field: Field, path: string): HTMLElement {
  // An empty choice shows what will be used, not whichever option happens to come first.
  const value = getPath(state.draft, path) ?? SELECT_DEFAULTS[field.path] ?? '';
  const id = `in-${path.replace(/\./g, '-')}`;
  let input: HTMLInputElement | HTMLSelectElement;
  if (field.type === 'select') {
    input = el('select', { id });
    for (const [code, label] of field.options!) input.append(el('option', { value: code, selected: String(value) === code }, t(label)));
  } else {
    input = el('input', { id, type: field.type ?? 'text', value: String(value), autocomplete: 'off' });
    if (field.type === 'number') (input as HTMLInputElement).step = 'any';
  }
  input.dataset.path = path;
  input.setAttribute('aria-describedby', field.help ? `${id}-help ${id}-hint` : `${id}-hint`);
  return el(
    'div',
    { className: `field${field.wide ? ' field--wide' : ''}` },
    el('label', { htmlFor: id }, t(field.label)),
    input,
    ...(field.help ? [el('p', { className: 'hint', id: `${id}-help` }, t(field.help))] : []),
    el('p', { className: 'hint', id: `${id}-hint`, dataset: { hint: path } }),
  );
}

function renderLines(): HTMLElement {
  const list = el('div', { className: 'lines' });
  const lines = (state.draft.lines ??= [{}]);
  lines.forEach((_, i) => {
    const remove = el('button', { type: 'button', className: 'icon', title: t('l.remove', { n: i + 1 }) }, '×');
    remove.setAttribute('aria-label', t('l.remove', { n: i + 1 }));
    remove.onclick = () => {
      lines.splice(i, 1);
      state.touched.add('lines.removed');
      // The lines below move up by one, and what is still to be checked moves with them.
      state.toCheck = new Map(
        [...state.toCheck].flatMap(([path, why]): [string, typeof why][] => {
          const at = /^lines\.(\d+)(.*)$/.exec(path);
          if (!at || Number(at[1]) < i) return [[path, why]];
          return Number(at[1]) === i ? [] : [[`lines.${Number(at[1]) - 1}${at[2]}`, why]];
        }),
      );
      renderForm();
    };
    list.append(
      el(
        'fieldset',
        { className: 'line' },
        el('legend', {}, String(i + 1)),
        ...LINE_FIELDS.map((field) => control(field, `lines.${i}.${field.path}`)),
        remove,
        // Says something about the line as a whole, e.g. that a model added it.
        el('p', { className: 'hint', dataset: { hint: `lines.${i}` } }),
      ),
    );
  });
  const add = el('button', { type: 'button', className: 'quiet' }, t('l.add'));
  add.onclick = () => {
    lines.push({});
    state.touched.add('lines.added');
    renderForm();
  };
  list.append(add, el('p', { className: 'hint', dataset: { hint: 'lines' } }));
  return list;
}

function renderForm(): void {
  const form = $('#form');
  const expanded = new Set([...form.querySelectorAll('details[open]')].map((d) => (d as HTMLElement).dataset.section));
  const focused = focusedPath();
  form.replaceChildren();
  const section = (title: string, body: HTMLElement, collapsed = false) => {
    if (!collapsed) return el('section', { className: 'group' }, el('h3', {}, t(title)), body);
    const details = el('details', { className: 'group', dataset: { section: title }, open: expanded.has(title) }, el('summary', {}, t(title)), body);
    return details;
  };
  const format = shownFormat();
  const [invoice, seller, buyer, payment, more] = SECTIONS.map(({ title, fields, collapsed }) =>
    section(
      title,
      el('div', { className: 'fields' }, ...fields.filter((field) => (field.only ?? format) === format).map((field) => control(field, field.path))),
      collapsed,
    ),
  );
  form.append(invoice!, seller!, buyer!, section('s.lines', renderLines()), payment!, more!);
  if (state.mode === 'validate') {
    // Read only rather than disabled: a field can still take the focus, which shows where its value stands on the page.
    for (const field of form.querySelectorAll('input')) field.readOnly = true;
    for (const field of form.querySelectorAll<HTMLSelectElement | HTMLButtonElement>('select, button')) field.disabled = true;
    for (const details of form.querySelectorAll('details')) details.open = true;
  }
  // Whoever was typing while a model read the invoice goes on typing in the same field.
  if (focused) form.querySelector<HTMLElement>(`[data-path="${focused}"]`)?.focus();
  validate();
}

// ---------------------------------------------------------------------------------------------------------------
// Findings and totals

/**
 * A finding, or an error of the library, in the language of the page: in German the text for its code, worded for its
 * field where there is one (`e.format.iban`), else the English message of the library. An existing e-invoice has words
 * of its own where a finding is about its XML (`e.totals-mismatch.xml`), in English as well. What a German text names,
 * it takes from the data rather than from the English sentence; only the value a message quotes and a message of the
 * library that writes the XML are passed on as they are.
 */
function describe(finding: { code: string; message: string; path?: string }): string {
  const path = finding.path ?? '';
  const candidates = [`e.${finding.code}.${path.split('.').at(-1)}`, `e.${finding.code}`];
  if (state.mode === 'validate') candidates.unshift(`e.${finding.code}.xml`);
  const key = candidates.find((candidate) => candidate in STRINGS);
  if (!key || (lang !== 'de' && !STRINGS[key]?.en)) return finding.message;
  const line = state.draft.lines?.[Number(/^lines\.(\d+)\./.exec(path)?.[1])];
  return t(key, {
    a: line ? money(Number(line.quantity) * Number(line.unitPrice)) : '',
    b: line ? money(Number(line.netAmount)) : '',
    // Known limit: the value that could not be written is read from the quotes of the English message. Give the finding
    // the value itself if that message is ever worded differently.
    v: /"(.*)"/.exec(finding.message)?.[1] ?? '',
    m: finding.message,
  });
}
/** Why creating failed. An error of the library carries a code, and the page has a sentence for each. */
const reasonOf = (error: unknown) =>
  error instanceof Error && error.name === 'InvoiceError'
    ? describe(error as Error & { code: string })
    : error instanceof Error
      ? error.message
      : String(error);
const money = (n: number) =>
  new Intl.NumberFormat(lang, {
    style: 'currency',
    currency: /^[A-Z]{3}$/.test(String(state.draft.currency ?? '')) ? String(state.draft.currency) : 'EUR',
  }).format(n);

function fieldLabel(path: string): string {
  const input = document.querySelector<HTMLElement>(`[data-path="${path}"]`);
  const label = input && document.querySelector(`label[for="${input.id}"]`)?.textContent;
  // A line item is named by its number, also for a value of it the form does not show, such as its total.
  const line = /^lines\.(\d+)(\.|$)/.exec(path);
  if (line) return `${t('l.item', { n: Number(line[1]) + 1 })}${label ? `, ${label}` : ''}`;
  // Seller and buyer have fields of the same name: the party is named first.
  const who = /^(seller|buyer)\./.exec(path)?.[1];
  if (label) return who ? `${t(who === 'seller' ? 'xml.seller' : 's.buyer')}, ${label}` : label;
  return path.startsWith('totals.') ? t(`t.${path.slice(7)}`) : path === 'lines' ? t('s.lines') : '';
}

/** The field of a path; the first field of a line item for the path of the whole line, or of a value of it the form does not show. */
const fieldOf = (path: string) =>
  document.querySelector<HTMLElement>(`[data-path="${path}"], [data-path="${path}.name"]`) ??
  document.querySelector<HTMLElement>(`[data-path="${path.replace(/^(lines\.\d+)\..*$/, '$1')}.name"]`);

function validate(): void {
  const result = (state.result = check(state.draft, {
    ...(state.pdf ? { pdfText: state.pdfText } : {}),
    ...(shownFormat() === 'xrechnung' ? { rules: 'xrechnung' as const } : {}),
  }));
  // What nobody has looked at yet is said at its field. A model may have read a value the form has no field for: that one is not counted.
  const unchecked: Finding[] = [...state.toCheck]
    .filter(([path]) => document.querySelector(`[data-hint="${path}"]`))
    .map(([path, why]) => ({
      path,
      severity: 'warning',
      code: why,
      message: t(why === 'model' && /^lines\.\d+$/.test(path) ? 'hint.model.line' : `hint.${why}`),
    }));
  // Where XRechnung demands a part of the address, the warning that it is missing would only say the same again.
  const demanded = (finding: Finding) =>
    finding.code === 'address' && result.findings.some((other) => other.code === 'xrechnung-address' && other.path === finding.path);
  const findings = [...result.findings.filter((finding) => !demanded(finding)), ...state.fileFindings, ...unchecked];

  for (const hint of document.querySelectorAll<HTMLElement>('[data-hint]')) {
    const path = hint.dataset.hint!;
    const own = findings.filter((f) => f.path === path);
    const worst = own.find((f) => f.severity === 'error') ?? own[0];
    hint.textContent = worst ? describe(worst) : '';
    hint.className = `hint${worst ? ` hint--${worst.severity}` : ''}`;
    const input = document.querySelector<HTMLElement>(`[data-path="${path}"]`);
    input?.toggleAttribute('aria-invalid', worst?.severity === 'error');
    input?.classList.toggle('warned', worst?.severity === 'warning');
    // The hint of a whole line item: its frame says so too.
    if (hint.parentElement?.matches('.line'))
      hint.parentElement.classList.toggle(
        'line--check',
        unchecked.some((f) => f.path === path),
      );
    // A value that is still to be checked can be ticked off where it stands, without typing it again.
    if (worst && unchecked.includes(worst) && state.mode === 'create') {
      const ok = el('button', { type: 'button', className: 'ok' }, t('hint.ok'));
      ok.setAttribute('aria-label', t('hint.ok.label', { f: fieldLabel(path) }));
      ok.onclick = () => {
        state.toCheck.delete(path);
        validate();
        fieldOf(path)?.focus();
      };
      hint.append(' ', ok);
    }
  }

  const totals = $('#totals');
  totals.replaceChildren();
  if (result.totals) {
    const printed = (state.draft.totals ?? {}) as Record<string, number | undefined>;
    for (const key of ['net', 'vat', 'gross', 'due'] as const) {
      const mismatch = findings.some((f) => f.path === `totals.${key}`);
      const row = el(
        'div',
        { className: `total${key === 'gross' ? ' total--main' : ''}${mismatch ? ' total--off' : ''}` },
        el('dt', {}, t(`t.${key}`)),
        el('dd', {}, money(result.totals[key])),
      );
      // An existing e-invoice states its totals in its XML; for a PDF they are what the page prints.
      const printedAs = state.mode === 'validate' ? 't.printed.xml' : 't.printed';
      if (mismatch && typeof printed[key] === 'number') row.append(el('dd', { className: 'total__printed' }, t(printedAs, { v: money(printed[key]!) })));
      // A total has no field to focus: pointing at it shows where it stands, on whichever page that is.
      row.onmouseenter = () => {
        pointed = `totals.${key}`;
        turnTo(pointed);
        highlight(pointed);
      };
      row.onmouseleave = () => {
        pointed = undefined;
        highlight(focusedPath());
      };
      totals.append(row);
    }
  } else totals.append(el('p', { className: 'muted' }, t('t.empty')));

  const errors = findings.filter((f) => f.severity === 'error');
  // What a model added is one thing to check, however many values it is: the form shows each of them.
  const added = unchecked.filter((f) => f.code === 'model');
  const warnings = findings.filter((f) => f.severity === 'warning' && !added.includes(f));
  if (added.length) warnings.push({ ...added[0]!, message: t(added.length === 1 ? 'sum.model.one' : 'sum.model', { n: added.length }) });
  const summary = $('#summary');
  summary.replaceChildren();
  summary.className = `summary summary--${errors.length ? 'error' : warnings.length ? 'warning' : 'ok'}`;
  const count = (key: string, n: number) => (n ? t(n === 1 ? `${key}.one` : key, { n }) : '');
  const headline = [count(state.mode === 'validate' ? 'valid.errors' : 'sum.errors', errors.length), count('sum.warnings', warnings.length)]
    .filter(Boolean)
    .join(' · ');
  summary.append(el('p', { className: 'summary__title' }, headline || t(state.mode === 'validate' ? 'sum.valid' : 'sum.ok')));
  const list = el('ul');
  for (const finding of [...errors, ...warnings]) {
    // The sentence about what a model added speaks for all those values; it leads to the first of them.
    const where = finding.code === 'model' ? '' : fieldLabel(finding.path);
    const text = `${where ? `${where}: ` : ''}${describe(finding)}`;
    const target = fieldOf(finding.path);
    const item = el('li', { className: finding.severity });
    if (target) {
      const jump = el('button', { type: 'button', className: 'link' }, text);
      jump.onclick = () => {
        target.closest('details')?.setAttribute('open', '');
        target.focus();
      };
      item.append(jump);
    } else item.append(text);
    list.append(item);
  }
  if (list.children.length) summary.append(list);
  $<HTMLButtonElement>('#create').disabled = errors.length > 0 || !state.pdf;
  // The stamp reads like a seal: an existing e-invoice gets it only where the check found nothing at all.
  $('#work-stamp').hidden = !(state.mode === 'validate' && errors.length === 0 && warnings.length === 0);
  renderMarks();
  refreshXml();
}

// The form is never sent anywhere: Enter in a field must not reload the page.
$('#form').addEventListener('submit', (event) => event.preventDefault());
$('#form').addEventListener('input', (event) => {
  const input = event.target as HTMLInputElement | HTMLSelectElement;
  const path = input.dataset.path;
  if (!path) return;
  const number = (input as HTMLInputElement).type === 'number';
  setPath(state.draft, path, number ? (input.value === '' ? undefined : Number(input.value)) : input.value.trim());
  state.touched.add(path);
  // Whoever changes a value has looked at it, and whoever changes a cell of a line has looked at the line.
  state.toCheck.delete(path);
  state.toCheck.delete(path.replace(/^(lines\.\d+)\..*$/, '$1'));
  validate();
});

// What "Create" makes. Switching keeps every value: the form shows and checks what the chosen format asks for.
const formats = [...document.querySelectorAll<HTMLInputElement>('input[name="format"]')];
function showFormat(): void {
  for (const radio of formats) radio.checked = radio.value === state.format;
  $('#format-note').hidden = state.format !== 'xrechnung';
  setText('#create', state.format === 'xrechnung' ? 'create.run.xr' : 'create.run');
}
for (const radio of formats) {
  radio.onchange = () => {
    state.format = radio.value as Format;
    showFormat();
    renderForm();
  };
}
showFormat();

// ---------------------------------------------------------------------------------------------------------------
// Where the values stand on the page

/** The text of every page with the place of each piece, in percent of its page. A page that is not read yet, or a scan, has none. */
let pagePieces: Piece[][] = [];
/** The page the preview shows, counted from 0, and the one it was last asked for: drawing a page takes a moment. */
let shown = 0;
let wanted = 0;
const marks = $('#marks');
const focusedPath = () => (document.activeElement as HTMLElement | null)?.dataset.path;
/** The total the pointer rests on: it stays the marked one while its page is being turned to. */
let pointed: string | undefined;

// Known limit: letters are measured in the browser's sans-serif, not in the font of the PDF, so a mark inside a long
// piece of text can be off by a letter. Measure with the embedded font if that shows.
const ruler = document.createElement('canvas').getContext('2d')!;
ruler.font = '16px sans-serif';
const widthOf = (text: string) => ruler.measureText(text).width;

/** Shows the marks of one value strongly and lets the others step back; without a path all are shown faintly. */
function highlight(path?: string): void {
  marks.classList.toggle('is-focused', path !== undefined);
  for (const mark of marks.children) mark.classList.toggle('is-active', (mark as HTMLElement).dataset.for === path);
}

/** Where the value of a field, or one of the totals, is printed among the pieces of one page. */
function placesOf(path: string, on: Piece[]): Rect[] {
  const find = (value: unknown, beside?: Rect[]) => locate(on, value, { beside, widthOf });
  const total = /^totals\.(net|vat|gross)$/.exec(path);
  if (total) return find(state.result?.totals?.[total[1] as 'net' | 'vat' | 'gross'] || undefined);
  const value = getPath(state.draft, path);
  if (isEmpty(value)) return [];
  const line = /^(lines\.\d+)\.(\w+)$/.exec(path);
  // The numbers of a line item are looked for next to its name: a "2" elsewhere on the page is not its quantity.
  // Known limit: the rate is looked for as "19 %" anywhere, since most invoices print it with the totals only; "7,5 %" is not found.
  return !line || line[2] === 'name' ? find(value) : line[2] === 'vatRate' ? find(`${value} %`) : find(value, find(getPath(state.draft, `${line[1]}.name`)));
}

/** Marks on the page that is shown, where the values of the form are printed there. A value that stands on another page gets its mark when that page is shown. */
function renderMarks(): void {
  marks.replaceChildren();
  const taken = new Set<string>();
  const placed: { mark: HTMLElement; rect: Rect }[] = [];
  const place = (path: string, label: string, rects: Rect[]) => {
    for (const rect of rects) {
      const box = { left: `${rect.x}%`, top: `${rect.y}%`, width: `${rect.width}%`, height: `${rect.height}%` };
      const twin = taken.size === taken.add(Object.values(box).join()).size;
      const mark = el('button', { type: 'button', className: `mark${twin ? ' mark--twin' : ''}`, tabIndex: -1, title: t('mark.title', { f: label }) });
      mark.dataset.for = path;
      Object.assign(mark.style, box);
      // How far down the page the mark is: the band of light uncovers it when it gets there.
      mark.style.setProperty('--y', String(rect.y / 100));
      marks.append(mark);
      placed.push({ mark, rect });
    }
  };
  const on = pagePieces[shown] ?? [];
  // Dropdowns hold codes, which are not printed; everything else is looked for.
  for (const input of $('#form').querySelectorAll<HTMLInputElement>('input[data-path]')) {
    const path = input.dataset.path!;
    place(path, fieldLabel(path), placesOf(path, on));
  }
  for (const key of ['net', 'vat', 'gross'] as const) place(`totals.${key}`, t(`t.${key}`), placesOf(`totals.${key}`, on));
  // A value printed inside another one, such as the due date in the sentence of the payment terms, lies on top of it:
  // both marks can be pointed at.
  const inside = (inner: Rect, outer: Rect) =>
    inner.width * inner.height < outer.width * outer.height &&
    Math.abs(inner.x + inner.width / 2 - outer.x - outer.width / 2) < outer.width / 2 &&
    Math.abs(inner.y + inner.height / 2 - outer.y - outer.height / 2) < outer.height / 2;
  for (const { mark, rect } of placed) if (placed.some((other) => inside(rect, other.rect))) mark.style.zIndex = '1';
  $('#marks-note').hidden = marks.children.length === 0;
  renderPager();
  highlight(pointed ?? focusedPath());
}

/** Turns the preview to the page a value stands on, unless the page that is shown has it too. */
function turnTo(path: string): void {
  const page = pageToShow(pagePieces, shown, (on) => placesOf(path, on).length > 0);
  if (page === undefined || page === shown) return;
  void showPage(page).then(() => ($('#page-live').textContent = t('page.turned', { n: page + 1, f: fieldLabel(path) })));
}

$('#form').addEventListener('focusin', (event) => {
  const field = event.target as HTMLElement;
  // Dropdowns hold codes, which are printed nowhere: they turn no page.
  if (field.dataset.path && field instanceof HTMLInputElement) turnTo(field.dataset.path);
  highlight(field.dataset.path);
});
$('#form').addEventListener('focusout', () => highlight());
marks.addEventListener('click', (event) => {
  const path = (event.target as HTMLElement).dataset.for;
  const field = path && document.querySelector<HTMLElement>(`[data-path="${path}"]`);
  if (field) {
    field.closest('details')?.setAttribute('open', '');
    field.focus();
  } else if (path) $('#totals').scrollIntoView({ block: 'center' });
});

/** The band of light over the preview: it keeps travelling while a model reads, and passes once when a PDF was opened. */
function scan(mode: 'on' | 'once' | 'off'): void {
  const band = $('#scan');
  band.dataset.mode = mode;
  band.hidden = mode === 'off';
}
$('#scan').addEventListener('animationend', () => scan('off'));

// ---------------------------------------------------------------------------------------------------------------
// Opening a PDF

/** The PDF that is open, as pdf.js holds it: its pages are drawn when they are turned to. */
let opened: { task: pdfjs.PDFDocumentLoadingTask; doc: pdfjs.PDFDocumentProxy } | undefined;

/** The text of a page with the place of every piece, in percent of the page. */
async function piecesOf(page: pdfjs.PDFPageProxy): Promise<Piece[]> {
  // Measured here and not taken from extractLayout: the marks lie on the drawing of the page, so they use its view of the page.
  // Known limit: upright text only. Text that is printed turned gets its mark in the wrong place; use the whole text matrix if such invoices turn up.
  const viewport = page.getViewport({ scale: 1 });
  return (await page.getTextContent()).items.flatMap((item) => {
    if (!('str' in item) || !item.str.trim()) return [];
    const [x, y, height] = [item.transform[4] as number, item.transform[5] as number, item.height];
    // From a little below the baseline to the top of the tall letters.
    const [x1, y1] = viewport.convertToViewportPoint(x, y - 0.25 * height) as [number, number];
    const [x2, y2] = viewport.convertToViewportPoint(x + item.width, y + 0.85 * height) as [number, number];
    return [
      {
        text: item.str,
        x: (Math.min(x1, x2) / viewport.width) * 100,
        y: (Math.min(y1, y2) / viewport.height) * 100,
        width: (Math.abs(x2 - x1) / viewport.width) * 100,
        height: (Math.abs(y2 - y1) / viewport.height) * 100,
      },
    ];
  });
}

/** Says which page is shown, and lets the pages be turned where there is more than one. */
function renderPager(): void {
  const count = opened?.doc.numPages ?? 1;
  $('#pager').hidden = count < 2;
  $('#page-now').textContent = t('page.now', { n: shown + 1, m: count });
  $<HTMLButtonElement>('#page-prev').disabled = shown === 0;
  $<HTMLButtonElement>('#page-next').disabled = shown >= count - 1;
  $('#preview').setAttribute('aria-label', t('work.preview', { n: shown + 1 }));
}

/**
 * Draws one page of the open PDF, counted from 0, and shows its marks. A page is drawn when it is turned to and kept
 * nowhere: a long PDF costs no more memory than a short one.
 */
async function showPage(index: number): Promise<void> {
  const pdf = opened;
  if (!pdf || index < 0 || index >= pdf.doc.numPages) return;
  wanted = index;
  const page = await pdf.doc.getPage(index + 1);
  const canvas = $<HTMLCanvasElement>('#preview');
  const viewport = page.getViewport({ scale: (Math.min(720, canvas.parentElement!.clientWidth) / page.getViewport({ scale: 1 }).width) * devicePixelRatio });
  // Drawn beside the stage and put on it when done: turning on while a page is still being drawn leaves no half page behind.
  const sheet = el('canvas', { width: viewport.width, height: viewport.height });
  await page.render({ canvas: sheet, viewport }).promise;
  pagePieces[index] ??= await piecesOf(page);
  // Another page was turned to, or another PDF opened, while this one was drawn.
  if (opened !== pdf || wanted !== index) return;
  shown = index;
  Object.assign(canvas, { width: sheet.width, height: sheet.height });
  canvas.getContext('2d')!.drawImage(sheet, 0, 0);
  renderMarks();
}
$('#page-prev').onclick = () => showPage(wanted - 1);
$('#page-next').onclick = () => showPage(wanted + 1);

async function preview(pdf: Uint8Array): Promise<void> {
  const before = opened;
  opened = undefined;
  await before?.task.destroy();
  const task = pdfjs.getDocument({ data: pdf.slice(), verbosity: 0 });
  const mine = (opened = { task, doc: await task.promise });
  pagePieces = [];
  shown = 0;
  await showPage(0);
  // The other pages are read in the background, so that a value that stands on one of them can be turned to.
  void (async () => {
    for (let index = 1; index < mine.doc.numPages && opened === mine; index++) pagePieces[index] ??= await piecesOf(await mine.doc.getPage(index + 1));
  })().catch(() => {
    // The PDF was closed while its pages were read: nothing is left to read.
  });
}

function show(view: 'start' | 'work' | 'done'): void {
  document.body.dataset.view = view;
  window.scrollTo({ top: 0 });
}

/** Payment terms suggested when the PDF states neither a due date nor terms, in the language of the invoice. */
const USUAL_PAYMENT_TERMS = { de: 'Zahlbar innerhalb von 14 Tagen ab Rechnungsdatum.', en: 'Payable within 14 days of the invoice date.' };

/** EN 16931 wants a due date or payment terms. Where the PDF has neither, the usual terms are put in as a visible suggestion. */
function suggestPaymentTerms(): void {
  if (!isEmpty(state.draft.dueDate) || !isEmpty(state.draft.paymentTerms)) return;
  state.draft.paymentTerms = USUAL_PAYMENT_TERMS[languageOf(state.pdfText)];
  state.toCheck.set('paymentTerms', 'suggested');
}

/** Findings that are about the file, not about a field of the form. */
const FILE_CODES = new Set(['no-xml', 'xml-syntax', 'profile', 'pdf-a', 'pdf-fonts']);

function setText(selector: string, key: string): void {
  const node = $(selector);
  node.dataset.i18n = key;
  node.textContent = t(key);
}

async function open(pdf: Uint8Array, fileName: string): Promise<void> {
  const status = $('#drop-status');
  status.textContent = t('drop.reading');
  try {
    const info = await inspectPdf(pdf);
    const { text, blocks } = await extractLayout(pdf);
    pagePieces = [];
    xmlSection.open = false;
    Object.assign(state, {
      pdf,
      fileName,
      pdfText: text,
      draft: {},
      touched: new Set(),
      fileFindings: [],
      toCheck: new Map(),
      mode: info.embeddedXml === null ? 'create' : 'validate',
    });
    if (state.mode === 'validate') {
      // The PDF already is an e-invoice: show what its XML says, next to the page it belongs to.
      const { validateEInvoice } = await import('../src/validate.js');
      const result = await validateEInvoice(pdf, { pdfText: text });
      state.draft = result.invoice ?? {};
      state.fileFindings = result.findings.filter((finding) => FILE_CODES.has(finding.code));
      $('#read-status').textContent = result.profile ? t('valid.profile', { p: result.profile }) : '';
    } else {
      merge(guessFromText(text, { blocks }));
      // What was read from the PDF, before anything is suggested.
      const found = JSON.stringify(state.draft).match(/":("|\d|-)/g)?.length ?? 0;
      // An invoice that shows no VAT gets its VAT category from the buyer's country, the same for every line: a person
      // confirms it at the first line.
      if ((state.draft.lines?.[0]?.vatCategory ?? 'S') !== 'S') state.toCheck.set('lines.0.vatCategory', 'inferred');
      suggestPaymentTerms();
      $('#read-status').textContent = text.trim() ? t(found === 1 ? 'read.found.one' : 'read.found', { n: found }) : t('read.none');
    }
    document.body.dataset.mode = state.mode;
    setText('#work-title', state.mode === 'validate' ? 'valid.title' : 'work.title');
    setText('#work-lead', state.mode === 'validate' ? 'valid.lead' : 'work.lead');
    $('#file-name').textContent = fileName;
    $('#ai-status').textContent = '';
    renderForm();
    // Reading with a model is offered openly when the patterns left a lot to fill in.
    $<HTMLDetailsElement>('.reader details').open = (state.result?.findings.filter((finding) => finding.severity === 'error').length ?? 0) > 2;
    show('work');
    await preview(pdf);
    status.textContent = '';
    // The patterns have read the page: one pass of the light shows it.
    if (state.mode === 'create' && text.trim()) scan('once');
  } catch (error) {
    console.error(error);
    status.textContent = t('e.invalid-pdf');
  }
}

const fileInput = $<HTMLInputElement>('#file');
fileInput.onchange = async () => {
  const file = fileInput.files?.[0];
  if (file) await open(new Uint8Array(await file.arrayBuffer()), file.name);
  fileInput.value = '';
};
const drop = $('#drop');
for (const type of ['dragenter', 'dragover'] as const) {
  drop.addEventListener(type, (event) => {
    event.preventDefault();
    drop.classList.add('is-over');
  });
}
for (const type of ['dragleave', 'drop'] as const) drop.addEventListener(type, () => drop.classList.remove('is-over'));
drop.addEventListener('drop', async (event) => {
  event.preventDefault();
  const file = event.dataTransfer?.files[0];
  if (file) await open(new Uint8Array(await file.arrayBuffer()), file.name);
});
$('#sample').onclick = async () => open(new Uint8Array(await (await fetch(sampleUrl)).arrayBuffer()), 'sample-invoice.pdf');
$('#other').onclick = () => show('start');

// ---------------------------------------------------------------------------------------------------------------
// Reading with a language model

const modelSelect = $<HTMLSelectElement>('#ai-model');
function renderModels(): void {
  modelSelect.replaceChildren(
    ...MODELS.map((model) =>
      el('option', { value: model.id, selected: model.id === DEFAULT_MODEL }, `${model.id.replace(/-q4f16_1-MLC$/, '')} (${model.note[lang]})`),
    ),
    el('option', { value: 'endpoint' }, t('ai.endpoint')),
  );
  $('#ai-endpoint').hidden = true;
}
modelSelect.onchange = () => ($('#ai-endpoint').hidden = modelSelect.value !== 'endpoint');

/**
 * Shows how far reading with a model is: below 1 the model is still loading and a bar says how much of it is there,
 * at 1 it reads and the band of light travels over the page. Without a number, reading is over.
 */
function reading(fraction?: number): void {
  const loading = fraction !== undefined && fraction < 1;
  $('#ai-loading').hidden = !loading;
  $('#ai-cancel').hidden = fraction === undefined;
  $<HTMLProgressElement>('#ai-progress').value = fraction ?? 0;
  if (fraction !== undefined) $('#ai-status').textContent = loading ? t('ai.loading', { p: Math.round(fraction * 100) }) : t('ai.reading');
  scan(fraction !== undefined && !loading ? 'on' : 'off');
}

/** Each reading has a number: only the last one may fill in the form, and one that was cancelled fills in nothing. */
let reads = 0;
let cancelRead: AbortController | undefined;
$('#ai-cancel').onclick = () => cancelRead?.abort();

$('#ai-run').onclick = async () => {
  const status = $('#ai-status');
  const [button, cancel] = [$<HTMLButtonElement>('#ai-run'), $<HTMLButtonElement>('#ai-cancel')];
  const viaEndpoint = modelSelect.value === 'endpoint';
  if (!viaEndpoint && !hasWebGpu()) return void (status.textContent = t('ai.nogpu'));
  // Without a full address the request would go to this site itself: nothing is sent until one is given.
  const address = $<HTMLInputElement>('#ai-url');
  if (viaEndpoint && !address.checkValidity()) {
    address.focus();
    return void (status.textContent = t('ai.endpoint.missing'));
  }
  const run = ++reads;
  const abort = (cancelRead = new AbortController());
  // The button waits while the model works; the focus goes on to the button that cancels.
  const focused = document.activeElement === button;
  button.disabled = true;
  const pdf = state.pdf;
  try {
    reading(viaEndpoint ? 1 : 0);
    if (focused) cancel.focus();
    const read = viaEndpoint
      ? readWithEndpoint(
          state.pdfText,
          { url: address.value, model: $<HTMLInputElement>('#ai-name').value, key: $<HTMLInputElement>('#ai-key').value },
          abort.signal,
        )
      : readWithBrowserModel(state.pdfText, modelSelect.value, reading, abort.signal);
    const answer = await read;
    // Another PDF was opened, or the reading was cancelled, while the model read: the answer is not taken over.
    if (state.pdf !== pdf || run !== reads || abort.signal.aborted) return;
    // A small model translates names and makes up identifiers. Only what the PDF shows is taken over, and even of
    // that a good part is wrong: every value the model added is marked until the user has looked at it.
    const added = merge(keepWhatThePdfShows(normaliseDraft(answer), state.pdfText), true);
    for (const path of added) state.toCheck.set(path, 'model');
    renderForm();
    // Counted as the verdict counts them: a value the form has no field for is not shown, so it is not counted.
    const counted = added.filter((path) => document.querySelector(`[data-hint="${path}"]`)).length;
    status.textContent = counted ? t(counted === 1 ? 'ai.done.one' : 'ai.done', { n: counted }) : t('ai.done.none');
  } catch (error) {
    status.textContent = abort.signal.aborted ? t('ai.cancelled') : t('ai.failed', { m: error instanceof Error ? error.message : String(error) });
  } finally {
    const refocus = document.activeElement === cancel;
    reading();
    button.disabled = false;
    if (refocus) button.focus();
    if (state.pdf !== pdf) status.textContent = '';
  }
};

// ---------------------------------------------------------------------------------------------------------------
// What goes into the file

const xmlSection = $<HTMLDetailsElement>('#xml');
let xmlTimer = 0;
let xmlRun = 0;

/** An element of the XML exactly as it is written there: the first `names[0]`, in it the first `names[1]`, and so on. */
function fragment(xml: string, ...names: string[]): string | undefined {
  let part: string | undefined = xml;
  for (const name of names) part = part && new RegExp(`<${name}(\\s[^>]*)?>[^]*?</${name}>`).exec(part)?.[0];
  return part;
}

/**
 * Shows the XML that "Create" would write right now: the one in the PDF, or for an XRechnung the file of its own. It
 * is not put together a second time for this view: the file is created and its XML is shown, and the rows of the
 * table are cut out of that XML.
 */
async function renderXml(): Promise<void> {
  const run = ++xmlRun;
  const [status, pair, whole] = [$('#xml-status'), $('#xml-pair'), $('#xml-whole')];
  const instead = (text: string) => {
    status.textContent = text;
    pair.hidden = whole.hidden = true;
  };
  if (!state.pdf || !state.result?.invoice) return instead(t('xml.errors'));
  if (pair.hidden) status.textContent = t('xml.busy');
  try {
    const invoice = structuredClone(state.draft);
    const { createEInvoice, createXRechnung } = await import('../src/create.js');
    const { xml, totals } = shownFormat() === 'xrechnung' ? await createXRechnung({ invoice }) : await createEInvoice({ pdf: state.pdf, invoice });
    // The data has changed again in the meantime: the newer run shows its XML.
    if (run !== xmlRun) return;
    const date = (iso: unknown) => new Intl.DateTimeFormat(lang, { dateStyle: 'medium', timeZone: 'UTC' }).format(new Date(`${iso}T00:00:00Z`));
    // Where a value stands in CII (the PDF) and in UBL (the XRechnung): the path that is not in the XML finds nothing.
    const inXml = (cii: string[], ubl: string[]) => fragment(xml, ...cii) ?? fragment(xml, ...ubl);
    const rows: [label: string, value: string, written: string | undefined][] = [
      [t('f.number'), String(invoice.number), inXml(['rsm:ExchangedDocument', 'ram:ID'], ['cbc:ID'])],
      [t('f.issueDate'), date(invoice.issueDate), inXml(['rsm:ExchangedDocument', 'ram:IssueDateTime', 'udt:DateTimeString'], ['cbc:IssueDate'])],
      [t('xml.seller'), String(invoice.seller?.name), inXml(['ram:SellerTradeParty', 'ram:Name'], ['cac:AccountingSupplierParty', 'cbc:RegistrationName'])],
      [t('t.vat'), money(totals.vat), inXml(['ram:TaxTotalAmount'], ['cac:TaxTotal', 'cbc:TaxAmount'])],
      [t('t.gross'), money(totals.gross), inXml(['ram:GrandTotalAmount'], ['cbc:TaxInclusiveAmount'])],
    ];
    // In a narrow column the XML breaks where a tag ends, not in the middle of a name.
    const code = (written: string) => el('code', {}, ...written.split(/(?<=>)(?!$)|(?=<\/)/).flatMap((part, i) => (i ? [el('wbr'), part] : [part])));
    pair
      .querySelector('tbody')!
      .replaceChildren(
        ...rows.flatMap(([label, value, written]) =>
          written ? [el('tr', {}, el('td', {}, `${label} `, el('strong', {}, value)), el('td', {}, code(written)))] : [],
        ),
      );
    $('#xml-code').textContent = xml;
    status.textContent = '';
    pair.hidden = whole.hidden = false;
  } catch (error) {
    if (run === xmlRun) instead(t('create.failed', { m: reasonOf(error) }));
  }
}

/** Creating the XML is work: it is done when the section is opened, and again a moment after the data last changed. */
function refreshXml(): void {
  clearTimeout(xmlTimer);
  if (xmlSection.open) xmlTimer = window.setTimeout(renderXml, 400);
}
xmlSection.addEventListener('toggle', () => xmlSection.open && renderXml());

/** Copies the text of an element; the label of the button says so for a moment. */
async function copyText(source: HTMLElement, label: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(source.textContent ?? '');
    setText(label, 'xml.copied');
    setTimeout(() => setText(label, 'xml.copy'), 2000);
  } catch {
    // The browser does not let the page write to the clipboard: the text is selected, ready for Ctrl+C.
    getSelection()?.selectAllChildren(source);
  }
}
$('#xml-copy').onclick = () => copyText($('#xml-code'), '#xml-copy');

// ---------------------------------------------------------------------------------------------------------------
// Creating the e-invoice

let downloads: string[] = [];
const link = (id: string, bytes: BlobPart, type: string, name: string) => {
  const url = URL.createObjectURL(new Blob([bytes], { type }));
  downloads.push(url);
  Object.assign($<HTMLAnchorElement>(id), { href: url, download: name });
};

$('#create').onclick = async () => {
  const button = $<HTMLButtonElement>('#create');
  const status = $('#create-status');
  button.disabled = true;
  status.textContent = t('create.busy');
  const xr = state.format === 'xrechnung';
  try {
    // Loaded on demand: the XML writer is the heaviest part of the page.
    const { createEInvoice, createXRechnung } = await import('../src/create.js');
    // No language is passed on: for any other than English the library asks the server for a catalogue of
    // translations that it does not ship. It would only word the document properties of the PDF.
    const result = await createEInvoice({ pdf: state.pdf!, invoice: state.draft, ...(xr ? { profile: 'xrechnung' as const } : {}) });
    // A public body takes the XRechnung as a file of its own; the PDF that carries it too is the copy that keeps the look.
    const plain = xr ? await createXRechnung({ invoice: state.draft }) : undefined;
    downloads.forEach((url) => URL.revokeObjectURL(url));
    downloads = [];
    const base = state.fileName.replace(/\.pdf$/i, '');
    link('#download-pdf', result.pdf as BlobPart, 'application/pdf', `${base}.einvoice.pdf`);
    link('#download-xml', plain?.xml ?? result.xml, 'application/xml', plain ? `${base}.xrechnung.xml` : `${base}.xml`);
    // The main file comes first, and the checksum is that of the main file.
    const [main, copy] = [$<HTMLAnchorElement>(xr ? '#download-xml' : '#download-pdf'), $<HTMLAnchorElement>(xr ? '#download-pdf' : '#download-xml')];
    main.className = 'primary';
    copy.className = 'quiet';
    main.parentElement!.prepend(main, copy);
    setText('#download-pdf', xr ? 'done.xr.pdf' : 'done.pdf');
    setText('#download-xml', xr ? 'done.xr.xml' : 'done.xml');
    setText('#done-title', xr ? 'done.title.xr' : 'done.title');
    setText('#done-lead', xr ? 'done.lead.xr' : 'done.lead');
    $('#done-stamp').textContent = xr ? 'XRechnung' : 'EN 16931';
    const digest = await crypto.subtle.digest('SHA-256', (plain ? new TextEncoder().encode(plain.xml) : result.pdf) as BufferSource);
    $('#checksum-file').textContent = main.download;
    $('#checksum').textContent = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
    // Both files are written from the same data: what is said about it is said once.
    const findings = [...result.findings, ...(plain?.findings ?? [])].filter(
      (finding, i, all) => all.findIndex((other) => other.code === finding.code && other.path === finding.path && other.message === finding.message) === i,
    );
    const notes = $('#done-notes');
    notes.replaceChildren(...findings.map((finding) => el('li', {}, describe(finding))));
    notes.hidden = findings.length === 0;
    // The stamp reads like a seal: it lands only where neither the check nor the writing of the file found anything.
    $('#done .stamp').hidden = findings.length > 0 || document.querySelector('#summary li') !== null;
    status.textContent = '';
    // The finished page shows the same preview, with the stamp landing on it.
    const [from, to] = [$<HTMLCanvasElement>('#preview'), $<HTMLCanvasElement>('#done-preview')];
    Object.assign(to, { width: from.width, height: from.height });
    to.getContext('2d')!.drawImage(from, 0, 0);
    show('done');
  } catch (error) {
    status.textContent = t('create.failed', { m: reasonOf(error) });
  } finally {
    button.disabled = false;
    validate();
  }
};
$('#again').onclick = () => show('work');

// ---------------------------------------------------------------------------------------------------------------
// The listings for developers: one is shown at a time

const tabs = [...document.querySelectorAll<HTMLButtonElement>('.tabs [role="tab"]')];
function selectTab(tab: HTMLButtonElement): void {
  for (const other of tabs) {
    other.setAttribute('aria-selected', String(other === tab));
    other.tabIndex = other === tab ? 0 : -1;
    $(`#${other.getAttribute('aria-controls')}`).hidden = other !== tab;
  }
}
for (const [i, tab] of tabs.entries()) {
  tab.onclick = () => selectTab(tab);
  // The arrow keys move from tab to tab, as in every list of tabs.
  tab.onkeydown = (event) => {
    const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
    if (!step) return;
    const next = tabs[(i + step + tabs.length) % tabs.length]!;
    selectTab(next);
    next.focus();
  };
}
$('#code-copy').onclick = () => copyText($('.code pre:not([hidden])'), '#code-copy span');

// ---------------------------------------------------------------------------------------------------------------
// Language

function applyLang(next: 'de' | 'en'): void {
  setLang(next);
  for (const button of document.querySelectorAll<HTMLButtonElement>('[data-lang]')) button.setAttribute('aria-pressed', String(button.dataset.lang === next));
  renderModels();
  if (state.pdf) renderForm();
}
for (const button of document.querySelectorAll<HTMLButtonElement>('[data-lang]')) button.onclick = () => applyLang(button.dataset.lang as 'de' | 'en');
applyLang(lang);
