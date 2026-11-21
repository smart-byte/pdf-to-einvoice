// Findings and totals: what the check says, at each field, in the totals and in the summary.
import { check, type CheckResult } from '../../src/domain/check.js';
import type { Finding } from '../../src/domain/finding.js';
import { $, el } from './dom.js';
import { t } from '../shared/i18n.js';
import { focusedPath, highlight, point, renderMarks, turnTo } from './page.js';
import { confirm, setResult, shownFormat, state } from './state.js';
import { refreshXml } from './xml.js';
import { describe, fieldLabel, formatMoney } from './wording.js';

/** How many errors and warnings the summary lists since the form was last checked. */
let listed = 0;

/** Checks the form and shows the result: a hint at each field, the totals, and a summary with what is left to do. */
export function validate(): void {
  const result = checked();
  setResult(result);
  const unchecked = uncheckedFindings();
  const findings = findingsToShow(result, unchecked);
  renderHints(findings, unchecked);
  renderTotals(result, findings);
  const { errors, warnings } = summarise(findings, unchecked);
  renderSummary(errors, warnings);
  listed = errors.length + warnings.length;
  $<HTMLButtonElement>('#create').disabled = errors.length > 0 || !state.pdf;
  // The stamp reads like a seal: an existing e-invoice gets it only where the check found nothing at all.
  $('#work-stamp').hidden = !(state.mode === 'validate' && errors.length === 0 && warnings.length === 0);
  renderMarks();
  refreshXml();
}

/** Whether the summary lists anything: an error, a warning, or a value still to be checked. */
export function anythingFound(): boolean {
  return listed > 0;
}

/**
 * What the check says about the form as it is now. An existing e-invoice was checked when it was opened, with what
 * its XML states beyond the data (open.ts), and nothing of it can change: that result stays.
 */
function checked(): CheckResult {
  if (state.mode === 'validate' && state.result) return state.result;
  return check(state.draft, {
    ...(state.pdf ? { pdfText: state.pdfText } : {}),
    ...(shownFormat() === 'xrechnung' ? { rules: 'xrechnung' as const } : {}),
  });
}

/**
 * What nobody has looked at yet, said at its field. A model may have read a value the form has no field for: that one
 * is not counted. A suggestion is not on the PDF at all: it stands in the way of creating until it is confirmed or
 * changed.
 */
function uncheckedFindings(): Finding[] {
  return [...state.toCheck]
    .filter(([path]) => document.querySelector(`[data-hint="${path}"]`))
    .map(([path, why]) => ({
      path,
      severity: why === 'suggested' ? 'error' : 'warning',
      code: why,
      message: t(why === 'model' && /^lines\.\d+$/.test(path) ? 'hint.model.line' : `hint.${why}`),
    }));
}

/** What the check found, what the file itself has, and what is still to be looked at. */
function findingsToShow(result: CheckResult, unchecked: Finding[]): Finding[] {
  // Where XRechnung demands a part of the address, the warning that it is missing would only say the same again.
  const demanded = (finding: Finding) =>
    finding.code === 'address' &&
    result.findings.some((other) => other.code === 'xrechnung-address' && other.path === finding.path);
  return [...result.findings.filter((finding) => !demanded(finding)), ...state.fileFindings, ...unchecked];
}

/** At each field the worst of its findings, and for a value still to be checked a button to confirm it. */
function renderHints(findings: Finding[], unchecked: Finding[]): void {
  for (const hint of document.querySelectorAll<HTMLElement>('[data-hint]')) {
    const path = hint.dataset.hint!;
    const own = findings.filter((finding) => finding.path === path);
    const worst = own.find((finding) => finding.severity === 'error') ?? own[0];
    hint.textContent = worst ? describe(worst) : '';
    hint.className = `hint${worst ? ` hint--${worst.severity}` : ''}`;
    const input = document.querySelector<HTMLElement>(`[data-path="${path}"]`);
    input?.toggleAttribute('aria-invalid', worst?.severity === 'error');
    input?.classList.toggle('warned', worst?.severity === 'warning');
    // The hint of a whole line item: its frame says so too.
    if (hint.parentElement?.matches('.line'))
      hint.parentElement.classList.toggle(
        'line--check',
        unchecked.some((finding) => finding.path === path),
      );
    // A value that is still to be checked can be ticked off where it stands, without typing it again.
    if (worst && unchecked.includes(worst) && state.mode === 'create') hint.append(' ', confirmButton(path));
  }
}

