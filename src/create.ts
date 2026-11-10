import { InvoiceService } from '@e-invoice-eu/core';
import type { Totals } from './calculate.js';
import { check, type Finding } from './check.js';
import type { InvoiceDraft } from './model.js';
import { inspectPdf, readEmbeddedXml, repairForPdfA, type PdfInfo } from './pdf.js';
import { toUbl } from './ubl.js';

export interface CreateOptions {
  /** The invoice PDF as it is today. Its pages are not altered. */
  pdf: Uint8Array;
  /** The invoice data. Checked first; nothing is created while an error is open. */
  invoice: InvoiceDraft;
  /** Language of the canned texts in the PDF metadata. */
  lang?: string;
}

export interface CreateResult {
  /** The same PDF as a PDF/A-3 with the invoice attached as `factur-x.xml`. */
  pdf: Uint8Array;
  /** The attached XML (UN/CEFACT CII, Factur-X profile EN 16931). */
  xml: string;
  /** Warnings worth a look; never errors. */
  findings: Finding[];
  totals: Totals;
}

export type InvoiceErrorCode = 'invalid-invoice' | 'invalid-pdf' | 'already-einvoice' | 'generator';

/** Why no e-invoice was created. Branch on `code`; `findings` lists what to fix. */
export class InvoiceError extends Error {
  override name = 'InvoiceError';
  constructor(
    readonly code: InvoiceErrorCode,
    message: string,
    readonly findings: Finding[] = [],
  ) {
    super(message);
  }
}

const reason = (e: unknown) => (e instanceof Error ? e.message : String(e));

/**
 * Turns an invoice PDF into an EN 16931 e-invoice (ZUGFeRD / Factur-X): the
 * data is written as XML and attached to the PDF, which becomes a PDF/A-3.
 * What the PDF looks like stays as it is.
 */
export async function createEInvoice(options: CreateOptions): Promise<CreateResult> {
  const { findings, invoice, totals } = check(options.invoice);
  if (!invoice || !totals) {
    const errors = findings.filter((f) => f.severity === 'error');
    throw new InvoiceError('invalid-invoice', `The invoice data has ${errors.length} error(s): ${errors.map((f) => f.message).join(' ')}`, findings);
  }

  let info: PdfInfo;
  try {
    info = await inspectPdf(options.pdf);
  } catch (e) {
    throw new InvoiceError('invalid-pdf', `The file could not be read as a PDF: ${reason(e)}`);
  }
  if (info.embeddedXml !== null) throw new InvoiceError('already-einvoice', 'This PDF already carries an e-invoice.');
  if (info.unembeddedFonts.length) {
    findings.push({
      path: '',
      severity: 'warning',
      code: 'pdf-fonts',
      message: `The PDF does not embed these fonts: ${info.unembeddedFonts.join(', ')}. The XML will be valid, but the file is not a strict PDF/A-3. Export the PDF again with fonts embedded (or as PDF/A) to fix this.`,
    });
  }

  const note = (message: unknown) => findings.push({ path: '', severity: 'warning', code: 'generator', message: String(message) });
  let pdf: Uint8Array;
  try {
    const service = new InvoiceService({ log: () => {}, warn: note, error: note });
    const output = await service.generate(toUbl(invoice, totals), {
      format: 'Factur-X-EN16931',
      lang: options.lang ?? 'en',
      pdf: { buffer: await repairForPdfA(options.pdf), filename: 'invoice.pdf', mimetype: 'application/pdf' },
      // @e-invoice-eu/core 3.4 writes the purchase order number (BT-13) for the EXTENDED profile only, although
      // EN 16931 has it. It is the last element of the trade agreement in everything this function writes.
      postProcessor: async (cii: any) => {
        const agreement = cii?.['rsm:CrossIndustryInvoice']?.['rsm:SupplyChainTradeTransaction']?.['ram:ApplicableHeaderTradeAgreement'];
        if (invoice.orderReference && agreement && !agreement['ram:BuyerOrderReferencedDocument']) {
          agreement['ram:BuyerOrderReferencedDocument'] = { 'ram:IssuerAssignedID': invoice.orderReference };
        }
      },
    });
    pdf = output as Uint8Array;
  } catch (e) {
    throw new InvoiceError('generator', `The e-invoice could not be written: ${reason(e)}`, findings);
  }

  const xml = await readEmbeddedXml(pdf);
  if (xml === null) throw new InvoiceError('generator', 'The e-invoice was written without its XML.', findings);
  // The XML is the binding part: a value that was given but did not make it there must not go unnoticed.
  const escaped = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const { lines, seller, buyer, totals: _printed, typeCode: _type, currency: _currency, ...head } = invoice;
  const given = [head, seller, buyer, ...lines.map(({ name, description }) => ({ name, description }))].flatMap((part) => Object.entries(part));
  for (const [field, value] of given) {
    if (typeof value === 'string' && !/^\d{4}-\d{2}-\d{2}$/.test(value) && !xml.includes(escaped(value))) {
      findings.push({ path: field, severity: 'warning', code: 'not-written', message: `"${value}" could not be written into the XML. Please report this.` });
    }
  }
  return { pdf, xml, findings, totals };
}
