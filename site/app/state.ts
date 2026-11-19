// What the page knows about the invoice it works on. One object, changed by the modules that own each part.
import type { CheckResult } from '../../src/domain/check.js';
import type { Finding } from '../../src/domain/finding.js';
import type { InvoiceDraft } from '../../src/domain/model.js';

interface State {
  pdf?: Uint8Array;
  fileName: string;
  pdfText: string;
  draft: InvoiceDraft;
  /** Fields the user has typed into; reading the PDF again never overwrites them. */
  touched: Set<string>;
  result?: CheckResult;
  /** Findings about the file itself, e.g. fonts that are not embedded. */
  fileFindings: Finding[];
  /** `validate` shows what an existing e-invoice says; nothing can be edited or created then. */
  mode: 'create' | 'validate';
  /** What "Create" makes: the hybrid PDF, or an XRechnung for a public body. It stays when another PDF is opened. */
  format: Format;
  /**
   * Values nobody has looked at yet, by the path of their field or of a whole line item ("lines.2"): a suggestion that
   * is not on the PDF, a VAT category inferred from the buyer's country, or what a language model read. Each stays
   * until the user changes the value or says it is right.
   */
  toCheck: Map<string, 'suggested' | 'inferred' | 'model'>;
  /** Of an existing e-invoice: the lines whose total its XML explains by a discount, a surcharge or a price for several units. */
  adjustedLines?: number[];
  /** Of an existing e-invoice: percentages of discounts and charges its XML states, which the data holds as amounts only. */
  percentages?: Record<string, number>;
}
export type Format = 'pdf' | 'xrechnung';
export const state: State = {
  fileName: '',
  pdfText: '',
  draft: {},
  touched: new Set(),
  fileFindings: [],
  mode: 'create',
  format: 'pdf',
  toCheck: new Map(),
};
/** The format the form is shown and checked for. An existing e-invoice is looked at as it is. */
export const shownFormat = (): Format => (state.mode === 'validate' ? 'pdf' : state.format);
