// The form: its fields, the line items, the discounts and charges, and the choice of what "Create" makes.
import { INVOICE_TYPES, VAT_CATEGORIES } from '../../src/domain/model.js';
import { $, el, setText } from './dom.js';
import { valueAt } from '../../src/util/objects.js';
import { isEmpty } from './draft.js';
import { validate } from './findings.js';
import { t } from '../shared/i18n.js';
import { focusedPath } from './page.js';
import { addItem, chooseFormat, enter, type Format, removeItem, shownFormat, state } from './state.js';

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

type Section = { title: string; fields: Field[]; collapsed?: boolean };

// What "Create" makes. Switching keeps every value: the form shows and checks what the chosen format asks for.
const formats = [...document.querySelectorAll<HTMLInputElement>('input[name="format"]')];
for (const radio of formats) {
  radio.onchange = () => {
    chooseFormat(radio.value as Format);
    showFormat();
    renderForm();
  };
}
showFormat();

// The form is never sent anywhere: Enter in a field must not reload the page.
$('#form').addEventListener('submit', (event) => event.preventDefault());
$('#form').addEventListener('input', (event) => {
  const input = event.target as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
  const path = input.dataset.path;
  if (!path) return;
  enter(path, valueOf(input));
  validate();
});

export function renderForm(): void {
  const form = $('#form');
  const expanded = new Set([...form.querySelectorAll('details[open]')].map((d) => (d as HTMLElement).dataset.section));
  const focused = focusedPath();
  form.replaceChildren();
  const [before, after] = [renderSections(BEFORE_LINES, expanded), renderSections(AFTER_LINES, expanded)];
  form.append(...before, section('s.lines', renderLines(), expanded), ...adjustmentSection(expanded), ...after);
  if (state.mode === 'validate') readOnly(form);
  // Whoever was typing while a model read the invoice goes on typing in the same field.
  if (focused) form.querySelector<HTMLElement>(`[data-path="${focused}"]`)?.focus();
  validate();
}

/** The groups that were open, by their title: they stay open when the form is drawn again. */
type Expanded = Set<string | undefined>;

/**
 * Groups of fields. Nothing goes into the file unseen: a field the format does not ask for is shown while it holds a
 * value, and a group of further fields is open while one of them does.
 */
function renderSections(sections: Section[], expanded: Expanded): HTMLElement[] {
  const format = shownFormat();
  const asked = (field: Field) => (field.only ?? format) === format;
  const paths = new Set(
    [...BEFORE_LINES, ...AFTER_LINES].flatMap(({ fields }) => fields.filter(asked).map((field) => field.path)),
  );
  const filled = (field: Field) => !isEmpty(valueAt(state.draft, field.path));
  return sections.map(({ title, fields, collapsed }) => {
    const shown = fields.filter((field) => asked(field) || (filled(field) && !paths.has(field.path)));
    return section(
      title,
      el('div', { className: 'fields' }, ...shown.map((field) => control(field, field.path))),
      expanded,
      collapsed ? shown.some(filled) : undefined,
    );
  });
}

/** A group of the form. `unfolded` is given for a group that can be folded: whether it starts open. */
function section(title: string, body: HTMLElement, expanded: Expanded, unfolded?: boolean): HTMLElement {
  if (unfolded === undefined) return el('section', { className: 'group' }, el('h3', {}, t(title)), body);
  return el(
    'details',
    { className: 'group', dataset: { section: title }, open: unfolded || expanded.has(title) },
    el('summary', {}, t(title)),
    body,
  );
}

/** Discounts and charges on the whole invoice: folded away until there is one. An existing e-invoice shows them only where it has them. */
function adjustmentSection(expanded: Expanded): HTMLElement[] {
  const adjusted = Boolean(state.draft.discounts?.length || state.draft.charges?.length);
  if (state.mode === 'validate' && !adjusted) return [];
  const body = el('div', { className: 'lines' }, ...renderAdjustments('discounts'), ...renderAdjustments('charges'));
  return [section('s.adjustments', body, expanded, adjusted)];
}

