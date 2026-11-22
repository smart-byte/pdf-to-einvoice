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

/** The texts of a layer by key. Each takes nothing, or one object with the values it puts in place. */
export type Texts = Record<string, (values: never) => string>;

/** What the text of a key needs filled in: nothing, or one object. */
type ParamsOf<T extends Texts, K extends keyof T> = Parameters<T[K]>;

/**
 * What a layer reports, from the catalog of its texts: `error()` and `warning()` are a finding at `path` with the code
 * and the text of `key`, `message()` is that text alone. Every layer that words findings has one catalog, its
 * `messages.ts`, and builds its findings with these functions only.
 */
export function catalog<T extends Texts>(texts: T) {
  function message<K extends keyof T & string>(key: K, ...params: ParamsOf<T, K>): string {
    return (texts[key] as (...values: ParamsOf<T, K>) => string)(...params);
  }
  function finding<K extends keyof T & string>(
    severity: Finding['severity'],
    path: string,
    key: K,
    params: ParamsOf<T, K>,
  ): Finding {
    const values = params[0] as Finding['params'];
    return {
      path,
      severity,
      code: codeOf(key),
      message: message(key, ...params),
      ...(values ? { params: values } : {}),
    };
  }
  return {
    message,
    error: <K extends keyof T & string>(path: string, key: K, ...params: ParamsOf<T, K>): Finding =>
      finding('error', path, key, params),
    warning: <K extends keyof T & string>(path: string, key: K, ...params: ParamsOf<T, K>): Finding =>
      finding('warning', path, key, params),
  };
}

/** The code a key stands for: what comes before its variant. `format.date` is the code `format`. */
export const codeOf = (key: string): string => key.split('.')[0]!;
