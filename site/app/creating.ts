// Creating the e-invoice and offering it for download.
import type { Finding } from '../../src/domain/finding.js';
import { countVisit } from '../shared/count.js';
import { $, el, setText, show } from './dom.js';
import { anythingFound, validate } from './findings.js';
import { describe, fieldLabel, reasonOf } from './wording.js';
import { t } from '../shared/i18n.js';
import { pageDrawn } from './page.js';
import { state } from './state.js';

/** The addresses of the files offered for download, given back when the next ones are created. */
let downloads: string[] = [];
/** What the last file was created with: the notes of the finished page, kept to be said again in the other language. */
let noted: Finding[] = [];

$('#create').onclick = create;
$('#again').onclick = () => show('work');
$('#another').onclick = () => show('start');

/** Creates the e-invoice from the form, offers its files and turns to the finished page. */
async function create(): Promise<void> {
  const button = $<HTMLButtonElement>('#create');
  const status = $('#create-status');
  button.disabled = true;
  status.textContent = t('create.busy');
  const xr = state.format === 'xrechnung';
  try {
    const { result, plain } = await createFiles(xr);
    const main = offer(result, plain);
    await showChecksum(main, plain ? new TextEncoder().encode(plain.xml) : result.pdf);
    // Both files are written from the same data: what is said about it is said once.
    noted = onceEach([...result.findings, ...(plain?.findings ?? [])]);
    renderNotes();
    // The stamp reads like a seal: it lands only where neither the check nor the writing of the file found anything.
    $('#done .stamp').hidden = noted.length > 0 || anythingFound();
    status.textContent = '';
    await copyPreview();
    show('done');
    // The project's own site counts that a file was created and of which kind, nothing of the invoice. Any other build counts nothing.
    countVisit('created', { format: xr ? 'xrechnung' : 'pdf' });
  } catch (error) {
    status.textContent = t('create.failed', { m: reasonOf(error) });
  } finally {
    button.disabled = false;
    validate();
  }
}

/** The PDF/A-3 with the XML in it, and for an XRechnung the XML as a file of its own. */
async function createFiles(xr: boolean) {
  // Loaded on demand: the XML writer is the heaviest part of the page.
  const { createEInvoice, createXRechnung } = await import('../../src/generate/create.js');
  // No language is passed on. The library that writes the XML asks the server for a catalogue of translations in
  // whatever language it is given, and ships none: for English, its default here, the site answers with an empty
  // one (public/assets/locale).
  const result = await createEInvoice({
    pdf: state.pdf!,
    invoice: state.draft,
    pdfText: state.pdfText,
    ...(xr ? { profile: 'xrechnung' as const } : {}),
  });
  // A public body takes the XRechnung as a file of its own; the PDF that carries it too is the copy that keeps the look.
  const plain = xr ? await createXRechnung({ invoice: state.draft }) : undefined;
  return { result, plain };
}

/**
 * Offers both files for download and words the finished page for the format. The main file comes first: the XML of an
 * XRechnung, else the PDF. Returns its link.
 */
function offer(result: { pdf: Uint8Array; xml: string }, plain: { xml: string } | undefined): HTMLAnchorElement {
  const xr = plain !== undefined;
  downloads.forEach((url) => URL.revokeObjectURL(url));
  downloads = [];
  const base = state.fileName.replace(/\.pdf$/i, '');
  link('#download-pdf', result.pdf as BlobPart, 'application/pdf', `${base}.einvoice.pdf`);
  link('#download-xml', plain?.xml ?? result.xml, 'application/xml', plain ? `${base}.xrechnung.xml` : `${base}.xml`);
  const [main, copy] = [
    $<HTMLAnchorElement>(xr ? '#download-xml' : '#download-pdf'),
    $<HTMLAnchorElement>(xr ? '#download-pdf' : '#download-xml'),
  ];
  main.className = 'primary';
  copy.className = 'quiet';
  main.parentElement!.prepend(main, copy);
  setText('#download-pdf', xr ? 'done.xr.pdf' : 'done.pdf');
  setText('#download-xml', xr ? 'done.xr.xml' : 'done.xml');
  setText('#done-title', xr ? 'done.title.xr' : 'done.title');
  setText('#done-lead', xr ? 'done.lead.xr' : 'done.lead');
  $('#done-stamp').textContent = xr ? 'XRechnung' : 'EN 16931';
  return main;
}

function link(id: string, bytes: BlobPart, type: string, name: string): void {
  const url = URL.createObjectURL(new Blob([bytes], { type }));
  downloads.push(url);
  Object.assign($<HTMLAnchorElement>(id), { href: url, download: name });
}

/** The SHA-256 checksum of the main file, with its name. */
async function showChecksum(main: HTMLAnchorElement, bytes: Uint8Array): Promise<void> {
  const digest = await crypto.subtle.digest('SHA-256', bytes as BufferSource);
  $('#checksum-file').textContent = main.download;
  $('#checksum').textContent = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Each finding once, where both files report it. */
function onceEach(findings: Finding[]): Finding[] {
  return findings.filter(
    (finding, i, all) =>
      all.findIndex(
        (other) => other.code === finding.code && other.path === finding.path && other.message === finding.message,
      ) === i,
  );
}

/**
 * The finished page shows the same preview, with the stamp landing on it. A page that is still being drawn is waited
 * for: leaving now would copy an empty sheet and leave the preview without a page to come back to.
 */
async function copyPreview(): Promise<void> {
  await pageDrawn().catch(() => {});
  const [from, to] = [$<HTMLCanvasElement>('#preview'), $<HTMLCanvasElement>('#done-preview')];
  Object.assign(to, { width: from.width, height: from.height });
  to.getContext('2d')!.drawImage(from, 0, 0);
}

/** The notes of the finished page. A note about a value names its field, as the verdict above the form does. */
export function renderNotes(): void {
  const notes = $('#done-notes');
  const where = (finding: Finding) => (finding.path && fieldLabel(finding.path) ? `${fieldLabel(finding.path)}: ` : '');
  notes.replaceChildren(...noted.map((finding) => el('li', {}, `${where(finding)}${describe(finding)}`)));
  notes.hidden = noted.length === 0;
}
