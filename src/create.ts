import { InvoiceService } from '@e-invoice-eu/core';
import type { Totals } from './calculate.js';
import { check, type Finding } from './check.js';
import type { Invoice, InvoiceDraft } from './model.js';
import { inspectPdf, readEmbeddedXml, repairForPdfA, type PdfInfo } from './pdf.js';
import { extractText } from './text.js';
import { toUbl } from './ubl.js';

export interface CreateOptions {
  /** The invoice PDF as it is today. Its pages are not altered. */
  pdf: Uint8Array;
  /** The invoice data. Checked first; nothing is created while an error is open. */
  invoice: InvoiceDraft;
  /**
   * The language the PDF declares as its own, default `en`. The library that writes the XML also looks for its
   * translations in it, and ships none: in a browser that is a request to `assets/locale/` on your host.
   */
  lang?: string;
  /** `xrechnung`: the data has to meet the XRechnung rules as well, and the XML declares XRechnung 3.0. Default `en16931`. */
  profile?: 'en16931' | 'xrechnung';
  /** The text of the PDF, from `extractText`, if you have read it already. The data is compared with it; without it the text is read here. */
  pdfText?: string;
}

export interface CreateResult {
  /** The same PDF as a PDF/A-3 with the invoice attached as `factur-x.xml`, or as `xrechnung.xml` with the profile `xrechnung`. */
  pdf: Uint8Array;
  /** The attached XML (UN/CEFACT CII, Factur-X profile EN 16931 or XRECHNUNG). */
  xml: string;
  /** Warnings worth a look; never errors. */
  findings: Finding[];
  totals: Totals;
}

export interface XRechnungOptions {
  /** The invoice data. Checked first, with the XRechnung rules; nothing is created while an error is open. */
  invoice: InvoiceDraft;
  /** The XML syntax: `ubl` (default) or `cii`, UN/CEFACT Cross Industry Invoice. XRechnung allows both. */
  syntax?: 'ubl' | 'cii';
  /** Language in which the library that writes the XML looks for its translations, default `en`. It ships none. */
  lang?: string;
}

