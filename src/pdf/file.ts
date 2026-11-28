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
  const smoothed = stopSmoothing(doc);
  const ran = forbiddenActions(doc, true).length > 0;
  return smoothed || ran ? doc.save() : pdf;
}

/** Loads a PDF, or throws the reason it cannot be used. */
async function load(pdf: Uint8Array): Promise<PDFDocument> {
  return PDFDocument.load(pdf, { updateMetadata: false });
}

function unembeddedFonts(doc: PDFDocument): string[] {
  const missing = new Set<string>();
  for (const [, object] of doc.context.enumerateIndirectObjects()) {
    if (!(object instanceof PDFDict) || name(object, 'Type') !== 'Font') continue;
    // A Type0 font delegates to a descendant font, which is checked on its own; a Type3 font draws its glyphs itself.
    if (['Type0', 'Type3'].includes(name(object, 'Subtype') ?? '')) continue;
    const descriptor = object.lookupMaybe(PDFName.of('FontDescriptor'), PDFDict);
    const embedded =
      descriptor && ['FontFile', 'FontFile2', 'FontFile3'].some((key) => descriptor.has(PDFName.of(key)));
    if (!embedded) missing.add(name(object, 'BaseFont') ?? 'unnamed font');
  }
  return [...missing].sort();
}

/** Turns off `/Interpolate true` on every image; true where one had it. */
function stopSmoothing(doc: PDFDocument): boolean {
  const key = PDFName.of('Interpolate');
  let stopped = false;
  for (const [, object] of doc.context.enumerateIndirectObjects()) {
    const dict = dictOf(object);
    if (isSmoothedImage(dict, key)) {
      dict.set(key, PDFBool.False);
      stopped = true;
    }
  }
  return stopped;
}

function isSmoothedImage(dict: PDFObject, key: PDFName): dict is PDFDict {
  return dict instanceof PDFDict && name(dict, 'Subtype') === 'Image' && dict.get(key) === PDFBool.True;
}

/** The dictionary of a stream; any other object as it is. */
function dictOf(object: PDFObject): PDFObject {
  return object instanceof PDFRawStream ? object.dict : object;
}

/** Looking through a PDF for forbidden actions: what was found, and with `remove` what leaves the file. */
interface Scan {
  doc: PDFDocument;
  remove: boolean;
  found: Set<string>;
  gone: Set<PDFRef>;
}

/**
 * Finds what a PDF would run although PDF/A forbids it, wherever it hangs: the document, a page, a link, a form
 * field or a bookmark, the list of scripts of the document, and actions that follow another. With `remove` it is
 * taken out, and an action that is an object of its own leaves the file with its script. Returns the kinds, sorted.
 */
function forbiddenActions(doc: PDFDocument, remove = false): string[] {
  const scan: Scan = { doc, remove, found: new Set(), gone: new Set() };
  for (const [, object] of doc.context.enumerateIndirectObjects()) visit(scan, object);
  for (const ref of scan.gone) doc.context.delete(ref);
  return [...scan.found].sort();
}

/** Notes, and with `remove` takes out, the forbidden actions of an object and of everything it holds directly. */
function visit(scan: Scan, object: PDFObject): void {
  const dict = dictOf(object);
  if (dict instanceof PDFArray) return dict.asArray().forEach((item) => visit(scan, item));
  if (!(dict instanceof PDFDict)) return;
  for (const held of actionsIn(scan.doc, dict)) note(scan, dict, held);
  for (const value of dict.values()) if (value instanceof PDFDict || value instanceof PDFArray) visit(scan, value);
}

/** Notes the kinds of one forbidden entry of `dict`, and with `remove` takes it out with what leaves the file with it. */
function note(scan: Scan, dict: PDFDict, { key, kinds, values }: Held): void {
  for (const kind of kinds) if (kind) scan.found.add(kind);
  if (!scan.remove) return;
  values.forEach((value) => forget(scan, value));
  dict.delete(PDFName.of(key));
}

/** A forbidden entry of a dictionary: its key, the kinds of action it holds, and what leaves the file with it. */
interface Held {
  key: string;
  kinds: (string | undefined)[];
  values: (PDFObject | undefined)[];
}

