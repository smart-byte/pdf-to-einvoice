// Opening a PDF: reading its text and layout, guessing the invoice, or showing an existing e-invoice.
import sampleUrl from '../../examples/sample-invoice.pdf?url';
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

/** Payment terms suggested when the PDF states neither a due date nor terms, in the language of the invoice. */
const USUAL_PAYMENT_TERMS = {
  de: 'Zahlbar innerhalb von 14 Tagen ab Rechnungsdatum.',
  en: 'Payable within 14 days of the invoice date.',
};

/** EN 16931 wants a due date or payment terms. Where the PDF has neither, the usual terms are put in as a suggestion the user has to confirm. */
function suggestPaymentTerms(): void {
  if (!isEmpty(state.draft.dueDate) || !isEmpty(state.draft.paymentTerms)) return;
  state.draft.paymentTerms = USUAL_PAYMENT_TERMS[languageOf(state.pdfText)];
  state.toCheck.set('paymentTerms', 'suggested');
}

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

async function open(pdf: Uint8Array, fileName: string): Promise<void> {
  const status = $('#drop-status');
  status.textContent = t('drop.reading');
  try {
    const info = await inspectPdf(pdf);
    const { text, blocks } = await extractLayout(pdf);
    forgetPages();
    closeXml();
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
      const { validateEInvoice } = await import('../../src/inspect/validate.js');
      const result = await validateEInvoice(pdf, { pdfText: text });
      state.draft = result.invoice ?? {};
      state.adjustedLines = result.adjustedLines ?? [];
      state.percentages = result.percentages ?? {};
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
      $('#read-status').textContent = text.trim()
        ? t(found === 1 ? 'read.found.one' : 'read.found', { n: found })
        : t('read.none');
    }
    document.body.dataset.mode = state.mode;
    setText('#work-title', state.mode === 'validate' ? 'valid.title' : 'work.title');
    setText('#work-lead', state.mode === 'validate' ? 'valid.lead' : 'work.lead');
    $('#file-name').textContent = fileName;
    $('#ai-status').textContent = '';
    renderForm();
    // Reading with a model is offered openly when the patterns left a lot to fill in.
    $<HTMLDetailsElement>('.reader details').open =
      (state.result?.findings.filter((finding) => finding.severity === 'error').length ?? 0) > 2;
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
$('#sample').onclick = async () =>
  open(new Uint8Array(await (await fetch(sampleUrl)).arrayBuffer()), 'sample-invoice.pdf');
$('#other').onclick = () => show('start');
