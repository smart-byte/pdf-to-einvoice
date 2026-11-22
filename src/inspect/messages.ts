// The English text of what checking an existing e-invoice reports about the file: its XML, its profile, its PDF/A.
// What is wrong with the data in that XML, `check` says (domain/messages.ts). Keys and codes as there.
import { catalog } from '../domain/finding.js';

export const MESSAGES = {
  'no-xml': () =>
    'This PDF carries no invoice XML (factur-x.xml, zugferd-invoice.xml or xrechnung.xml): it is a plain PDF, not an e-invoice. Ask the issuer for an e-invoice, or create one if the invoice is yours.',
  'xml-syntax': ({ reason }: { reason: string }) =>
    `${reason} The invoice data cannot be read: ask the issuer for a ZUGFeRD 2 / Factur-X e-invoice.`,
  profile: ({ declared, expected }: { declared: string; expected: string }) =>
    `The XML declares ${declared}, not one built on EN 16931 (${expected}...). MINIMUM and BASIC WL files do not count as e-invoices under EN 16931 and German VAT law. Ask the issuer for the profile EN 16931 (COMFORT), EXTENDED or XRECHNUNG.`,
  'pdf-a': ({ declared }: { declared: string }) =>
    `The metadata of the PDF ${declared}; ZUGFeRD / Factur-X asks for PDF/A-3. The XML can be read all the same, but a strict recipient may reject the file. Have it exported again as PDF/A-3.`,
  'pdf-fonts': ({ fonts }: { fonts: string }) =>
    `The PDF does not embed these fonts: ${fonts}. The XML is not affected, but the file is not a strict PDF/A-3. Have the PDF exported again with fonts embedded (or as PDF/A) and the e-invoice created from that.`,
  'pdf-actions': ({ actions }: { actions: string }) =>
    `The file carries what PDF/A forbids a file to run: ${actions}. It is not a strict PDF/A-3, and software may refuse it or warn about it.`,
  'xml-charge': () =>
    'The XML states a percentage, a base and an amount for this charge that do not agree. Ask the issuer for a corrected e-invoice.',
  'xml-discount': () =>
    'The XML states a percentage, a base and an amount for this discount that do not agree. Ask the issuer for a corrected e-invoice.',
};

/** A finding of this layer at a path, with the code and the text of its key. */
export const { error, warning } = catalog(MESSAGES);
