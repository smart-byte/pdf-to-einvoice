// Opening a PDF: reading its text and layout, guessing the invoice, or showing an existing e-invoice.
import sampleUrl from '../../examples/sample-invoice.pdf?url';
import type { Finding } from '../../src/domain/finding.js';
import { guessFromText, languageOf } from '../../src/extract/guess.js';
import { inspectPdf } from '../../src/pdf/file.js';
import { extractLayout } from '../../src/pdf/text.js';
import { $, setText, show } from './dom.js';
import { isEmpty, merge } from './draft.js';
import { renderForm } from './form.js';
import { t } from '../shared/i18n.js';
import { forgetPages, preview, scan } from './page.js';
import { state } from './state.js';
import { closeXml } from './xml.js';

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
$('#sample').onclick = async () =>
  open(new Uint8Array(await (await fetch(sampleUrl)).arrayBuffer()), 'sample-invoice.pdf');
$('#other').onclick = () => show('start');

/** Opens a PDF: reads it, starts over with it, and shows the work on it with its preview. */
async function open(pdf: Uint8Array, fileName: string): Promise<void> {
  const status = $('#drop-status');
  status.textContent = t('drop.reading');
  try {
    const info = await inspectPdf(pdf);
    const { text, blocks } = await extractLayout(pdf);
    startOver(pdf, fileName, text, info.embeddedXml === null ? 'create' : 'validate');
    if (state.mode === 'validate') await showExisting(pdf, text);
    else readNew(text, blocks);
    showWork(fileName);
    await preview(pdf);
    status.textContent = '';
    // The patterns have read the page: one pass of the light shows it.
    if (state.mode === 'create' && text.trim()) scan('once');
  } catch (error) {
    console.error(error);
    status.textContent = t('e.invalid-pdf');
  }
}

/** Forgets the file before: the page starts over with the one that was opened. */
function startOver(pdf: Uint8Array, fileName: string, pdfText: string, mode: 'create' | 'validate'): void {
  forgetPages();
  closeXml();
  Object.assign(state, {
    pdf,
    fileName,
    pdfText,
    draft: {},
    touched: new Set(),
    fileFindings: [],
    toCheck: new Map(),
    mode,
    result: undefined,
  });
}

/** The PDF already is an e-invoice: what its XML says is shown, next to the page it belongs to. */
async function showExisting(pdf: Uint8Array, text: string): Promise<void> {
  const { validateEInvoice } = await import('../../src/inspect/validate.js');
  const result = await validateEInvoice(pdf, { pdfText: text });
  const aboutFile = (finding: Finding) => FILE_CODES.has(finding.code);
  state.draft = result.invoice ?? {};
  state.fileFindings = result.findings.filter(aboutFile);
  // Nothing of an existing e-invoice can be changed, so what the check of its data found stays: it is not run again.
  state.result = { findings: result.findings.filter((finding) => !aboutFile(finding)), totals: result.totals };
  $('#read-status').textContent = result.profile ? t('valid.profile', { p: result.profile }) : '';
}

/** A plain PDF: the invoice is read from its text, and what the page lacks is suggested. */
function readNew(text: string, blocks: string[][]): void {
  merge(state, guessFromText(text, { blocks }));
  // What was read from the PDF, before anything is suggested.
  const found = JSON.stringify(state.draft).match(/":("|\d|-)/g)?.length ?? 0;
  // An invoice that shows no VAT gets its VAT category from the buyer's country, the same for every line: a person
  // confirms it at the first line.
  if ((state.draft.lines?.[0]?.vatCategory ?? 'S') !== 'S') state.toCheck.set('lines.0.vatCategory', 'inferred');
  suggestPaymentTerms();
  if (!text.trim()) $('#read-status').textContent = t('read.none');
  else $('#read-status').textContent = t(found === 1 ? 'read.found.one' : 'read.found', { n: found });
}

/** EN 16931 wants a due date or payment terms. Where the PDF has neither, the usual terms are put in as a suggestion the user has to confirm. */
function suggestPaymentTerms(): void {
  if (!isEmpty(state.draft.dueDate) || !isEmpty(state.draft.paymentTerms)) return;
  state.draft.paymentTerms = USUAL_PAYMENT_TERMS[languageOf(state.pdfText)];
  state.toCheck.set('paymentTerms', 'suggested');
}

/** The view of the work on one file: its title, the form, and the reader offered where much is left to fill in. */
function showWork(fileName: string): void {
  const existing = state.mode === 'validate';
  document.body.dataset.mode = state.mode;
  setText('#work-title', existing ? 'valid.title' : 'work.title');
  setText('#work-lead', existing ? 'valid.lead' : 'work.lead');
  $('#file-name').textContent = fileName;
  $('#ai-status').textContent = '';
  renderForm();
  // Reading with a model is offered openly when the patterns left a lot to fill in.
  const errors = state.result?.findings.filter((finding) => finding.severity === 'error').length ?? 0;
  $<HTMLDetailsElement>('.reader details').open = errors > 2;
  show('work');
}

/** Payment terms suggested when the PDF states neither a due date nor terms, in the language of the invoice. */
const USUAL_PAYMENT_TERMS = {
  de: 'Zahlbar innerhalb von 14 Tagen ab Rechnungsdatum.',
  en: 'Payable within 14 days of the invoice date.',
};

/** Findings that are about the file, not about a field of the form. */
const FILE_CODES = new Set([
  'no-xml',
  'xml-syntax',
  'profile',
  'pdf-a',
  'pdf-fonts',
  'pdf-actions',
  'xml-discount',
  'xml-charge',
]);
