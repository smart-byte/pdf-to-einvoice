import { codeOf, message, type MessageKey, type MessageParams } from './messages.js';

/** Something about the invoice data that a person should know: what `check`, `calculate` and the writers report. */
export interface Finding {
  /** Dotted path of the field, e.g. `seller.vatId` or `lines.0.unitPrice`. */
  path: string;
  /** An error blocks the e-invoice; a warning asks for a second look. */
  severity: 'error' | 'warning';
  code: string;
  message: string;
  /**
   * The values `message` was filled with, e.g. `{ expected: '0.99', stated: '0.50' }`, so that the text can be worded
   * in another language without reading them out of the English one. Absent where the text has none.
   */
  params?: Readonly<Record<string, string | number | boolean>>;
}

function finding<K extends MessageKey>(
  severity: Finding['severity'],
  path: string,
  key: K,
  params: MessageParams<K>,
): Finding {
  const values = params[0] as Finding['params'];
  return { path, severity, code: codeOf(key), message: message(key, ...params), ...(values ? { params: values } : {}) };
}

/** An error at `path`, with the code and the text of `key` (see `MESSAGES`). */
export function error<K extends MessageKey>(path: string, key: K, ...params: MessageParams<K>): Finding {
  return finding('error', path, key, params);
}

/** A warning at `path`, with the code and the text of `key` (see `MESSAGES`). */
export function warning<K extends MessageKey>(path: string, key: K, ...params: MessageParams<K>): Finding {
  return finding('warning', path, key, params);
}