/** The button that ticks off a value still to be checked, and goes back to its field. */
function confirmButton(path: string): HTMLElement {
  const ok = el('button', { type: 'button', className: 'ok' }, t('hint.ok'));
  ok.setAttribute('aria-label', t('hint.ok.label', { f: fieldLabel(path) }));
  ok.onclick = () => {
    confirm(path);
    validate();
    fieldOf(path)?.focus();
  };
  return ok;
}

/** The calculated totals, each beside what the PDF or the XML states where the two differ. */
function renderTotals(result: CheckResult, findings: Finding[]): void {
  const totals = $('#totals');
  totals.replaceChildren();
  if (!result.totals) {
    totals.append(el('p', { className: 'muted' }, t('t.empty')));
    return;
  }
  const printed = (state.draft.totals ?? {}) as Record<string, number | undefined>;
  for (const key of ['net', 'vat', 'gross', 'due'] as const) {
    const mismatch = findings.some((finding) => finding.path === `totals.${key}`);
    const row = el(
      'div',
      { className: `total${key === 'gross' ? ' total--main' : ''}${mismatch ? ' total--off' : ''}` },
      el('dt', {}, t(`t.${key}`)),
      el('dd', {}, formatMoney(result.totals[key])),
    );
    // An existing e-invoice states its totals in its XML; for a PDF they are what the page prints.
    const printedAs = state.mode === 'validate' ? 't.printed.xml' : 't.printed';
    if (mismatch && typeof printed[key] === 'number')
      row.append(el('dd', { className: 'total__printed' }, t(printedAs, { v: formatMoney(printed[key]!) })));
    // A total has no field to focus: pointing at it shows where it stands, on whichever page that is.
    row.onmouseenter = () => {
      const path = `totals.${key}`;
      point(path);
      turnTo(path);
      highlight(path);
    };
    row.onmouseleave = () => {
      point();
      highlight(focusedPath());
    };
    totals.append(row);
  }
}

/** The errors and the warnings of the summary. What a model added is one thing to check, however many values it is. */
function summarise(findings: Finding[], unchecked: Finding[]): { errors: Finding[]; warnings: Finding[] } {
  const errors = findings.filter((finding) => finding.severity === 'error');
  const added = unchecked.filter((finding) => finding.code === 'model');
  const warnings = findings.filter((finding) => finding.severity === 'warning' && !added.includes(finding));
  if (added.length)
    warnings.push({
      ...added[0]!,
      message: t(added.length === 1 ? 'sum.model.one' : 'sum.model', { n: added.length }),
    });
  return { errors, warnings };
}

/** The summary: how many errors and warnings, and each of them as a link to its field. */
function renderSummary(errors: Finding[], warnings: Finding[]): void {
  const summary = $('#summary');
  const tone = warnings.length ? 'warning' : 'ok';
  summary.className = `summary summary--${errors.length ? 'error' : tone}`;
  summary.replaceChildren(el('p', { className: 'summary__title' }, headlineOf(errors, warnings)));
  const list = el('ul', {}, ...[...errors, ...warnings].map(summaryItem));
  if (list.children.length) summary.append(list);
}

/** How many errors and warnings there are, or that all is well. */
function headlineOf(errors: Finding[], warnings: Finding[]): string {
  const count = (key: string, n: number) => (n ? t(n === 1 ? `${key}.one` : key, { n }) : '');
  const headline = [
    count(state.mode === 'validate' ? 'valid.errors' : 'sum.errors', errors.length),
    count('sum.warnings', warnings.length),
  ]
    .filter(Boolean)
    .join(' · ');
  return headline || t(state.mode === 'validate' ? 'sum.valid' : 'sum.ok');
}

/** A finding of the summary, as a link to its field where it has one. */
function summaryItem(finding: Finding): HTMLElement {
  // The sentence about what a model added speaks for all those values; it leads to the first of them.
  const where = finding.code === 'model' ? '' : fieldLabel(finding.path);
  const text = `${where ? `${where}: ` : ''}${describe(finding)}`;
  const target = fieldOf(finding.path);
  const item = el('li', { className: finding.severity });
  if (!target) {
    item.append(text);
    return item;
  }
  const jump = el('button', { type: 'button', className: 'link' }, text);
  jump.onclick = () => {
    target.closest('details')?.setAttribute('open', '');
    target.focus();
  };
  item.append(jump);
  return item;
}

/** The field of a path; the first field of a line item, discount or charge for the path of all of it, or of a value of it the form does not show. */
function fieldOf(path: string): HTMLElement | null {
  const item = /^(lines|discounts|charges)\.\d+/.exec(path)?.[0];
  return (
    document.querySelector<HTMLElement>(`[data-path="${path}"]`) ??
    (item ? document.querySelector<HTMLElement>(`[data-path^="${item}."]`) : null)
  );
}