export interface XRechnungResult {
  /** The invoice as XML that declares XRechnung 3.0. */
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

/** The data, cleaned and with its totals; throws what is wrong with it. */
function checked(draft: InvoiceDraft, rules?: 'xrechnung', pdfText?: string) {
  const { findings, invoice, totals } = check(draft, { rules, pdfText });
  if (!invoice || !totals) {
    const errors = findings.filter((f) => f.severity === 'error');
    throw new InvoiceError('invalid-invoice', `The invoice data has ${errors.length} error(s): ${errors.map((f) => f.message).join(' ')}`, findings);
  }
  return { findings, invoice, totals };
}

/** Has @e-invoice-eu/core write the invoice in one of its formats. What the library warns about joins the findings. */
async function write(format: string, invoice: Invoice, totals: Totals, findings: Finding[], lang = 'en', pdf?: Uint8Array): Promise<string | Uint8Array> {
  const note = (message: unknown) => findings.push({ path: '', severity: 'warning', code: 'generator', message: String(message) });
  try {
    const service = new InvoiceService({ log: () => {}, warn: note, error: note });
    return await service.generate(toUbl(invoice, totals, /xrechnung/i.test(format)), {
      format,
      lang,
      // The file names this tool as its producer; the library that writes it is credited in the README.
      customMetadata: { producer: 'pdf-to-einvoice' },
      pdf: pdf && { buffer: await repairForPdfA(pdf), filename: 'invoice.pdf', mimetype: 'application/pdf' },
      postProcessor: async (xml: any) => {
        // @e-invoice-eu/core 3.4 writes the purchase order number (BT-13) for the EXTENDED profile only, although
        // EN 16931 has it. It is the last element of the trade agreement in everything this function writes.
        const agreement = xml?.['rsm:CrossIndustryInvoice']?.['rsm:SupplyChainTradeTransaction']?.['ram:ApplicableHeaderTradeAgreement'];
        if (invoice.orderReference && agreement && !agreement['ram:BuyerOrderReferencedDocument']) {
          agreement['ram:BuyerOrderReferencedDocument'] = { 'ram:IssuerAssignedID': invoice.orderReference };
        }
        // A UBL credit note states the due date (BT-9) with the payment means, right after their code. The library
        // leaves it out.
        const means = xml?.CreditNote?.['cac:PaymentMeans'];
        if (invoice.dueDate && means?.[0]) {
          const { 'cbc:PaymentMeansCode': code, ...rest } = means[0];
          means[0] = { 'cbc:PaymentMeansCode': code, 'cbc:PaymentDueDate': invoice.dueDate, ...rest };
        }
      },
    });
  } catch (e) {
    throw new InvoiceError('generator', `The e-invoice could not be written: ${reason(e)}`, findings);
  }
}

/** The XML is the binding part: a value that was given but did not make it there must not go unnoticed. */
function reportNotWritten(invoice: Invoice, xml: string, findings: Finding[]): void {
  const escaped = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const { lines, seller, buyer, totals: _printed, typeCode: _type, currency: _currency, ...head } = invoice;
  const given = [head, seller, buyer, ...lines.map(({ name, description }) => ({ name, description }))].flatMap((part) => Object.entries(part));
  for (const [field, value] of given) {
    if (typeof value === 'string' && !/^\d{4}-\d{2}-\d{2}$/.test(value) && !xml.includes(escaped(value))) {
      findings.push({
        path: field,
        severity: 'warning',
        code: 'not-written',
        message: `"${value}" could not be written into the XML. Do not send this file; please report it at https://github.com/smart-byte/pdf-to-einvoice/issues.`,
      });
    }
  }
}

/**
 * Turns an invoice PDF into an EN 16931 e-invoice (ZUGFeRD / Factur-X): the
 * data is written as XML and attached to the PDF, which becomes a PDF/A-3.
 * What the PDF looks like stays as it is. With the profile `xrechnung` the
 * XML follows XRechnung 3.0.
 */
export async function createEInvoice(options: CreateOptions): Promise<CreateResult> {
  const xrechnung = options.profile === 'xrechnung';
  let info: PdfInfo;
  try {
    info = await inspectPdf(options.pdf);
  } catch (e) {
    throw new InvoiceError('invalid-pdf', `The file could not be read as a PDF: ${reason(e)}`);
  }
  if (info.embeddedXml !== null) throw new InvoiceError('already-einvoice', 'This PDF already carries an e-invoice.');
  // A PDF whose text cannot be read is compared with no text: that is reported, and the file is written all the same.
  const pdfText = options.pdfText ?? (await extractText(options.pdf).catch(() => ''));
  const { findings, invoice, totals } = checked(options.invoice, xrechnung ? 'xrechnung' : undefined, pdfText);
  if (info.unembeddedFonts.length) {
    findings.push({
      path: '',
      severity: 'warning',
      code: 'pdf-fonts',
      message: `The PDF does not embed these fonts: ${info.unembeddedFonts.join(', ')}. The XML is not affected, but the file is not a strict PDF/A-3. Export the PDF again with fonts embedded (or as PDF/A) to fix this.`,
    });
  }

  if (info.forbiddenActions.length) {
    findings.push({
      path: '',
      severity: 'warning',
      code: 'pdf-actions',
      message: `The PDF carried what PDF/A forbids a file to run: ${info.forbiddenActions.join(', ')}. It was left out of the e-invoice; the pages are unchanged.`,
    });
  }

  const pdf = (await write(xrechnung ? 'Factur-X-XRechnung' : 'Factur-X-EN16931', invoice, totals, findings, options.lang, options.pdf)) as Uint8Array;
  const xml = await readEmbeddedXml(pdf);
  if (xml === null) throw new InvoiceError('generator', 'The e-invoice was written without its XML.', findings);
  reportNotWritten(invoice, xml, findings);
  return { pdf, xml, findings, totals };
}

/**
 * Writes the invoice data as an XRechnung: plain XML without a PDF, in the
 * version 3.0 of the German standard for invoices to public bodies. The data
 * has to meet the XRechnung rules of `check`.
 */
export async function createXRechnung(options: XRechnungOptions): Promise<XRechnungResult> {
  const { findings, invoice, totals } = checked(options.invoice, 'xrechnung');
  const xml = (await write(options.syntax === 'cii' ? 'XRECHNUNG-CII' : 'XRECHNUNG-UBL', invoice, totals, findings, options.lang)) as string;
  reportNotWritten(invoice, xml, findings);
  return { xml, findings, totals };
}
