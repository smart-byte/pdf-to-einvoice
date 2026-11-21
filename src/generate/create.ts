import { InvoiceService } from '@e-invoice-eu/core';
import type { Totals } from '../domain/calculate.js';
import { check } from '../domain/check.js';
import type { Finding } from '../domain/finding.js';
import type { Invoice, InvoiceDraft } from '../domain/model.js';
import { inspectPdf, readEmbeddedXml, repairForPdfA, type PdfInfo } from '../pdf/file.js';
import { extractText } from '../pdf/text.js';
import { messageOf } from '../util/errors.js';
import { message, warning } from './messages.js';
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
    text: string,
    readonly findings: Finding[] = [],
  ) {
    super(text);
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
    throw new InvoiceError('invalid-pdf', message('invalid-pdf', { reason: messageOf(e) }));
  }
  if (info.embeddedXml !== null) throw new InvoiceError('already-einvoice', message('already-einvoice'));
  // A PDF whose text cannot be read is compared with no text: that is reported, and the file is written all the same.
  const pdfText = options.pdfText ?? (await extractText(options.pdf).catch(() => ''));
  const data = checked(options.invoice, xrechnung ? 'xrechnung' : undefined, pdfText);
  const before = { ...data, findings: [...data.findings, ...fileWarnings(info)] };
  const { file: pdf, warnings } = await write<Uint8Array>(before, {
    format: xrechnung ? 'Factur-X-XRechnung' : 'Factur-X-EN16931',
    lang: options.lang,
    pdf: options.pdf,
  });
  const findings = [...before.findings, ...warnings];
  const xml = await readEmbeddedXml(pdf);
  if (xml === null) throw new InvoiceError('generator', message('generator.no-xml'), findings);
  return { pdf, xml, findings: [...findings, ...notWritten(data.invoice, xml)], totals: data.totals };
}

/**
 * Writes the invoice data as an XRechnung: plain XML without a PDF, in the
 * version 3.0 of the German standard for invoices to public bodies. The data
 * has to meet the XRechnung rules of `check`.
 */
export async function createXRechnung(options: XRechnungOptions): Promise<XRechnungResult> {
  const data = checked(options.invoice, 'xrechnung');
  const { file: xml, warnings } = await write<string>(data, {
    format: options.syntax === 'cii' ? 'XRECHNUNG-CII' : 'XRECHNUNG-UBL',
    lang: options.lang,
  });
  return { xml, findings: [...data.findings, ...warnings, ...notWritten(data.invoice, xml)], totals: data.totals };
}

/** The data, cleaned and with its totals, and what the check found; throws what is wrong with it. */
interface Checked {
  findings: Finding[];
  invoice: Invoice;
  totals: Totals;
}

function checked(draft: InvoiceDraft, rules?: 'xrechnung', pdfText?: string): Checked {
  const { findings, invoice, totals } = check(draft, { rules, pdfText });
  if (!invoice || !totals) {
    const errors = findings.filter((f) => f.severity === 'error');
    throw new InvoiceError(
      'invalid-invoice',
      message('invalid-invoice', { errors: errors.map((f) => f.message) }),
      findings,
    );
  }
  return { findings, invoice, totals };
}

/** What PDF/A-3 asks of the file and the PDF does not meet: it is written all the same, and the user is told. */
function fileWarnings(info: PdfInfo): Finding[] {
  return [
    ...(info.unembeddedFonts.length
      ? [warning('', 'pdf-fonts.create', { fonts: info.unembeddedFonts.join(', ') })]
      : []),
    ...(info.forbiddenActions.length
      ? [warning('', 'pdf-actions.create', { actions: info.forbiddenActions.join(', ') })]
      : []),
  ];
}

/**
 * Has @e-invoice-eu/core write the checked invoice in one of its formats, into `pdf` where one is given. What the
 * library warns about is returned beside the file. When it fails, the error carries the findings of the check and
 * those warnings.
 */
