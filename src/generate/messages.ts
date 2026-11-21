// The English text of what writing an e-invoice reports: the warnings beside the file, and why an `InvoiceError` was
// thrown. Keys and codes as in domain/messages.ts. Where a key is the variant of a code inspect/messages.ts words for
// an existing file (`pdf-fonts.create`), it is the same finding, said to the one who is creating the file.
import { catalog } from '../domain/finding.js';

export const MESSAGES = {
  'invalid-invoice': ({ errors }: { errors: string[] }) =>
    `The invoice data has ${errors.length} error(s): ${errors.join(' ')}`,
  'invalid-pdf': ({ reason }: { reason: string }) => `The file could not be read as a PDF: ${reason}`,
  'already-einvoice': () => 'This PDF already carries an e-invoice.',
  generator: ({ reason }: { reason: string }) => `The e-invoice could not be written: ${reason}`,
  'generator.no-xml': () => 'The e-invoice was written without its XML.',
  /** What the library that writes the XML warns about, as it says it. */
  'generator.library': ({ text }: { text: string }) => text,
  'not-written': ({ value }: { value: string }) =>
    `"${value}" could not be written into the XML. Do not send this file; please report it at https://github.com/smart-byte/pdf-to-einvoice/issues.`,
  'pdf-fonts.create': ({ fonts }: { fonts: string }) =>
    `The PDF does not embed these fonts: ${fonts}. The XML is not affected, but the file is not a strict PDF/A-3. Export the PDF again with fonts embedded (or as PDF/A) to fix this.`,
  'pdf-actions.create': ({ actions }: { actions: string }) =>
    `The PDF carried what PDF/A forbids a file to run: ${actions}. It was left out of the e-invoice; the pages are unchanged.`,
};

/** A finding of this layer at a path, with the code and the text of its key, and the text of a key alone. */
export const { error, warning, message } = catalog(MESSAGES);
