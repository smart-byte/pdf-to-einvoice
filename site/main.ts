import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import pdfWorkerUrl from 'pdfjs-dist/legacy/build/pdf.worker.mjs?url';
import sampleUrl from '../examples/sample-invoice.pdf?url';
import { check, type CheckResult, type Finding } from '../src/check.js';
import { keepWhatThePdfShows } from '../src/ground.js';
import { guessFromText, languageOf } from '../src/guess.js';
import { INVOICE_TYPES, VAT_CATEGORIES, type InvoiceDraft } from '../src/model.js';
import { inspectPdf } from '../src/pdf.js';
import { extractText } from '../src/text.js';
import { lang, setLang, t } from './i18n.js';
import { DEFAULT_MODEL, MODELS, hasWebGpu, readWithBrowserModel, readWithEndpoint } from './llm.js';
import './styles.css';

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
    for (const field of form.querySelectorAll<HTMLInputElement>('input, select, button')) field.disabled = true;
    for (const details of form.querySelectorAll('details')) details.open = true;
  }
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
}

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
  await task.destroy();
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
    const text = await extractText(pdf);
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
      merge(guessFromText(text));
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

$('#ai-run').onclick = async () => {
  const status = $('#ai-status');
  const button = $<HTMLButtonElement>('#ai-run');
  const viaEndpoint = modelSelect.value === 'endpoint';
  if (!viaEndpoint && !hasWebGpu()) return void (status.textContent = t('ai.nogpu'));
  button.disabled = true;
  try {
    const read = viaEndpoint
      ? (status.textContent = t('ai.reading')) &&
        readWithEndpoint(state.pdfText, {
          url: $<HTMLInputElement>('#ai-url').value,
          model: $<HTMLInputElement>('#ai-name').value,
          key: $<HTMLInputElement>('#ai-key').value,
        })
      : readWithBrowserModel(state.pdfText, modelSelect.value, (fraction) => {
          status.textContent = fraction < 1 ? t('ai.loading', { p: Math.round(fraction * 100) }) : t('ai.reading');
        });
    // A small model translates names and makes up identifiers. Only what the PDF shows is taken over.
    merge(keepWhatThePdfShows(normaliseDraft(await read), state.pdfText), true);
    renderForm();
    status.textContent = t('ai.done');
  } catch (error) {
    status.textContent = t('ai.failed', { m: error instanceof Error ? error.message : String(error) });
  } finally {
    button.disabled = false;
  }
};

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
// Language

function applyLang(next: 'de' | 'en'): void {
  setLang(next);
  for (const button of document.querySelectorAll<HTMLButtonElement>('[data-lang]')) button.setAttribute('aria-pressed', String(button.dataset.lang === next));
  renderModels();
  if (state.pdf) renderForm();
}
for (const button of document.querySelectorAll<HTMLButtonElement>('[data-lang]')) button.onclick = () => applyLang(button.dataset.lang as 'de' | 'en');
applyLang(lang);
