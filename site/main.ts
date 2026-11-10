import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import pdfWorkerUrl from 'pdfjs-dist/legacy/build/pdf.worker.mjs?url';
import sampleUrl from '../examples/sample-invoice.pdf?url';
import { check, type CheckResult, type Finding } from '../src/check.js';
import { keepWhatThePdfShows } from '../src/ground.js';
import { guessFromText, languageOf } from '../src/guess.js';
import { INVOICE_TYPES, VAT_CATEGORIES, type InvoiceDraft } from '../src/model.js';
import { inspectPdf } from '../src/pdf.js';
import { extractLayout } from '../src/text.js';
import { lang, setLang, t } from './i18n.js';
import { DEFAULT_MODEL, MODELS, hasWebGpu, readWithBrowserModel, readWithEndpoint } from './llm.js';
import { locate, type Piece, type Rect } from './locate.js';
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
  /** Fields filled with a suggestion that is not on the PDF, until the user changes them. */
  suggested: Set<string>;
}
const state: State = { fileName: '', pdfText: '', draft: {}, touched: new Set(), fileFindings: [], mode: 'create', suggested: new Set() };

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
 * that are already there stay as well: what the patterns found is not replaced by what a model read.
 */
function merge(extra: any, onlyEmpty = false, prefix = ''): void {
  for (const [key, value] of Object.entries(extra ?? {})) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (isEmpty(value)) continue;
    if (key === 'lines' && Array.isArray(value)) {
      const typed = [...state.touched].some((p) => p.startsWith('lines.'));
      if (!typed && !(onlyEmpty && hasContent(state.draft.lines)) && hasContent(value)) state.draft.lines = value.map(normalise) as InvoiceDraft['lines'];
    } else if (typeof value === 'object') merge(value, onlyEmpty, path);
    else if (!state.touched.has(path) && !(onlyEmpty && !isEmpty(getPath(state.draft, path))))
      setPath(state.draft, path, NUMERIC.test(path) ? toNumber(value) : value);
  }
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

type FieldType = 'text' | 'date' | 'number' | 'select';
interface Field {
  path: string;
  label: string;
  type?: FieldType;
  options?: [value: string, label: string][];
  wide?: boolean;
}

