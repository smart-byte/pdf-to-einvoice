// Small helpers for the page: finding and creating elements, switching the view, setting a translated text.
import { t } from './i18n.js';

export const $ = <T extends HTMLElement>(selector: string) => document.querySelector<T>(selector)!;
/** Creates an element. `props` are assigned as properties; `dataset` entries become data attributes. */
export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Record<string, unknown> = {},
  ...children: (Node | string)[]
): HTMLElementTagNameMap[K] {
  const { dataset, ...rest } = props;
  const node = Object.assign(document.createElement(tag), rest);
  Object.assign(node.dataset, dataset);
  node.append(...children);
  return node;
}

export function show(view: 'start' | 'work' | 'done'): void {
  document.body.dataset.view = view;
  window.scrollTo({ top: 0 });
}

export function setText(selector: string, key: string): void {
  const node = $(selector);
  node.dataset.i18n = key;
  node.textContent = t(key);
}