async function write<File extends string | Uint8Array>(
  { findings, invoice, totals }: Checked,
  { format, lang = 'en', pdf }: { format: string; lang?: string; pdf?: Uint8Array },
): Promise<{ file: File; warnings: Finding[] }> {
  const warnings: Finding[] = [];
  const note = (text: unknown) => warnings.push(warning('', 'generator.library', { text: String(text) }));
  try {
    const service = new InvoiceService({ log: () => {}, warn: note, error: note });
    const file = await service.generate(toUbl(invoice, totals, /xrechnung/i.test(format)), {
      format,
      lang,
      // The file names this tool as its producer; the library that writes it is credited in the README.
      customMetadata: { producer: 'pdf-to-einvoice' },
      pdf: pdf && { buffer: await repairForPdfA(pdf), filename: 'invoice.pdf', mimetype: 'application/pdf' },
      postProcessor: async (xml: unknown) => {
        addOrderReference(xml, invoice.orderReference);
        addCreditNoteDueDate(xml, invoice.dueDate);
      },
    });
    // The format decides what the library returns: a PDF for Factur-X, XML for XRechnung.
    return { file: file as File, warnings };
  } catch (e) {
    throw new InvoiceError('generator', message('generator', { reason: messageOf(e) }), [...findings, ...warnings]);
  }
}

/**
 * @e-invoice-eu/core 3.4 writes the purchase order number (BT-13) for the EXTENDED profile only, although EN 16931 has
 * it. It is the last element of the trade agreement in everything `write` writes.
 */
function addOrderReference(xml: unknown, orderReference: string | undefined): void {
  const agreement = childAt(
    xml,
    'rsm:CrossIndustryInvoice',
    'rsm:SupplyChainTradeTransaction',
    'ram:ApplicableHeaderTradeAgreement',
  );
  if (orderReference && agreement && !agreement['ram:BuyerOrderReferencedDocument']) {
    agreement['ram:BuyerOrderReferencedDocument'] = { 'ram:IssuerAssignedID': orderReference };
  }
}

/** A UBL credit note states the due date (BT-9) with the payment means, right after their code. The library leaves it out. */
function addCreditNoteDueDate(xml: unknown, dueDate: string | undefined): void {
  const means = childAt(xml, 'CreditNote')?.['cac:PaymentMeans'];
  if (!dueDate || !Array.isArray(means) || !isElement(means[0])) return;
  const { 'cbc:PaymentMeansCode': code, ...rest } = means[0];
  means[0] = { 'cbc:PaymentMeansCode': code, 'cbc:PaymentDueDate': dueDate, ...rest };
}

/** An element of the XML as the library holds it before writing: its children by name, a repeated one as a list. */
type Element = Record<string, unknown>;

/** Follows element names down from a node, where each is there. */
function childAt(node: unknown, ...path: string[]): Element | undefined {
  let at = isElement(node) ? node : undefined;
  for (const name of path) {
    const next = at?.[name];
    at = isElement(next) ? next : undefined;
  }
  return at;
}

function isElement(node: unknown): node is Element {
  return typeof node === 'object' && node !== null;
}

/** The XML is the binding part: a value that was given but did not make it there must not go unnoticed. */
function notWritten(invoice: Invoice, xml: string): Finding[] {
  const escaped = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const {
    lines,
    seller,
    buyer,
    discounts = [],
    charges = [],
    totals: _printed,
    typeCode: _type,
    currency: _currency,
    ...head
  } = invoice;
  const given = [
    ...[head, seller, buyer, ...lines.map(({ name, description }) => ({ name, description }))].flatMap((part) =>
      Object.entries(part),
    ),
    ...discounts.map((entry, i) => [`discounts.${i}.reason`, entry.reason] as const),
    ...charges.map((entry, i) => [`charges.${i}.reason`, entry.reason] as const),
  ];
  return given.flatMap(([field, value]) =>
    typeof value === 'string' && !/^\d{4}-\d{2}-\d{2}$/.test(value) && !xml.includes(escaped(value))
      ? [warning(field, 'not-written', { value })]
      : [],
  );
}