const party = (who: 'seller' | 'buyer'): Field[] => [
  { path: `${who}.name`, label: 'f.name', wide: true },
  { path: `${who}.street`, label: 'f.street', wide: true },
  { path: `${who}.postalCode`, label: 'f.postalCode' },
  { path: `${who}.city`, label: 'f.city' },
  { path: `${who}.country`, label: 'f.country' },
  { path: `${who}.vatId`, label: 'f.vatId' },
  ...(who === 'seller'
    ? [
        { path: 'seller.taxNumber', label: 'f.taxNumber' },
        { path: 'seller.email', label: 'f.email' },
      ]
    : []),
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
      { path: 'buyerReference', label: 'f.buyerReference' },
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
  input.setAttribute('aria-describedby', `${id}-hint`);
  return el(
    'div',
    { className: `field${field.wide ? ' field--wide' : ''}` },
    el('label', { htmlFor: id }, t(field.label)),
    input,
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
      renderForm();
    };
    list.append(
      el('fieldset', { className: 'line' }, el('legend', {}, String(i + 1)), ...LINE_FIELDS.map((field) => control(field, `lines.${i}.${field.path}`)), remove),
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
  const [invoice, seller, buyer, payment, more] = SECTIONS.map(({ title, fields, collapsed }) =>
    section(title, el('div', { className: 'fields' }, ...fields.map((field) => control(field, field.path))), collapsed),
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

const describe = (finding: Finding) => (lang === 'de' && t(`e.${finding.code}`) !== `e.${finding.code}` ? t(`e.${finding.code}`) : finding.message);
const money = (n: number) =>
  new Intl.NumberFormat(lang, {
    style: 'currency',
    currency: /^[A-Z]{3}$/.test(String(state.draft.currency ?? '')) ? String(state.draft.currency) : 'EUR',
  }).format(n);

function fieldLabel(path: string): string {
  const input = document.querySelector<HTMLElement>(`[data-path="${path}"]`);
  const label = input && document.querySelector(`label[for="${input.id}"]`)?.textContent;
  const line = /^lines\.(\d+)\./.exec(path);
  if (label) return line ? `${t('s.lines')} ${Number(line[1]) + 1}, ${label}` : label;
  return path.startsWith('totals') ? t('s.totals') : path === 'lines' ? t('s.lines') : '';
}

function validate(): void {
  const result = (state.result = check(state.draft, state.pdf ? { pdfText: state.pdfText } : {}));
  // A suggestion is not on the PDF; it is listed until the user has looked at it and changed or kept it by typing.
  const suggestions: Finding[] = [...state.suggested]
    .filter((path) => !state.touched.has(path))
    .map((path) => ({ path, severity: 'warning', code: 'suggested', message: t('hint.suggested') }));
  const findings = [...result.findings, ...state.fileFindings, ...suggestions];

  for (const hint of document.querySelectorAll<HTMLElement>('[data-hint]')) {
    const own = findings.filter((f) => f.path === hint.dataset.hint);
    const worst = own.find((f) => f.severity === 'error') ?? own[0];
    hint.textContent = worst ? describe(worst) : '';
    hint.className = `hint${worst ? ` hint--${worst.severity}` : ''}`;
    const input = document.querySelector<HTMLElement>(`[data-path="${hint.dataset.hint}"]`);
    input?.toggleAttribute('aria-invalid', worst?.severity === 'error');
    input?.classList.toggle('warned', worst?.severity === 'warning');
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
      if (mismatch && typeof printed[key] === 'number') row.append(el('dd', { className: 'total__printed' }, t('t.printed', { v: money(printed[key]!) })));
      // A total has no field to focus: pointing at it shows where it stands on the page.
      row.onmouseenter = () => highlight(`totals.${key}`);
      row.onmouseleave = () => highlight(focusedPath());
      totals.append(row);
    }
  } else totals.append(el('p', { className: 'muted' }, t('t.empty')));

  const errors = findings.filter((f) => f.severity === 'error');
  const warnings = findings.filter((f) => f.severity === 'warning');
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
    const where = fieldLabel(finding.path);
    const text = `${where ? `${where}: ` : ''}${describe(finding)}`;
    const target = document.querySelector<HTMLElement>(`[data-path="${finding.path}"]`);
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
  // An existing e-invoice that passes the check gets its stamp on the preview.
  $('#work-stamp').hidden = !(state.mode === 'validate' && errors.length === 0);
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
  validate();
});

// ---------------------------------------------------------------------------------------------------------------
// Where the values stand on the page

/** The text of page 1 with the place of every piece, in percent of the page. Empty for a scan. */
let pieces: Piece[] = [];
const marks = $('#marks');
const focusedPath = () => (document.activeElement as HTMLElement | null)?.dataset.path;

// ponytail: letters are measured in the browser's sans-serif, not in the font of the PDF, so a mark inside a long
// piece of text can be off by a letter. Measure with the embedded font if that shows.
const ruler = document.createElement('canvas').getContext('2d')!;
ruler.font = '16px sans-serif';
const widthOf = (text: string) => ruler.measureText(text).width;

/** Shows the marks of one value strongly and lets the others step back; without a path all are shown faintly. */
function highlight(path?: string): void {
  marks.classList.toggle('is-focused', path !== undefined);
  for (const mark of marks.children) mark.classList.toggle('is-active', (mark as HTMLElement).dataset.for === path);
}

/** Marks on the preview where the values of the form are printed. A value that is not found on page 1 gets no mark. */
function renderMarks(): void {
  marks.replaceChildren();
  const taken = new Set<string>();
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
    }
  };
  const find = (value: unknown, beside?: Rect[]) => locate(pieces, value, { beside, widthOf });
  // Dropdowns hold codes, which are not printed; everything else is looked for.
  for (const input of $('#form').querySelectorAll<HTMLInputElement>('input[data-path]')) {
    const path = input.dataset.path!;
    const value = getPath(state.draft, path);
    const line = /^(lines\.\d+)\.(\w+)$/.exec(path);
    if (isEmpty(value)) continue;
    // The numbers of a line item are looked for next to its name: a "2" elsewhere on the page is not its quantity.
    // ponytail: the rate is looked for as "19 %" anywhere, since most invoices print it with the totals only; "7,5 %" is not found.
    const rects =
      !line || line[2] === 'name' ? find(value) : line[2] === 'vatRate' ? find(`${value} %`) : find(value, find(getPath(state.draft, `${line[1]}.name`)));
    place(path, fieldLabel(path), rects);
  }
  for (const key of ['net', 'vat', 'gross'] as const) {
    const total = state.result?.totals?.[key];
    if (total) place(`totals.${key}`, t(`t.${key}`), find(total));
  }
  $('#marks-note').hidden = marks.children.length === 0;
  highlight(focusedPath());
}

$('#form').addEventListener('focusin', (event) => highlight((event.target as HTMLElement).dataset.path));
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

