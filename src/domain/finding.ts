/** Something about the invoice data that a person should know: what `check`, `calculate` and the writers report. */
export interface Finding {
  /** Dotted path of the field, e.g. `seller.vatId` or `lines.0.unitPrice`. */
  path: string;
  /** An error blocks the e-invoice; a warning asks for a second look. */
  severity: 'error' | 'warning';
  code: string;
  message: string;
}