function renderLines(): HTMLElement {
  const list = el('div', { className: 'lines' });
  (state.draft.lines ?? []).forEach((_, i) => {
    const remove = el('button', { type: 'button', className: 'icon', title: t('l.remove', { n: i + 1 }) }, '×');
    remove.setAttribute('aria-label', t('l.remove', { n: i + 1 }));
    remove.onclick = () => {
      removeItem('lines', i);
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
    addItem('lines');
    renderForm();
  };
  list.append(add, el('p', { className: 'hint', dataset: { hint: 'lines' } }));
  return list;
}

/** The discounts or the charges on the whole invoice, one frame each, and a button for one more. */
function renderAdjustments(list: 'discounts' | 'charges'): HTMLElement[] {
  const one = list === 'discounts' ? 'discount' : 'charge';
  const rows = (state.draft[list] ?? []).map((_, i) => {
    const remove = el('button', { type: 'button', className: 'icon', title: t(`a.remove.${one}`, { n: i + 1 }) }, '×');
    remove.setAttribute('aria-label', t(`a.remove.${one}`, { n: i + 1 }));
    remove.onclick = () => {
      removeItem(list, i);
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
    const added = addItem(list);
    renderForm();
    document.querySelector<HTMLElement>(`[data-path="${list}.${added}.reason"]`)?.focus();
  };
  return [...rows, add, el('p', { className: 'hint', dataset: { hint: list } })];
}

/** Read only rather than disabled: a field can still take the focus, which shows where its value stands on the page. */
function readOnly(form: HTMLElement): void {
  for (const field of form.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('input, textarea'))
    field.readOnly = true;
  for (const field of form.querySelectorAll<HTMLSelectElement | HTMLButtonElement>('select, button'))
    field.disabled = true;
  for (const details of form.querySelectorAll('details')) details.open = true;
}

function control(field: Field, path: string): HTMLElement {
  // An empty choice shows what will be used, not whichever option happens to come first.
  const value = valueAt(state.draft, path) ?? (field.blank ? '' : SELECT_DEFAULTS[field.path]) ?? '';
  const id = `in-${path.replace(/\./g, '-')}`;
  const input = inputOf(field, id, value);
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

/** The input of a field, holding `value`: a choice, a text that wraps, or a line. */
function inputOf(field: Field, id: string, value: unknown): HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement {
  if (field.type === 'select') return selectOf(field, id, value);
  // A sentence wraps and the field grows with it, where one line would cut it off on a phone.
  if (field.type === 'textarea') return el('textarea', { id, rows: field.rows ?? 2, value: String(value) });
  const input = el('input', { id, type: field.type ?? 'text', value: String(value), autocomplete: 'off' });
  if (field.type === 'number') input.step = 'any';
  return input;
}

function selectOf(field: Field, id: string, value: unknown): HTMLSelectElement {
  const select = el('select', { id });
  if (field.blank) select.append(el('option', { value: '', selected: value === '' }, t(field.blank)));
  for (const [code, label] of field.options!)
    select.append(el('option', { value: code, selected: String(value) === code }, t(label)));
  return select;
}

/** The value of a field as the data holds it: a number field as a number, or nothing while it is empty. */
function valueOf(input: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement): string | number | undefined {
  if ((input as HTMLInputElement).type !== 'number') return input.value.trim();
  return input.value === '' ? undefined : Number(input.value);
}

function showFormat(): void {
  for (const radio of formats) radio.checked = radio.value === state.format;
  $('#format-note').hidden = state.format !== 'xrechnung';
  setText('#create', state.format === 'xrechnung' ? 'create.run.xr' : 'create.run');
}

// The fields of the form. The functions above use them only when the form is drawn, so they may stand below them.

// XRechnung asks for the buyer reference up front, beside the buyer; for the hybrid PDF it is one of the further fields.
const BUYER_REFERENCE: Field = { path: 'buyerReference', label: 'f.buyerReference', help: 'f.buyerReference.help' };

/** The fields of a party: its address and VAT ID, and the contact data XRechnung asks for. */
function party(who: 'seller' | 'buyer'): Field[] {
  return [
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
}

/** The groups of fields above the line items. */
const BEFORE_LINES: Section[] = [
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
];
/** The groups of fields below the line items and the discounts and charges. */
const AFTER_LINES: Section[] = [
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
      {
        path: 'typeCode',
        label: 'f.typeCode',
        type: 'select',
        options: Object.keys(INVOICE_TYPES).map((code) => [code, `type.${code}`]),
        wide: true,
      },
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
  {
    path: 'unit',
    label: 'l.unit',
    type: 'select',
    options: ['C62', 'HUR', 'DAY', 'MON', 'KGM', 'MTR', 'LTR', 'LS'].map((code) => [code, `unit.${code}`]),
  },
  { path: 'unitPrice', label: 'l.unitPrice', type: 'number' },
  { path: 'discount.percent', label: 'l.discountPercent', type: 'number' },
  { path: 'discount.amount', label: 'l.discountAmount', type: 'number' },
  {
    path: 'vatCategory',
    label: 'l.vatCategory',
    type: 'select',
    options: Object.keys(VAT_CATEGORIES).map((code) => [code, `vat.${code}`]),
  },
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
