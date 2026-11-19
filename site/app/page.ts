// The preview of the PDF: its pages, and marks where the values of the form stand on them.
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import pdfWorkerUrl from 'pdfjs-dist/legacy/build/pdf.worker.mjs?url';
import { $, el } from './dom.js';
import { getPath, isEmpty } from './draft.js';
import { fieldLabel } from './wording.js';
import { t } from '../shared/i18n.js';
import { locate, pageToShow, type Piece, type Rect } from './locate.js';
import { state } from './state.js';

pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

/** The text of every page with the place of each piece, in percent of its page. A page that is not read yet, or a scan, has none. */
let pagePieces: Piece[][] = [];
/** The page the preview shows, counted from 0, and the one it was last asked for: drawing a page takes a moment. */
let shown = 0;
let wanted = 0;
const marks = $('#marks');
export const focusedPath = () => (document.activeElement as HTMLElement | null)?.dataset.path;
/** The total the pointer rests on: it stays the marked one while its page is being turned to. */
let pointed: string | undefined;

// Known limit: letters are measured in the browser's sans-serif, not in the font of the PDF, so a mark inside a long
// piece of text can be off by a letter. Measure with the embedded font if that shows.
const ruler = document.createElement('canvas').getContext('2d')!;
ruler.font = '16px sans-serif';
const widthOf = (text: string) => ruler.measureText(text).width;

/** Shows the marks of one value strongly and lets the others step back; without a path all are shown faintly. */
export function highlight(path?: string): void {
  marks.classList.toggle('is-focused', path !== undefined);
  for (const mark of marks.children) mark.classList.toggle('is-active', (mark as HTMLElement).dataset.for === path);
}

/** Where the value of a field, or one of the totals, is printed among the pieces of one page. */
function placesOf(path: string, on: Piece[]): Rect[] {
  const find = (value: unknown, beside?: Rect[]) => locate(on, value, { beside, widthOf });
  const total = /^totals\.(net|vat|gross)$/.exec(path);
  if (total) return find(state.result?.totals?.[total[1] as 'net' | 'vat' | 'gross'] || undefined);
  const value = getPath(state.draft, path);
  if (isEmpty(value)) return [];
  const line = /^(lines\.\d+)\.(\w+)$/.exec(path);
  // The numbers of a line item are looked for next to its name: a "2" elsewhere on the page is not its quantity.
  // Known limit: the rate is looked for as "19 %" anywhere, since most invoices print it with the totals only; "7,5 %" is not found.
  return !line || line[2] === 'name'
    ? find(value)
    : line[2] === 'vatRate'
      ? find(`${value} %`)
      : find(value, find(getPath(state.draft, `${line[1]}.name`)));
}

/** Marks on the page that is shown, where the values of the form are printed there. A value that stands on another page gets its mark when that page is shown. */
export function renderMarks(): void {
  marks.replaceChildren();
  const taken = new Set<string>();
  const placed: { mark: HTMLElement; rect: Rect }[] = [];
  const place = (path: string, label: string, rects: Rect[]) => {
    for (const rect of rects) {
      const box = { left: `${rect.x}%`, top: `${rect.y}%`, width: `${rect.width}%`, height: `${rect.height}%` };
      const twin = taken.size === taken.add(Object.values(box).join()).size;
      const mark = el('button', {
        type: 'button',
        className: `mark${twin ? ' mark--twin' : ''}`,
        tabIndex: -1,
        title: t('mark.title', { f: label }),
      });
      mark.dataset.for = path;
      Object.assign(mark.style, box);
      // How far down the page the mark is: the band of light uncovers it when it gets there.
      mark.style.setProperty('--y', String(rect.y / 100));
      marks.append(mark);
      placed.push({ mark, rect });
    }
  };
  const on = pagePieces[shown] ?? [];
  // Dropdowns hold codes, which are not printed; everything else is looked for.
  for (const input of $('#form').querySelectorAll<HTMLElement>('[data-path]:not(select)')) {
    const path = input.dataset.path!;
    place(path, fieldLabel(path), placesOf(path, on));
  }
  for (const key of ['net', 'vat', 'gross'] as const)
    place(`totals.${key}`, t(`t.${key}`), placesOf(`totals.${key}`, on));
  // A value printed inside another one, such as the due date in the sentence of the payment terms, lies on top of it:
  // both marks can be pointed at.
  const inside = (inner: Rect, outer: Rect) =>
    inner.width * inner.height < outer.width * outer.height &&
    Math.abs(inner.x + inner.width / 2 - outer.x - outer.width / 2) < outer.width / 2 &&
    Math.abs(inner.y + inner.height / 2 - outer.y - outer.height / 2) < outer.height / 2;
  for (const { mark, rect } of placed) if (placed.some((other) => inside(rect, other.rect))) mark.style.zIndex = '1';
  $('#marks-note').hidden = marks.children.length === 0;
  renderPager();
  highlight(pointed ?? focusedPath());
}

/** Turns the preview to the page a value stands on, unless the page that is shown has it too. */
export function turnTo(path: string): void {
  const page = pageToShow(pagePieces, shown, (on) => placesOf(path, on).length > 0);
  if (page === undefined || page === shown) return;
  void showPage(page).then(
    () => ($('#page-live').textContent = t('page.turned', { n: page + 1, f: fieldLabel(path) })),
  );
}