/** The entries of a dictionary that hold forbidden actions. */
function actionsIn(doc: PDFDocument, dict: PDFDict): Held[] {
  const held: Held[] = [];
  const at = (key: string) => dict.get(PDFName.of(key));
  const kindOfIn = (value: PDFObject | undefined) => kindOf(doc, value);
  // Additional actions are forbidden whatever they do (6.5.2); a list of scripts holds nothing else.
  const more = resolved(doc, at('AA'));
  if (more instanceof PDFDict) {
    const kinds = more.values().some(kindOfIn) ? more.values().map(kindOfIn) : ['additional actions'];
    held.push({ key: 'AA', kinds, values: [at('AA'), ...more.values()] });
  }
  if (dict.has(PDFName.of('JavaScript')))
    held.push({ key: 'JavaScript', kinds: ['JavaScript'], values: [at('JavaScript')] });
  for (const key of ['OpenAction', 'A', 'Next']) {
    const kind = kindOf(doc, at(key));
    if (kind) held.push({ key, kinds: [kind], values: [at(key)] });
  }
  return held;
}

/** The kind of a forbidden action, also behind a reference or in a list of actions; undefined for what is allowed. */
function kindOf(doc: PDFDocument, value: PDFObject | undefined): string | undefined {
  const action = resolved(doc, value);
  if (action instanceof PDFArray)
    return action
      .asArray()
      .map((item) => kindOf(doc, item))
      .find(Boolean);
  if (!(action instanceof PDFDict)) return undefined;
  const kind = name(action, 'S') ?? '';
  const forbidden = FORBIDDEN_ACTIONS.has(kind) || (kind === 'Named' && !PAGE_TURNS.has(name(action, 'N') ?? ''));
  return forbidden ? kind : undefined;
}

/** Marks an action, its script, what follows it and the nodes of a list of scripts for leaving the file. */
function forget(scan: Scan, value: PDFObject | undefined): void {
  if (value instanceof PDFRef) {
    if (scan.gone.has(value)) return;
    scan.gone.add(value);
  }
  const object = resolved(scan.doc, value);
  if (object instanceof PDFArray) object.asArray().forEach((item) => forget(scan, item));
  else if (object instanceof PDFDict)
    for (const key of ['JS', 'Next', 'Kids', 'Names']) forget(scan, object.get(PDFName.of(key)));
}

function resolved(doc: PDFDocument, value: PDFObject | undefined): PDFObject | undefined {
  return value instanceof PDFRef ? doc.context.lookup(value) : value;
}

/** Walks the name tree of embedded files and returns the invoice XML, if one is attached. */
function findInvoiceXml(doc: PDFDocument): string | null {
  const names = doc.catalog.lookupMaybe(PDFName.of('Names'), PDFDict);
  return invoiceXmlIn(names?.lookupMaybe(PDFName.of('EmbeddedFiles'), PDFDict));
}

/** The invoice XML among the files of a node of the name tree, or of the nodes below it. */
function invoiceXmlIn(node: PDFDict | undefined): string | null {
  if (!node) return null;
  return (
    invoiceXmlAmong(node.lookupMaybe(PDFName.of('Names'), PDFArray)) ??
    invoiceXmlBelow(node.lookupMaybe(PDFName.of('Kids'), PDFArray))
  );
}

/** The invoice XML among the pairs of file name and file specification of a node. */
function invoiceXmlAmong(entries: PDFArray | undefined): string | null {
  for (let i = 0; entries && i + 1 < entries.size(); i += 2) {
    if (!isInvoiceXmlName(entries.lookup(i))) continue;
    const stream = entries
      .lookupMaybe(i + 1, PDFDict)
      ?.lookupMaybe(PDFName.of('EF'), PDFDict)
      ?.lookup(PDFName.of('F'));
    if (stream instanceof PDFRawStream) return new TextDecoder().decode(decodePDFRawStream(stream).decode());
  }
  return null;
}

function isInvoiceXmlName(key: PDFObject | undefined): boolean {
  const filename = key instanceof PDFString || key instanceof PDFHexString ? key.decodeText() : '';
  return INVOICE_XML_NAMES.includes(filename.toLowerCase());
}

/** The invoice XML in the first of the nodes below that holds one. */
function invoiceXmlBelow(kids: PDFArray | undefined): string | null {
  for (let i = 0; kids && i < kids.size(); i++) {
    const found = invoiceXmlIn(kids.lookupMaybe(i, PDFDict));
    if (found) return found;
  }
  return null;
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

function name(dict: PDFDict, key: string): string | undefined {
  return dict.lookupMaybe(PDFName.of(key), PDFName)?.decodeText();
}

/** Attachment names used by Factur-X, ZUGFeRD 1/2 and the XRECHNUNG profile. */
const INVOICE_XML_NAMES = ['factur-x.xml', 'zugferd-invoice.xml', 'xrechnung.xml'];

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
