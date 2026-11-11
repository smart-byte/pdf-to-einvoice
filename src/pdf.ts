import {
  PDFArray,
  PDFBool,
  PDFDict,
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFRawStream,
  PDFRef,
  PDFString,
  decodePDFRawStream,
  type PDFObject,
} from '@cantoo/pdf-lib';

/** Attachment names used by Factur-X, ZUGFeRD 1/2 and the XRECHNUNG profile. */
const INVOICE_XML_NAMES = ['factur-x.xml', 'zugferd-invoice.xml', 'xrechnung.xml'];

export interface PdfInfo {
  pages: number;
  /** Fonts the PDF refers to without carrying them; PDF/A requires every font to be embedded. */
  unembeddedFonts: string[];
  /** What the PDF would run although PDF/A forbids it, by kind: `JavaScript`, `Launch` and the like. */
  forbiddenActions: string[];
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

/**
 * The actions PDF/A forbids (ISO 19005-3, 6.5.1): they run a script, start a program, play media or change what a
 * reader shows. A named action is allowed only where it turns a page.
 */
const FORBIDDEN_ACTIONS = new Set([
  'JavaScript',
  'Launch',
  'Sound',
  'Movie',
  'ResetForm',
  'ImportData',
  'Hide',
  'SetOCGState',
  'Rendition',
  'Trans',
  'GoTo3DView',
  'SetState',
  'NoOp',
]);
const PAGE_TURNS = new Set(['NextPage', 'PrevPage', 'FirstPage', 'LastPage']);

/**
 * Finds what a PDF would run although PDF/A forbids it, wherever it hangs: the document, a page, a link, a form
 * field or a bookmark, the list of scripts of the document, and actions that follow another. With `remove` it is
 * taken out, and an action that is an object of its own leaves the file with its script. Returns the kinds, sorted.
 */
function forbiddenActions(doc: PDFDocument, remove = false): string[] {
  const found = new Set<string>();
  const gone = new Set<PDFRef>();
  const resolved = (value: PDFObject | undefined) => (value instanceof PDFRef ? doc.context.lookup(value) : value);
  /** The kind of a forbidden action, also behind a reference or in a list of actions; undefined for what is allowed. */
  const kindOf = (value: PDFObject | undefined): string | undefined => {
    const action = resolved(value);
    if (action instanceof PDFArray) return action.asArray().map(kindOf).find(Boolean);
    if (!(action instanceof PDFDict)) return undefined;
    const kind = name(action, 'S') ?? '';
    return FORBIDDEN_ACTIONS.has(kind) || (kind === 'Named' && !PAGE_TURNS.has(name(action, 'N') ?? '')) ? kind : undefined;
  };
  /** Marks an action, its script, what follows it and the nodes of a list of scripts for leaving the file. */
  const forget = (value: PDFObject | undefined): void => {
    if (value instanceof PDFRef) {
      if (gone.has(value)) return;
      gone.add(value);
    }
    const object = resolved(value);
    if (object instanceof PDFArray) object.asArray().forEach(forget);
    else if (object instanceof PDFDict) for (const key of ['JS', 'Next', 'Kids', 'Names']) forget(object.get(PDFName.of(key)));
  };
  const visit = (object: PDFObject): void => {
    const dict = object instanceof PDFRawStream ? object.dict : object;
    if (dict instanceof PDFArray) return dict.asArray().forEach(visit);
    if (!(dict instanceof PDFDict)) return;
    const drop = (key: string, kinds: (string | undefined)[], values: (PDFObject | undefined)[]) => {
      for (const kind of kinds) if (kind) found.add(kind);
      if (!remove) return;
      values.forEach(forget);
      dict.delete(PDFName.of(key));
    };
    // Additional actions are forbidden whatever they do (6.5.2); a list of scripts holds nothing else.
    const more = resolved(dict.get(PDFName.of('AA')));
    if (more instanceof PDFDict)
      drop('AA', more.values().some(kindOf) ? more.values().map(kindOf) : ['additional actions'], [dict.get(PDFName.of('AA')), ...more.values()]);
    if (dict.has(PDFName.of('JavaScript'))) drop('JavaScript', ['JavaScript'], [dict.get(PDFName.of('JavaScript'))]);
    for (const key of ['OpenAction', 'A', 'Next']) {
      const kind = kindOf(dict.get(PDFName.of(key)));
      if (kind) drop(key, [kind], [dict.get(PDFName.of(key))]);
    }
    for (const value of dict.values()) if (value instanceof PDFDict || value instanceof PDFArray) visit(value);
  };
  for (const [, object] of doc.context.enumerateIndirectObjects()) visit(object);
  for (const ref of gone) doc.context.delete(ref);
  return [...found].sort();
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
  return {
    pages: doc.getPageCount(),
    unembeddedFonts: unembeddedFonts(doc),
    forbiddenActions: forbiddenActions(doc),
    embeddedXml: findInvoiceXml(doc),
    pdfaPart: pdfaPart(doc),
  };
}

/** Returns the invoice XML embedded in a ZUGFeRD / Factur-X PDF, or null if there is none. */
export async function readEmbeddedXml(pdf: Uint8Array): Promise<string | null> {
  return findInvoiceXml(await load(pdf));
}

/**
 * Fixes what PDF/A forbids and can be fixed without redrawing anything: images that ask viewers to smooth them when
 * enlarged (`/Interpolate true`, ISO 19005-3, 6.2.8), and scripts and actions the file would run (see
 * `forbiddenActions`). Returns the same bytes when there is nothing to fix.
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
  if (forbiddenActions(doc, true).length) repaired = true;
  return repaired ? doc.save() : pdf;
}