$('#form').addEventListener('focusin', (event) => {
  const field = event.target as HTMLElement;
  // Dropdowns hold codes, which are printed nowhere: they turn no page.
  if (field.dataset.path && !(field instanceof HTMLSelectElement)) turnTo(field.dataset.path);
  highlight(field.dataset.path);
});
$('#form').addEventListener('focusout', () => highlight());
marks.addEventListener('click', (event) => {
  const path = (event.target as HTMLElement).dataset.for;
  const field = path && document.querySelector<HTMLElement>(`[data-path="${path}"]`);
  if (field) {
    field.closest('details')?.setAttribute('open', '');
    field.focus();
  } else if (path) $('#totals').scrollIntoView({ block: 'center' });
});

/** The band of light over the preview: it keeps travelling while a model reads, and passes once when a PDF was opened. */
export function scan(mode: 'on' | 'once' | 'off'): void {
  const band = $('#scan');
  band.dataset.mode = mode;
  band.hidden = mode === 'off';
}
$('#scan').addEventListener('animationend', () => scan('off'));

/** The PDF that is open, as pdf.js holds it: its pages are drawn when they are turned to. */
let opened: { task: pdfjs.PDFDocumentLoadingTask; doc: pdfjs.PDFDocumentProxy } | undefined;

/** The text of a page with the place of every piece, in percent of the page. */
async function piecesOf(page: pdfjs.PDFPageProxy): Promise<Piece[]> {
  // Measured here and not taken from extractLayout: the marks lie on the drawing of the page, so they use its view of the page.
  // Known limit: upright text only. Text that is printed turned gets its mark in the wrong place; use the whole text matrix if such invoices turn up.
  const viewport = page.getViewport({ scale: 1 });
  return (await page.getTextContent()).items.flatMap((item) => {
    if (!('str' in item) || !item.str.trim()) return [];
    const [x, y, height] = [item.transform[4] as number, item.transform[5] as number, item.height];
    // From a little below the baseline to the top of the tall letters.
    const [x1, y1] = viewport.convertToViewportPoint(x, y - 0.25 * height) as [number, number];
    const [x2, y2] = viewport.convertToViewportPoint(x + item.width, y + 0.85 * height) as [number, number];
    return [
      {
        text: item.str,
        x: (Math.min(x1, x2) / viewport.width) * 100,
        y: (Math.min(y1, y2) / viewport.height) * 100,
        width: (Math.abs(x2 - x1) / viewport.width) * 100,
        height: (Math.abs(y2 - y1) / viewport.height) * 100,
      },
    ];
  });
}

/** Says which page is shown, and lets the pages be turned where there is more than one. */
function renderPager(): void {
  const count = opened?.doc.numPages ?? 1;
  $('#pager').hidden = count < 2;
  $('#page-now').textContent = t('page.now', { n: shown + 1, m: count });
  $<HTMLButtonElement>('#page-prev').disabled = shown === 0;
  $<HTMLButtonElement>('#page-next').disabled = shown >= count - 1;
  $('#preview').setAttribute('aria-label', t('work.preview', { n: shown + 1 }));
}

/**
 * Draws one page of the open PDF, counted from 0, and shows its marks. A page is drawn when it is turned to and kept
 * nowhere: only one drawn page is in memory at a time, however long the PDF is.
 */
async function drawPage(index: number): Promise<void> {
  const pdf = opened;
  if (!pdf || index < 0 || index >= pdf.doc.numPages) return;
  wanted = index;
  const page = await pdf.doc.getPage(index + 1);
  const canvas = $<HTMLCanvasElement>('#preview');
  const viewport = page.getViewport({
    scale: (Math.min(720, canvas.parentElement!.clientWidth) / page.getViewport({ scale: 1 }).width) * devicePixelRatio,
  });
  // The preview is not on the screen (another view is shown): it has no width to draw a page into.
  if (!viewport.width) return;
  // Drawn beside the stage and put on it when done: turning on while a page is still being drawn leaves no half page behind.
  const sheet = el('canvas', { width: viewport.width, height: viewport.height });
  await page.render({ canvas: sheet, viewport }).promise;
  pagePieces[index] ??= await piecesOf(page);
  // Another page was turned to, or another PDF opened, while this one was drawn.
  if (opened !== pdf || wanted !== index) return;
  shown = index;
  Object.assign(canvas, { width: sheet.width, height: sheet.height });
  canvas.getContext('2d')!.drawImage(sheet, 0, 0);
  renderMarks();
}
/** The page that is being drawn, for whoever needs the finished preview. */
export let drawing: Promise<void> = Promise.resolve();
const showPage = (index: number): Promise<void> => (drawing = drawPage(index));
$('#page-prev').onclick = () => showPage(wanted - 1);
$('#page-next').onclick = () => showPage(wanted + 1);

export async function preview(pdf: Uint8Array): Promise<void> {
  const before = opened;
  opened = undefined;
  await before?.task.destroy();
  const task = pdfjs.getDocument({ data: pdf.slice(), verbosity: 0 });
  const mine = (opened = { task, doc: await task.promise });
  pagePieces = [];
  shown = 0;
  await showPage(0);
  // The other pages are read in the background, so that a value that stands on one of them can be turned to.
  void (async () => {
    for (let index = 1; index < mine.doc.numPages && opened === mine; index++)
      pagePieces[index] ??= await piecesOf(await mine.doc.getPage(index + 1));
  })().catch(() => {
    // The PDF was closed while its pages were read: nothing is left to read.
  });
}

/** Points at a value that has no field, a total for one, or at nothing: its marks stand out until it is let go. */
export function point(path?: string): void {
  pointed = path;
}

/** Forgets the pieces of the pages read so far, when a file is opened that is not shown page by page. */
export function forgetPages(): void {
  pagePieces = [];
}
