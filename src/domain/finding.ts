import { codeOf, message, type MessageKey, type MessageParams } from './messages.js';

/** Something about the invoice data that a person should know: what `check`, `calculate` and the writers report. */
export interface Finding {
  /** Dotted path of the field, e.g. `seller.vatId` or `lines.0.unitPrice`. */
  path: string;
  /** An error blocks the e-invoice; a warning asks for a second look. */
  severity: 'error' | 'warning';
  code: string;
  message: string;
}

/** An error at `path`, with the code and the text of `key` (see `MESSAGES`). */
export function error<K extends MessageKey>(path: string, key: K, ...params: MessageParams<K>): Finding {
  return { path, severity: 'error', code: codeOf(key), message: message(key, ...params) };
}

/** A warning at `path`, with the code and the text of `key` (see `MESSAGES`). */
export function warning<K extends MessageKey>(path: string, key: K, ...params: MessageParams<K>): Finding {
  return { path, severity: 'warning', code: codeOf(key), message: message(key, ...params) };
}
