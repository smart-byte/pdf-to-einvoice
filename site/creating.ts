// Creating the e-invoice and offering it for download.
import type { Finding } from '../src/domain/finding.js';
import { countVisit } from './count.js';
import { $, el, setText, show } from './dom.js';
import { validate } from './findings.js';
import { describe, fieldLabel, reasonOf } from './wording.js';
import { t } from './i18n.js';
import { drawing } from './page.js';
import { state } from './state.js';

let downloads: string[] = [];
const link = (id: string, bytes: BlobPart, type: string, name: string) => {
  const url = URL.createObjectURL(new Blob([bytes], { type }));
  downloads.push(url);
  Object.assign($<HTMLAnchorElement>(id), { href: url, download: name });
};

/** What the last file was created with: the notes of the finished page, kept to be said again in the other language. */
let noted: Finding[] = [];

/** The notes of the finished page. A note about a value names its field, as the verdict above the form does. */
export function renderNotes(): void {
  const notes = $('#done-notes');
  const where = (finding: Finding) => (finding.path && fieldLabel(finding.path) ? `${fieldLabel(finding.path)}: ` : '');
  notes.replaceChildren(...noted.map((finding) => el('li', {}, `${where(finding)}${describe(finding)}`)));
  notes.hidden = noted.length === 0;
}

$('#create').onclick = async () => {
  const button = $<HTMLButtonElement>('#create');
  const status = $('#create-status');
  button.disabled = true;
  status.textContent = t('create.busy');
  const xr = state.format === 'xrechnung';
  try {
    // Loaded on demand: the XML writer is the heaviest part of the page.
    const { createEInvoice, createXRechnung } = await import('../src/generate/create.js');
    // No language is passed on. The library that writes the XML asks the server for a catalogue of translations in
    // whatever language it is given, and ships none: for English, its default here, the site answers with an empty
    // one (public/assets/locale).
    const result = await createEInvoice({ pdf: state.pdf!, invoice: state.draft, pdfText: state.pdfText, ...(xr ? { profile: 'xrechnung' as const } : {}) });
    // A public body takes the XRechnung as a file of its own; the PDF that carries it too is the copy that keeps the look.
    const plain = xr ? await createXRechnung({ invoice: state.draft }) : undefined;
    downloads.forEach((url) => URL.revokeObjectURL(url));
    downloads = [];
    const base = state.fileName.replace(/\.pdf$/i, '');
    link('#download-pdf', result.pdf as BlobPart, 'application/pdf', `${base}.einvoice.pdf`);
    link('#download-xml', plain?.xml ?? result.xml, 'application/xml', plain ? `${base}.xrechnung.xml` : `${base}.xml`);
    // The main file comes first, and the checksum is that of the main file.
    const [main, copy] = [$<HTMLAnchorElement>(xr ? '#download-xml' : '#download-pdf'), $<HTMLAnchorElement>(xr ? '#download-pdf' : '#download-xml')];
    main.className = 'primary';
    copy.className = 'quiet';
    main.parentElement!.prepend(main, copy);
    setText('#download-pdf', xr ? 'done.xr.pdf' : 'done.pdf');
    setText('#download-xml', xr ? 'done.xr.xml' : 'done.xml');
    setText('#done-title', xr ? 'done.title.xr' : 'done.title');
    setText('#done-lead', xr ? 'done.lead.xr' : 'done.lead');
    $('#done-stamp').textContent = xr ? 'XRechnung' : 'EN 16931';
    const digest = await crypto.subtle.digest('SHA-256', (plain ? new TextEncoder().encode(plain.xml) : result.pdf) as BufferSource);
    $('#checksum-file').textContent = main.download;
    $('#checksum').textContent = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
    // Both files are written from the same data: what is said about it is said once.
    const findings = [...result.findings, ...(plain?.findings ?? [])].filter(
      (finding, i, all) => all.findIndex((other) => other.code === finding.code && other.path === finding.path && other.message === finding.message) === i,
    );
    noted = findings;
    renderNotes();
    // The stamp reads like a seal: it lands only where neither the check nor the writing of the file found anything.
    $('#done .stamp').hidden = findings.length > 0 || document.querySelector('#summary li') !== null;
    status.textContent = '';
    // The finished page shows the same preview, with the stamp landing on it. A page that is still being drawn is
    // waited for: leaving now would copy an empty sheet and leave the preview without a page to come back to.
    await drawing.catch(() => {});
    const [from, to] = [$<HTMLCanvasElement>('#preview'), $<HTMLCanvasElement>('#done-preview')];
    Object.assign(to, { width: from.width, height: from.height });
    to.getContext('2d')!.drawImage(from, 0, 0);
    show('done');
    // The project's own site counts that a file was created and of which kind, nothing of the invoice. Any other build counts nothing.
    countVisit('created', { format: xr ? 'xrechnung' : 'pdf' });
  } catch (error) {
    status.textContent = t('create.failed', { m: reasonOf(error) });
  } finally {
    button.disabled = false;
    validate();
  }
};
$('#again').onclick = () => show('work');
$('#another').onclick = () => show('start');
