// The form: its fields, the line items, the discounts and charges, and the choice of what "Create" makes.
import { INVOICE_TYPES, VAT_CATEGORIES } from '../src/domain/model.js';
import { $, el, setText } from './dom.js';
import { getPath, isEmpty, setPath } from './draft.js';
import { validate } from './findings.js';
import { t } from './i18n.js';
import { focusedPath } from './page.js';
import { type Format, shownFormat, state } from './state.js';

type FieldType = 'text' | 'date' | 'number' | 'select' | 'email' | 'tel' | 'textarea';
interface Field {
  path: string;
  label: string;
  type?: FieldType;
  options?: [value: string, label: string][];
  wide?: boolean;
  /** A line under the field that says what goes in it. */
  help?: string;
  /** How many lines a text area shows while it is empty; 2 unless said otherwise. */
  rows?: number;
  /** Shown for this format only. */
  only?: Format;
  /** A list that may be left empty: its empty choice, worded so. Nothing is preset then. */
  blank?: string;
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
        // An e-mail address does not break: it gets a row of its own, and so does the field before it.
        { path: 'seller.taxNumber', label: 'f.taxNumber', wide: true },
        { path: 'seller.email', label: 'f.email', type: 'email', wide: true },
        { path: 'seller.contactName', label: 'f.contactName', only: 'xrechnung' },
        { path: 'seller.phone', label: 'f.phone', type: 'tel', only: 'xrechnung' },
      ] satisfies Field[])
    : ([
        { path: 'buyer.email', label: 'f.email', type: 'email', wide: true, only: 'xrechnung' },
        { path: 'buyer.contactName', label: 'f.contactName', only: 'xrechnung' },
        { path: 'buyer.phone', label: 'f.phone', type: 'tel', only: 'xrechnung' },
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
      { path: 'paymentTerms', label: 'f.paymentTerms', type: 'textarea', wide: true },
      { path: 'iban', label: 'f.iban' },
      { path: 'bic', label: 'f.bic' },
      { path: 'vatExemptionReason', label: 'f.vatExemptionReason', type: 'textarea', wide: true },
    ],
  },
  {
    title: 's.more',
    collapsed: true,
    fields: [
      { path: 'typeCode', label: 'f.typeCode', type: 'select', options: Object.keys(INVOICE_TYPES).map((code) => [code, `type.${code}`]), wide: true },
      { path: 'precedingInvoiceNumber', label: 'f.precedingInvoiceNumber' },
      { path: 'precedingInvoiceDate', label: 'f.precedingInvoiceDate', type: 'date' },
      { path: 'orderReference', label: 'f.orderReference' },
      { ...BUYER_REFERENCE, only: 'pdf' },
      { path: 'deliveryCountry', label: 'f.deliveryCountry', help: 'f.deliveryCountry.help' },
      { path: 'prepaidAmount', label: 'f.prepaidAmount', type: 'number' },
      { path: 'note', label: 'f.note', type: 'textarea', wide: true },
    ],
  },
];

const LINE_FIELDS: Field[] = [
  // A description may be a sentence: one line while it is short, more as it grows.
  { path: 'name', label: 'l.name', type: 'textarea', rows: 1, wide: true },
  { path: 'quantity', label: 'l.quantity', type: 'number' },
  { path: 'unit', label: 'l.unit', type: 'select', options: ['C62', 'HUR', 'DAY', 'MON', 'KGM', 'MTR', 'LTR', 'LS'].map((code) => [code, `unit.${code}`]) },
  { path: 'unitPrice', label: 'l.unitPrice', type: 'number' },
  { path: 'discount.percent', label: 'l.discountPercent', type: 'number' },
  { path: 'discount.amount', label: 'l.discountAmount', type: 'number' },
  { path: 'vatCategory', label: 'l.vatCategory', type: 'select', options: Object.keys(VAT_CATEGORIES).map((code) => [code, `vat.${code}`]) },
  { path: 'vatRate', label: 'l.vatRate', type: 'number' },
];

// Left empty, a discount or charge on the whole invoice follows the VAT of the line items: its category is not preset.
const ADJUSTMENT_FIELDS: Field[] = [
  { path: 'reason', label: 'a.reason', wide: true },
  { path: 'percent', label: 'a.percent', type: 'number' },
  { path: 'amount', label: 'a.amount', type: 'number' },
  { ...LINE_FIELDS.find((field) => field.path === 'vatCategory')!, blank: 'a.vatFollow' },
  { path: 'vatRate', label: 'l.vatRate', type: 'number' },
];

const SELECT_DEFAULTS: Record<string, string> = { typeCode: '380', unit: 'C62', vatCategory: 'S' };

