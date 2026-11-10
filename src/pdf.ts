import { PDFArray, PDFBool, PDFDict, PDFDocument, PDFHexString, PDFName, PDFRawStream, PDFString, decodePDFRawStream } from '@cantoo/pdf-lib';

/** Attachment names used by Factur-X, ZUGFeRD 1/2 and the XRECHNUNG profile. */
const INVOICE_XML_NAMES = ['factur-x.xml', 'zugferd-invoice.xml', 'xrechnung.xml'];

export interface PdfInfo {
  pages: number;
  /** Fonts the PDF refers to without carrying them; PDF/A requires every font to be embedded. */
  unembeddedFonts: string[];
  /** The e-invoice XML the PDF already carries, if any. */
  embeddedXml: string | null;
  /** The PDF/A part the XMP metadata declares (`pdfaid:part`), "3" for a ZUGFeRD / Factur-X file; null if it declares none. */
  pdfaPart: string | null;
}

/** Loads a PDF, or throws the reason it cannot be used. */
async function load(pdf: Uint8Array): Promise<PDFDocument> {
  return PDFDocument.load(pdf, { updateMetadata: false });
}

const name = (dict: PDFDict, key: string) => dict.lookupMaybe(PDFName.of(key), PDFName)?.decodeText();

function unembeddedFonts(doc: PDFDocument): string[] {
  const missing = new Set<string>();
  for (const [, object] of doc.context.enumerateIndirectObjects()) {
    if (!(object instanceof PDFDict) || name(object, 'Type') !== 'Font') continue;
    // A Type0 font delegates to a descendant font, which is checked on its own; a Type3 font draws its glyphs itself.
    if (['Type0', 'Type3'].includes(name(object, 'Subtype') ?? '')) continue;
    const descriptor = object.lookupMaybe(PDFName.of('FontDescriptor'), PDFDict);
    const embedded = descriptor && ['FontFile', 'FontFile2', 'FontFile3'].some((key) => descriptor.has(PDFName.of(key)));
    if (!embedded) missing.add(name(object, 'BaseFont') ?? 'unnamed font');
  }
  return [...missing].sort();
}

/** Walks the name tree of embedded files and returns the invoice XML, if one is attached. */
function findInvoiceXml(doc: PDFDocument): string | null {
  const names = doc.catalog.lookupMaybe(PDFName.of('Names'), PDFDict);
  const root = names?.lookupMaybe(PDFName.of('EmbeddedFiles'), PDFDict);
  const visit = (node: PDFDict | undefined): string | null => {
    if (!node) return null;
    const entries = node.lookupMaybe(PDFName.of('Names'), PDFArray);
    for (let i = 0; entries && i + 1 < entries.size(); i += 2) {
      const key = entries.lookup(i);
      const filename = key instanceof PDFString || key instanceof PDFHexString ? key.decodeText() : '';
      if (!INVOICE_XML_NAMES.includes(filename.toLowerCase())) continue;
      const stream = entries
        .lookupMaybe(i + 1, PDFDict)
        ?.lookupMaybe(PDFName.of('EF'), PDFDict)
        ?.lookup(PDFName.of('F'));
      if (stream instanceof PDFRawStream) return new TextDecoder().decode(decodePDFRawStream(stream).decode());
    }
    const kids = node.lookupMaybe(PDFName.of('Kids'), PDFArray);
    for (let i = 0; kids && i < kids.size(); i++) {
      const found = visit(kids.lookupMaybe(i, PDFDict));
      if (found) return found;
    }
    return null;
  };
  return visit(root);
}

/** Reads `pdfaid:part` from the XMP metadata of the catalog, where it is an element or an attribute. */
function pdfaPart(doc: PDFDocument): string | null {
  const metadata = doc.catalog.lookup(PDFName.of('Metadata'));
  if (!(metadata instanceof PDFRawStream)) return null;
  try {
    const xmp = new TextDecoder().decode(decodePDFRawStream(metadata).decode());
    return /pdfaid:part\s*(?:>|=\s*["'])\s*(\d+)/.exec(xmp)?.[1] ?? null;
  } catch {
    // Metadata in an encoding that cannot be decoded declares nothing readable; it must not stop the inspection.
    return null;
  }
}

/** Looks at a PDF without changing it. Throws if the file cannot be read as a PDF. */
export async function inspectPdf(pdf: Uint8Array): Promise<PdfInfo> {
  const doc = await load(pdf);
  return { pages: doc.getPageCount(), unembeddedFonts: unembeddedFonts(doc), embeddedXml: findInvoiceXml(doc), pdfaPart: pdfaPart(doc) };
}

/** Returns the invoice XML embedded in a ZUGFeRD / Factur-X PDF, or null if there is none. */
export async function readEmbeddedXml(pdf: Uint8Array): Promise<string | null> {
  return findInvoiceXml(await load(pdf));
}

/**
 * Fixes what PDF/A forbids and can be fixed without redrawing anything. So far that is one thing: images that ask
 * viewers to smooth them when enlarged (`/Interpolate true`, ISO 19005-3, 6.2.8). Returns the same bytes when there
 * is nothing to fix.
 */
export async function repairForPdfA(pdf: Uint8Array): Promise<Uint8Array> {
  const doc = await load(pdf);
  const key = PDFName.of('Interpolate');
  let repaired = false;
  for (const [, object] of doc.context.enumerateIndirectObjects()) {
    const dict = object instanceof PDFRawStream ? object.dict : object;
    if (dict instanceof PDFDict && name(dict, 'Subtype') === 'Image' && dict.get(key) === PDFBool.True) {
      dict.set(key, PDFBool.False);
      repaired = true;
    }
  }
  return repaired ? doc.save() : pdf;
}
