// Reading the invoice with a language model, in the browser or at an endpoint the user names.
import { keepWhatThePdfShows } from '../../src/extract/ground.js';
import { $, el } from './dom.js';
import { merge, normaliseDraft } from './draft.js';
import { renderForm } from './form.js';
import { lang, t } from '../shared/i18n.js';
import { DEFAULT_MODEL, hasWebGpu, MODELS, readWithBrowserModel, readWithEndpoint } from './model/llm.js';
import { scan } from './page.js';
import { state } from './state.js';

const modelSelect = $<HTMLSelectElement>('#ai-model');
/** Under the list: how large the chosen model is and where it comes from, or for an own service what it has to be, with its fields. */
function showModel(): void {
  const model = MODELS.find((candidate) => candidate.id === modelSelect.value);
  $('#ai-model-note').textContent = model
    ? t('ai.download', { size: new Intl.NumberFormat(lang).format(model.gigabytes) })
    : t('ai.endpoint.note');
  $('#ai-endpoint').hidden = model !== undefined;
}
export function renderModels(): void {
  // The choice stays when the language changes.
  const chosen = modelSelect.value || DEFAULT_MODEL;
  modelSelect.replaceChildren(
    ...MODELS.map((model) =>
      el(
        'option',
        { value: model.id, selected: model.id === chosen },
        `${model.id.replace(/-q4f16_1-MLC$/, '')} (${model.note[lang]})`,
      ),
    ),
    el('option', { value: 'endpoint', selected: chosen === 'endpoint' }, t('ai.endpoint')),
  );
  showModel();
}
modelSelect.onchange = showModel;

/**
 * Shows how far reading with a model is: below 1 the model is still loading and a bar says how much of it is there,
 * at 1 it reads and the band of light travels over the page. Once it writes its answer, `written` says how far that
 * is, and the bar is back for it. Without a number, reading is over.
 */
function reading(fraction?: number, written?: { fraction: number; line: number }): void {
  const loading = fraction !== undefined && fraction < 1;
  const bar = $<HTMLProgressElement>('#ai-progress');
  $('#ai-loading').hidden = !loading && !written;
  $('#ai-wait').hidden = !loading;
  $('#ai-cancel').hidden = fraction === undefined;
  bar.value = written?.fraction ?? fraction ?? 0;
  bar.setAttribute('aria-label', t(written ? 'ai.progress.answer' : 'ai.progress'));
  if (fraction !== undefined) {
    $('#ai-status').textContent = loading
      ? t('ai.loading', { p: Math.round(fraction * 100) })
      : !written
        ? t('ai.reading')
        : written.line
          ? t('ai.writing.line', { n: written.line })
          : t('ai.writing', { p: Math.round(written.fraction * 100) });
  }
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
          {
            url: address.value,
            model: $<HTMLInputElement>('#ai-name').value,
            key: $<HTMLInputElement>('#ai-key').value,
          },
          abort.signal,
        )
      : readWithBrowserModel(state.pdfText, modelSelect.value, reading, abort.signal, (written) => reading(1, written));
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
    status.textContent = abort.signal.aborted
      ? t('ai.cancelled')
      : t('ai.failed', { m: error instanceof Error ? error.message : String(error) });
  } finally {
    const refocus = document.activeElement === cancel;
    reading();
    button.disabled = false;
    if (refocus) button.focus();
    if (state.pdf !== pdf) status.textContent = '';
  }
};
