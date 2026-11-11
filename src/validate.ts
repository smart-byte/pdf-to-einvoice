import type { Totals } from './calculate.js';
import { check, type Finding } from './check.js';
import type { InvoiceDraft } from './model.js';
import { inspectPdf } from './pdf.js';
import { readInvoiceXml } from './read.js';

export interface ValidationResult {
  /** True when the PDF carries Cross Industry Invoice XML in an EN 16931 profile, whatever else is found. */
  isEInvoice: boolean;
  /** The profile the XML declares (BT-24). */
  profile?: string;
  /** The embedded XML as it is. */
  xml?: string;
  /** The data read from the XML. */
  invoice?: InvoiceDraft;
  /** The lines, counted from 0, whose total the XML explains by what the data does not hold; pass them on to `check`. */
  adjustedLines?: number[];
  /** Calculated from the lines of the XML. */
  totals?: Totals;
  findings: Finding[];
}

/** EN 16931 itself and everything built on it: Factur-X BASIC and EXTENDED, XRECHNUNG. MINIMUM and BASIC WL carry other identifiers. */
const EN16931 = 'urn:cen.eu:en16931:2017';

/**
 * Checks an existing e-invoice PDF (ZUGFeRD / Factur-X): does it carry invoice XML in an EN 16931 profile, is the
 * data in that XML complete, does it add up, does the file declare PDF/A-3 with its fonts embedded and, when
 * `pdfText` is given, does the XML say what the page shows (`not-in-pdf`).
 *
 * This is a plausibility check and NOT a full validation: it runs neither the EN 16931 Schematron rules nor a PDF/A
 * validator such as veraPDF, so a result without findings does not prove that the file conforms.
 *
 * Throws if the file cannot be read as a PDF.
 */
export async function validateEInvoice(pdf: Uint8Array, options: { pdfText?: string } = {}): Promise<ValidationResult> {
  const info = await inspectPdf(pdf);
  const findings: Finding[] = [];
  const add = (severity: Finding['severity'], code: string, message: string) => findings.push({ path: '', severity, code, message });

  const xml = info.embeddedXml;
  if (xml === null) {
    add(
      'error',
      'no-xml',
      'This PDF carries no invoice XML (factur-x.xml, zugferd-invoice.xml or xrechnung.xml): it is a plain PDF, not an e-invoice. Ask the issuer for an e-invoice, or create one if the invoice is yours.',
    );
    return { isEInvoice: false, findings };
  }

  let read: ReturnType<typeof readInvoiceXml> | undefined;
  try {
    read = readInvoiceXml(xml);
  } catch (e) {
    add(
      'error',
      'xml-syntax',
      `${e instanceof Error ? e.message : String(e)} The invoice data cannot be read: ask the issuer for a ZUGFeRD 2 / Factur-X e-invoice.`,
    );
  }
  const isEInvoice = read?.profile?.startsWith(EN16931) ?? false;
  if (read && !isEInvoice) {
    add(
      'error',
      'profile',
      `The XML declares ${read.profile ? `the profile "${read.profile}"` : 'no profile'}, not one built on EN 16931 (${EN16931}...). MINIMUM and BASIC WL files do not count as e-invoices under EN 16931 and German VAT law. Ask the issuer for the profile EN 16931 (COMFORT), EXTENDED or XRECHNUNG.`,
    );
  }
  if (info.pdfaPart !== '3') {
    add(
      'warning',
      'pdf-a',
      `The metadata of the PDF ${info.pdfaPart === null ? 'does not declare PDF/A' : `declares PDF/A-${info.pdfaPart}`}; ZUGFeRD / Factur-X asks for PDF/A-3. The XML can be read all the same, but a strict recipient may reject the file. Have it exported again as PDF/A-3.`,
    );
  }
  if (info.unembeddedFonts.length) {
    add(
      'warning',
      'pdf-fonts',
      `The PDF does not embed these fonts: ${info.unembeddedFonts.join(', ')}. The XML is not affected, but the file is not a strict PDF/A-3. Have the PDF exported again with fonts embedded (or as PDF/A) and the e-invoice created from that.`,
    );
  }
  if (info.forbiddenActions.length) {
    add(
      'warning',
      'pdf-actions',
      `The file carries what PDF/A forbids a file to run: ${info.forbiddenActions.join(', ')}. It is not a strict PDF/A-3, and software may refuse it or warn about it.`,
    );
  }
  if (!read) return { isEInvoice, xml, findings };

  const { invoice, profile, adjustedLines } = read;
  // A line may state what `check` knows nothing of, a discount for one: its total is then explained, see `adjustedLines`.
  const checked = check(invoice, { ...options, adjustedLines });
  // check() words a totals mismatch for data typed in from a PDF; here both sides of the contradiction are in the XML.
  const reworded = (finding: Finding): Finding => {
    const key = finding.path.replace('totals.', '') as 'net' | 'vat' | 'gross' | 'due';
    const message = `The XML states a total of ${invoice.totals?.[key]?.toFixed(2)}, but its lines add up to ${checked.totals?.[key].toFixed(2)}. Unless a discount or surcharge on the whole invoice explains the difference (this check does not read those), the XML contradicts itself: ask the issuer for a corrected e-invoice.`;
    return { ...finding, message };
  };
  findings.push(...checked.findings.map((finding) => (finding.code === 'totals-mismatch' ? reworded(finding) : finding)));
  return { isEInvoice, profile, xml, invoice, adjustedLines, totals: checked.totals, findings };
}
