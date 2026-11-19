// Findings and totals: what the check says, at each field, in the totals and in the summary.
import { check, type CheckResult } from '../../src/domain/check.js';
import type { Finding } from '../../src/domain/finding.js';
import { $, el } from './dom.js';
import { t } from '../shared/i18n.js';
import { focusedPath, highlight, point, renderMarks, turnTo } from './page.js';
import { shownFormat, state } from './state.js';
import { refreshXml } from './xml.js';
import { describe, fieldLabel, money } from './wording.js';

/** The field of a path; the first field of a line item, discount or charge for the path of all of it, or of a value of it the form does not show. */
const fieldOf = (path: string) => {
  const item = /^(lines|discounts|charges)\.\d+/.exec(path)?.[0];
  return document.querySelector<HTMLElement>(`[data-path="${path}"]`) ?? (item ? document.querySelector<HTMLElement>(`[data-path^="${item}."]`) : null);
};

/** Checks the form and shows the result: a hint at each field, the totals, and a summary with what is left to do. */
export function validate(): void {
  const result = (state.result = check(state.draft, {
    ...(state.pdf ? { pdfText: state.pdfText } : {}),
    ...(shownFormat() === 'xrechnung' ? { rules: 'xrechnung' as const } : {}),
    ...(state.mode === 'validate' ? { adjustedLines: state.adjustedLines ?? [], percentages: state.percentages ?? {} } : {}),
  }));
  const unchecked = uncheckedFindings();
  const findings = findingsToShow(result, unchecked);
  renderHints(findings, unchecked);
  renderTotals(result, findings);
  const { errors, warnings } = summarise(findings, unchecked);
  renderSummary(errors, warnings);
  $<HTMLButtonElement>('#create').disabled = errors.length > 0 || !state.pdf;
  // The stamp reads like a seal: an existing e-invoice gets it only where the check found nothing at all.
  $('#work-stamp').hidden = !(state.mode === 'validate' && errors.length === 0 && warnings.length === 0);
  renderMarks();
  refreshXml();
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
    finding.code === 'address' && result.findings.some((other) => other.code === 'xrechnung-address' && other.path === finding.path);
  return [...result.findings.filter((finding) => !demanded(finding)), ...state.fileFindings, ...unchecked];
}

/** At each field the worst of its findings, and for a value still to be checked a button to confirm it. */
function renderHints(findings: Finding[], unchecked: Finding[]): void {
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
  const errors = findings.filter((f) => f.severity === 'error');
  const added = unchecked.filter((f) => f.code === 'model');
  const warnings = findings.filter((f) => f.severity === 'warning' && !added.includes(f));
  if (added.length) warnings.push({ ...added[0]!, message: t(added.length === 1 ? 'sum.model.one' : 'sum.model', { n: added.length }) });
  return { errors, warnings };
}

/** The summary: how many errors and warnings, and each of them as a link to its field. */
function renderSummary(errors: Finding[], warnings: Finding[]): void {
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
}
