import type { Totals } from '../domain/calculate.js';
import { check } from '../domain/check.js';
import type { Finding } from '../domain/finding.js';
import type { InvoiceDraft } from '../domain/model.js';
import { inspectPdf, type PdfInfo } from '../pdf/file.js';
import { readInvoiceXml } from './read-xml.js';

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
  /** The discounts and charges whose percentage, base and amount disagree in the XML, by path, e.g. `lines.0.discount.percent`. */
  contradictions?: string[];
  /** Percentages of discounts and charges on the whole invoice that the data leaves out, see `readInvoiceXml`; pass them on to `check`. */
  percentages?: Record<string, number>;
  /** Calculated from the lines of the XML. */
  totals?: Totals;
  findings: Finding[];
}

/** EN 16931 itself and everything built on it: Factur-X BASIC and EXTENDED, XRECHNUNG. MINIMUM and BASIC WL carry other identifiers. */
const EN16931 = 'urn:cen.eu:en16931:2017';

/** A finding about the file as a whole, not about one field. */
const aboutTheFile = (severity: Finding['severity'], code: string, message: string): Finding => ({ path: '', severity, code, message });

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
  const xml = info.embeddedXml;
  if (xml === null) {
    return {
      isEInvoice: false,
      findings: [
        aboutTheFile(
          'error',
          'no-xml',
          'This PDF carries no invoice XML (factur-x.xml, zugferd-invoice.xml or xrechnung.xml): it is a plain PDF, not an e-invoice. Ask the issuer for an e-invoice, or create one if the invoice is yours.',
        ),
      ],
    };
  }

  const { read, isEInvoice, findings } = readXml(xml);
  findings.push(...pdfFindings(info));
  if (!read) return { isEInvoice, xml, findings };

  const { invoice, profile, adjustedLines, contradictions, percentages } = read;
  findings.push(...contradictionFindings(contradictions));
  // A line may state what `check` knows nothing of, a surcharge for one: its total is then explained, see `adjustedLines`.
  const checked = check(invoice, { ...options, adjustedLines, percentages });
  findings.push(...checked.findings.map((finding) => (finding.code === 'totals-mismatch' ? reworded(finding, invoice, checked.totals) : finding)));
  return { isEInvoice, profile, xml, invoice, adjustedLines, contradictions, percentages, totals: checked.totals, findings };
}

/** The data of the XML, and whether its profile is one built on EN 16931. */
function readXml(xml: string): { read?: ReturnType<typeof readInvoiceXml>; isEInvoice: boolean; findings: Finding[] } {
  let read: ReturnType<typeof readInvoiceXml>;
  try {
    read = readInvoiceXml(xml);
  } catch (e) {
    return {
      isEInvoice: false,
      findings: [
        aboutTheFile(
          'error',
          'xml-syntax',
          `${e instanceof Error ? e.message : String(e)} The invoice data cannot be read: ask the issuer for a ZUGFeRD 2 / Factur-X e-invoice.`,
        ),
      ],
    };
  }
  if (read.profile?.startsWith(EN16931)) return { read, isEInvoice: true, findings: [] };
  return {
    read,
    isEInvoice: false,
    findings: [
      aboutTheFile(
        'error',
        'profile',
        `The XML declares ${read.profile ? `the profile "${read.profile}"` : 'no profile'}, not one built on EN 16931 (${EN16931}...). MINIMUM and BASIC WL files do not count as e-invoices under EN 16931 and German VAT law. Ask the issuer for the profile EN 16931 (COMFORT), EXTENDED or XRECHNUNG.`,
      ),
    ],
  };
}

/** What makes the file itself less than a strict PDF/A-3. The XML can be read all the same. */
function pdfFindings(info: PdfInfo): Finding[] {
  const findings: Finding[] = [];
  if (info.pdfaPart !== '3') {
    const declared = info.pdfaPart === null ? 'does not declare PDF/A' : `declares PDF/A-${info.pdfaPart}`;
    findings.push(
      aboutTheFile(
        'warning',
        'pdf-a',
        `The metadata of the PDF ${declared}; ZUGFeRD / Factur-X asks for PDF/A-3. The XML can be read all the same, but a strict recipient may reject the file. Have it exported again as PDF/A-3.`,
      ),
    );
  }
  if (info.unembeddedFonts.length) {
    findings.push(
      aboutTheFile(
        'warning',
        'pdf-fonts',
        `The PDF does not embed these fonts: ${info.unembeddedFonts.join(', ')}. The XML is not affected, but the file is not a strict PDF/A-3. Have the PDF exported again with fonts embedded (or as PDF/A) and the e-invoice created from that.`,
      ),
    );
  }
  if (info.forbiddenActions.length) {
    findings.push(
      aboutTheFile(
        'warning',
        'pdf-actions',
        `The file carries what PDF/A forbids a file to run: ${info.forbiddenActions.join(', ')}. It is not a strict PDF/A-3, and software may refuse it or warn about it.`,
      ),
    );
  }
  return findings;
}

/** The data holds one value of such a discount or charge, so `check` cannot see the contradiction: it is reported here. */
function contradictionFindings(paths: string[]): Finding[] {
  // The codes stay written out: test/site/i18n.test.ts reads them from here to find their German texts.
  const disagree = (what: string) =>
    `The XML states a percentage, a base and an amount for this ${what} that do not agree. Ask the issuer for a corrected e-invoice.`;
  return paths.map((path): Finding =>
    path.startsWith('charges.')
      ? { path, severity: 'error', code: 'xml-charge', message: disagree('charge') }
      : { path, severity: 'error', code: 'xml-discount', message: disagree('discount') },
  );
}

/** check() words a totals mismatch for data typed in from a PDF; here both sides of the contradiction are in the XML. */
function reworded(finding: Finding, invoice: InvoiceDraft, totals: Totals | undefined): Finding {
  const key = finding.path.replace('totals.', '') as 'net' | 'vat' | 'gross' | 'due';
  const what = totals?.adjustments.length ? 'its lines, discounts and charges' : 'its lines';
  const message = `The XML states a total of ${invoice.totals?.[key]?.toFixed(2)}, but ${what} add up to ${totals?.[key].toFixed(2)}. The XML contradicts itself: ask the issuer for a corrected e-invoice.`;
  return { ...finding, message };
}