async function preview(pdf: Uint8Array): Promise<void> {
  const task = pdfjs.getDocument({ data: pdf.slice(), verbosity: 0 });
  const doc = await task.promise;
  const page = await doc.getPage(1);
  const canvas = $<HTMLCanvasElement>('#preview');
  const viewport = page.getViewport({ scale: (Math.min(720, canvas.parentElement!.clientWidth) / page.getViewport({ scale: 1 }).width) * devicePixelRatio });
  canvas.width = viewport.width;
  canvas.height = viewport.height;
  await page.render({ canvas, viewport }).promise;
  // Measured here and not taken from extractLayout: the marks lie on this drawing, so they use its view of the page.
  // ponytail: upright text only. Text that is printed turned gets its mark in the wrong place; use the whole text matrix if such invoices turn up.
  pieces = (await page.getTextContent()).items.flatMap((item) => {
    if (!('str' in item) || !item.str.trim()) return [];
    const [x, y, height] = [item.transform[4] as number, item.transform[5] as number, item.height];
    // From a little below the baseline to the top of the tall letters, in the same view the page is drawn with.
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
  await task.destroy();
  renderMarks();
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
  state.suggested.add('paymentTerms');
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
    pieces = [];
    xmlSection.open = false;
    Object.assign(state, {
      pdf,
      fileName,
      pdfText: text,
      draft: {},
      touched: new Set(),
      fileFindings: [],
      suggested: new Set(),
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
      suggestPaymentTerms();
      const found = JSON.stringify(state.draft).match(/":("|\d|-)/g)?.length ?? 0;
      $('#read-status').textContent = text.trim() ? t('read.found', { n: found }) : t('read.none');
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
  $<HTMLProgressElement>('#ai-progress').value = fraction ?? 0;
  if (fraction !== undefined) $('#ai-status').textContent = loading ? t('ai.loading', { p: Math.round(fraction * 100) }) : t('ai.reading');
  scan(fraction !== undefined && !loading ? 'on' : 'off');
}

$('#ai-run').onclick = async () => {
  const status = $('#ai-status');
  const button = $<HTMLButtonElement>('#ai-run');
  const viaEndpoint = modelSelect.value === 'endpoint';
  if (!viaEndpoint && !hasWebGpu()) return void (status.textContent = t('ai.nogpu'));
  button.disabled = true;
  const pdf = state.pdf;
  try {
    reading(viaEndpoint ? 1 : 0);
    const read = viaEndpoint
      ? readWithEndpoint(state.pdfText, {
          url: $<HTMLInputElement>('#ai-url').value,
          model: $<HTMLInputElement>('#ai-name').value,
          key: $<HTMLInputElement>('#ai-key').value,
        })
      : readWithBrowserModel(state.pdfText, modelSelect.value, reading);
    const answer = await read;
    // Another PDF was opened while the model read: its answer is about the invoice that is gone.
    if (state.pdf !== pdf) return;
    // A small model translates names and makes up identifiers. Only what the PDF shows is taken over.
    merge(keepWhatThePdfShows(normaliseDraft(answer), state.pdfText), true);
    renderForm();
    status.textContent = t('ai.done');
  } catch (error) {
    status.textContent = t('ai.failed', { m: error instanceof Error ? error.message : String(error) });
  } finally {
    reading();
    button.disabled = false;
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
 * Shows the XML that "Create e-invoice" would embed right now. It is not put together a second time for this view:
 * the e-invoice is created and its XML is shown, and the rows of the table are cut out of that XML.
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
    const { createEInvoice } = await import('../src/create.js');
    const { xml, totals } = await createEInvoice({ pdf: state.pdf, invoice, lang });
    // The data has changed again in the meantime: the newer run shows its XML.
    if (run !== xmlRun) return;
    const date = (iso: unknown) => new Intl.DateTimeFormat(lang, { dateStyle: 'medium', timeZone: 'UTC' }).format(new Date(`${iso}T00:00:00Z`));
    const rows: [label: string, value: string, written: string | undefined][] = [
      [t('f.number'), String(invoice.number), fragment(xml, 'rsm:ExchangedDocument', 'ram:ID')],
      [t('f.issueDate'), date(invoice.issueDate), fragment(xml, 'rsm:ExchangedDocument', 'ram:IssueDateTime', 'udt:DateTimeString')],
      [t('xml.seller'), String(invoice.seller?.name), fragment(xml, 'ram:SellerTradeParty', 'ram:Name')],
      [t('t.vat'), money(totals.vat), fragment(xml, 'ram:TaxTotalAmount')],
      [t('t.gross'), money(totals.gross), fragment(xml, 'ram:GrandTotalAmount')],
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
    if (run === xmlRun) instead(t('create.failed', { m: error instanceof Error ? error.message : String(error) }));
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
  try {
    // Loaded on demand: the XML writer is the heaviest part of the page.
    const { createEInvoice } = await import('../src/create.js');
    const result = await createEInvoice({ pdf: state.pdf!, invoice: state.draft, lang });
    downloads.forEach((url) => URL.revokeObjectURL(url));
    downloads = [];
    const base = state.fileName.replace(/\.pdf$/i, '');
    link('#download-pdf', result.pdf as BlobPart, 'application/pdf', `${base}.einvoice.pdf`);
    link('#download-xml', result.xml, 'application/xml', `${base}.xml`);
    const digest = await crypto.subtle.digest('SHA-256', result.pdf as BufferSource);
    $('#checksum').textContent = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
    const notes = $('#done-notes');
    notes.replaceChildren(...result.findings.map((finding) => el('li', {}, describe(finding))));
    notes.hidden = result.findings.length === 0;
    status.textContent = '';
    // The finished page shows the same preview, with the stamp landing on it.
    const [from, to] = [$<HTMLCanvasElement>('#preview'), $<HTMLCanvasElement>('#done-preview')];
    Object.assign(to, { width: from.width, height: from.height });
    to.getContext('2d')!.drawImage(from, 0, 0);
    show('done');
  } catch (error) {
    status.textContent = t('create.failed', { m: error instanceof Error ? error.message : String(error) });
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
