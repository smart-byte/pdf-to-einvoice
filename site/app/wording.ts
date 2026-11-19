// How the page words what the library says: findings in the language of the page, errors, amounts, field names.
import type { Finding } from '../../src/domain/finding.js';
import { isCurrencyCode } from '../../src/domain/formats.js';
import { lang, STRINGS, t } from '../shared/i18n.js';
import { state } from './state.js';

/**
 * A finding, or an error of the library, in the language of the page: in German the text for its code, worded for its
 * field where there is one (`e.format.iban`), else the English message of the library. An existing e-invoice has words
 * of its own where a finding is about its XML (`e.totals-mismatch.xml`), in English as well. A German text takes what
 * it names from the values of the finding (`params`), the amounts as the check calculated them; only a message of the
 * library that writes the XML is passed on as it is.
 */
export function describe(finding: Pick<Finding, 'code' | 'message' | 'params'> & { path?: string }): string {
  const path = finding.path ?? '';
  const candidates = [`e.${finding.code}.${path.split('.').at(-1)}`, `e.${finding.code}`];
  if (state.mode === 'validate') candidates.unshift(`e.${finding.code}.xml`);
  const key = candidates.find((candidate) => candidate in STRINGS);
  if (!key || (lang !== 'de' && !STRINGS[key]?.en)) return finding.message;
  const { expected, stated, value } = finding.params ?? {};
  const money = (amount: unknown) => (amount === undefined ? '' : formatMoney(Number(amount)));
  return t(key, {
    a: money(expected),
    b: money(stated),
    v: value === undefined ? '' : String(value),
    m: finding.message,
  });
}
/** Why creating failed. An error of the library carries a code, and the page has a sentence for each. */
export const reasonOf = (error: unknown) =>
  error instanceof Error && error.name === 'InvoiceError'
    ? describe(error as Error & { code: string })
    : error instanceof Error
      ? error.message
      : String(error);
export const formatMoney = (n: number) =>
  new Intl.NumberFormat(lang, {
    style: 'currency',
    currency: isCurrencyCode(state.draft.currency) ? state.draft.currency : 'EUR',
  }).format(n);

export function fieldLabel(path: string): string {
  const input = document.querySelector<HTMLElement>(`[data-path="${path}"]`);
  const label = input && document.querySelector(`label[for="${input.id}"]`)?.textContent;
  // A line item is named by its number, also for a value of it the form does not show, such as its total. So is a discount or charge.
  const item = /^(lines|discounts|charges)\.(\d+)(\.|$)/.exec(path);
  const items: Record<string, string> = { lines: 'l.item', discounts: 'a.discount', charges: 'a.charge' };
  if (item) return `${t(items[item[1]!]!, { n: Number(item[2]) + 1 })}${label ? `, ${label}` : ''}`;
  // Seller and buyer have fields of the same name: the party is named first.
  const who = /^(seller|buyer)\./.exec(path)?.[1];
  if (label) return who ? `${t(who === 'seller' ? 'xml.seller' : 's.buyer')}, ${label}` : label;
  return path.startsWith('totals.') ? t(`t.${path.slice(7)}`) : path === 'lines' ? t('s.lines') : '';
}