function control(field: Field, path: string): HTMLElement {
  // An empty choice shows what will be used, not whichever option happens to come first.
  const value = getPath(state.draft, path) ?? (field.blank ? '' : SELECT_DEFAULTS[field.path]) ?? '';
  const id = `in-${path.replace(/\./g, '-')}`;
  let input: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
  if (field.type === 'select') {
    input = el('select', { id });
    if (field.blank) input.append(el('option', { value: '', selected: value === '' }, t(field.blank)));
    for (const [code, label] of field.options!) input.append(el('option', { value: code, selected: String(value) === code }, t(label)));
  } else if (field.type === 'textarea') {
    // A sentence wraps and the field grows with it, where one line would cut it off on a phone.
    input = el('textarea', { id, rows: field.rows ?? 2, value: String(value) });
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

/** Item `i` of a list is gone: the items below move up by one, and what was typed or is still to be checked moves with them. */
function moveUp(list: string, i: number): void {
  const moved = (path: string): string[] => {
    const at = new RegExp(`^${list}\\.(\\d+)(.*)$`).exec(path);
    if (!at || Number(at[1]) < i) return [path];
    return Number(at[1]) === i ? [] : [`${list}.${Number(at[1]) - 1}${at[2]}`];
  };
  state.toCheck = new Map([...state.toCheck].flatMap(([path, why]) => moved(path).map((to): [string, typeof why] => [to, why])));
  state.touched = new Set([...state.touched].flatMap(moved));
  state.touched.add(`${list}.removed`);
}

function renderLines(): HTMLElement {
  const list = el('div', { className: 'lines' });
  const lines = (state.draft.lines ??= [{}]);
  lines.forEach((_, i) => {
    const remove = el('button', { type: 'button', className: 'icon', title: t('l.remove', { n: i + 1 }) }, '×');
    remove.setAttribute('aria-label', t('l.remove', { n: i + 1 }));
    remove.onclick = () => {
      lines.splice(i, 1);
      moveUp('lines', i);
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

/** The discounts or the charges on the whole invoice, one frame each, and a button for one more. */
function renderAdjustments(list: 'discounts' | 'charges'): HTMLElement[] {
  const one = list === 'discounts' ? 'discount' : 'charge';
  const entries = state.draft[list] ?? [];
  const rows = entries.map((_, i) => {
    const remove = el('button', { type: 'button', className: 'icon', title: t(`a.remove.${one}`, { n: i + 1 }) }, '×');
    remove.setAttribute('aria-label', t(`a.remove.${one}`, { n: i + 1 }));
    remove.onclick = () => {
      entries.splice(i, 1);
      if (!entries.length) delete state.draft[list];
      moveUp(list, i);
      renderForm();
    };
    return el(
      'fieldset',
      { className: 'line line--adjustment' },
      el('legend', {}, t(`a.${one}`, { n: i + 1 })),
      ...ADJUSTMENT_FIELDS.map((field) => control(field, `${list}.${i}.${field.path}`)),
      remove,
      el('p', { className: 'hint', dataset: { hint: `${list}.${i}` } }),
    );
  });
  const add = el('button', { type: 'button', className: 'quiet' }, t(`a.add.${one}`));
  add.onclick = () => {
    const added = (state.draft[list] ??= []).push({}) - 1;
    state.touched.add(`${list}.added`);
    renderForm();
    document.querySelector<HTMLElement>(`[data-path="${list}.${added}.reason"]`)?.focus();
  };
  return [...rows, add, el('p', { className: 'hint', dataset: { hint: list } })];
}

export function renderForm(): void {
  const form = $('#form');
  const expanded = new Set([...form.querySelectorAll('details[open]')].map((d) => (d as HTMLElement).dataset.section));
  const focused = focusedPath();
  form.replaceChildren();
  /** `unfolded` is given for a group that can be folded: whether it starts open. */
  const section = (title: string, body: HTMLElement, unfolded?: boolean) => {
    if (unfolded === undefined) return el('section', { className: 'group' }, el('h3', {}, t(title)), body);
    const details = el(
      'details',
      { className: 'group', dataset: { section: title }, open: unfolded || expanded.has(title) },
      el('summary', {}, t(title)),
      body,
    );
    return details;
  };
  const format = shownFormat();
  // Nothing goes into the file unseen: a field the format does not ask for is shown while it holds a value, and a
  // group of further fields is open while one of them does.
  const asked = (field: Field) => (field.only ?? format) === format;
  const paths = new Set(SECTIONS.flatMap(({ fields }) => fields.filter(asked).map((field) => field.path)));
  const filled = (field: Field) => !isEmpty(getPath(state.draft, field.path));
  const [invoice, seller, buyer, payment, more] = SECTIONS.map(({ title, fields, collapsed }) => {
    const shown = fields.filter((field) => asked(field) || (filled(field) && !paths.has(field.path)));
    return section(title, el('div', { className: 'fields' }, ...shown.map((field) => control(field, field.path))), collapsed ? shown.some(filled) : undefined);
  });
  // Discounts and charges on the whole invoice: folded away until there is one. An existing e-invoice shows them only where it has them.
  const adjusted = Boolean(state.draft.discounts?.length || state.draft.charges?.length);
  const adjustments =
    state.mode === 'validate' && !adjusted
      ? []
      : [section('s.adjustments', el('div', { className: 'lines' }, ...renderAdjustments('discounts'), ...renderAdjustments('charges')), adjusted)];
  form.append(invoice!, seller!, buyer!, section('s.lines', renderLines()), ...adjustments, payment!, more!);
  if (state.mode === 'validate') {
    // Read only rather than disabled: a field can still take the focus, which shows where its value stands on the page.
    for (const field of form.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('input, textarea')) field.readOnly = true;
    for (const field of form.querySelectorAll<HTMLSelectElement | HTMLButtonElement>('select, button')) field.disabled = true;
    for (const details of form.querySelectorAll('details')) details.open = true;
  }
  // Whoever was typing while a model read the invoice goes on typing in the same field.
  if (focused) form.querySelector<HTMLElement>(`[data-path="${focused}"]`)?.focus();
  validate();
}

// The form is never sent anywhere: Enter in a field must not reload the page.
$('#form').addEventListener('submit', (event) => event.preventDefault());
$('#form').addEventListener('input', (event) => {
  const input = event.target as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
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
