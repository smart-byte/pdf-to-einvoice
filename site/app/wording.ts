// How the page words what the library says: findings in the language of the page, errors, amounts, field names.
import { lineBase, percentOf } from '../../src/domain/calculate.js';
import { lang, STRINGS, t } from '../shared/i18n.js';
import { state } from './state.js';

/**
 * A finding, or an error of the library, in the language of the page: in German the text for its code, worded for its
 * field where there is one (`e.format.iban`), else the English message of the library. An existing e-invoice has words
 * of its own where a finding is about its XML (`e.totals-mismatch.xml`), in English as well. What a German text names,
 * it takes from the data rather than from the English sentence; only the value a message quotes and a message of the
 * library that writes the XML are passed on as they are.
 */
export function describe(finding: { code: string; message: string; path?: string }): string {
  const path = finding.path ?? '';
  const candidates = [`e.${finding.code}.${path.split('.').at(-1)}`, `e.${finding.code}`];
  if (state.mode === 'validate') candidates.unshift(`e.${finding.code}.xml`);
  const key = candidates.find((candidate) => candidate in STRINGS);
  if (!key || (lang !== 'de' && !STRINGS[key]?.en)) return finding.message;
  const line = state.draft.lines?.[Number(/^lines\.(\d+)\./.exec(path)?.[1])];
  // What the line comes to: quantity times price, less its discount, in cents as the XML has it (1 x 1.005 less 0.02
  // is 0.99, not 0.985). Nothing is calculated with a value that is not a number yet.
  const [quantity, unitPrice, percent] = [Number(line?.quantity), Number(line?.unitPrice), Number(line?.discount?.percent)];
  const product = Number.isFinite(quantity) && Number.isFinite(unitPrice) ? lineBase(quantity, unitPrice) : NaN;
  const discount = line?.discount?.amount ?? (Number.isFinite(product) && Number.isFinite(percent) ? percentOf(product, percent) : 0);
  return t(key, {
    a: line ? money(product - Number(discount)) : '',
    b: line ? money(Number(line.netAmount)) : '',
    // Known limit: the value that could not be written is read from the quotes of the English message. Give the finding
    // the value itself if that message is ever worded differently.
    v: /"(.*)"/.exec(finding.message)?.[1] ?? '',
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
export const money = (n: number) =>
  new Intl.NumberFormat(lang, {
    style: 'currency',
    currency: /^[A-Z]{3}$/.test(String(state.draft.currency ?? '')) ? String(state.draft.currency) : 'EUR',
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
