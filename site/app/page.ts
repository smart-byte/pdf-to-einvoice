// The preview of the PDF: its pages, and marks where the values of the form stand on them.
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import pdfWorkerUrl from 'pdfjs-dist/legacy/build/pdf.worker.mjs?url';
import { $, el } from './dom.js';
import { valueAt } from '../../src/util/objects.js';
import { isEmpty } from './draft.js';
import { fieldLabel } from './wording.js';
import { t } from '../shared/i18n.js';
import { locate, pageToShow, type Piece, type Rect } from './locate.js';
import { state } from './state.js';

pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

/** The PDF that is open, as pdf.js holds it, and what the preview knows of it. Another PDF replaces all of it. */
interface Opened {
  task: pdfjs.PDFDocumentLoadingTask;
  doc: pdfjs.PDFDocumentProxy;
  /** The text of every page with the place of each piece, in percent of its page. A page not read yet, or a scan, has none. */
  pieces: Piece[][];
  /** The page the preview shows, counted from 0, and the one it was last asked for: drawing a page takes a moment. */
  shown: number;
  wanted: number;
}
let opened: Opened | undefined;
/** The page that is being drawn. */
let drawing: Promise<void> = Promise.resolve();
/** The total the pointer rests on: it stays the marked one while its page is being turned to. */
let pointed: string | undefined;

const marks = $('#marks');

// Known limit: letters are measured in the browser's sans-serif, not in the font of the PDF, so a mark inside a long
// piece of text can be off by a letter. Measure with the embedded font if that shows.
const ruler = document.createElement('canvas').getContext('2d')!;
ruler.font = '16px sans-serif';

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
$('#scan').addEventListener('animationend', () => scan('off'));
$('#page-prev').onclick = () => showPage((opened?.wanted ?? 0) - 1);
$('#page-next').onclick = () => showPage((opened?.wanted ?? 0) + 1);

export async function preview(pdf: Uint8Array): Promise<void> {
  const before = opened;
  opened = undefined;
  await before?.task.destroy();
  const task = pdfjs.getDocument({ data: pdf.slice(), verbosity: 0 });
  const mine: Opened = { task, doc: await task.promise, pieces: [], shown: 0, wanted: 0 };
  opened = mine;
  await showPage(0);
  void readOtherPages(mine).catch(() => {
    // The PDF was closed while its pages were read: nothing is left to read.
  });
}

/** The other pages are read in the background, so that a value that stands on one of them can be turned to. */
async function readOtherPages(mine: Opened): Promise<void> {
  for (let index = 1; index < mine.doc.numPages && opened === mine; index++)
    mine.pieces[index] ??= await piecesOf(await mine.doc.getPage(index + 1));
}

function showPage(index: number): Promise<void> {
  return (drawing = drawPage(index));
}

/** The page that is being drawn, for whoever needs the finished preview. */
export function pageDrawn(): Promise<void> {
  return drawing;
}

/**
 * Draws one page of the open PDF, counted from 0, and shows its marks. A page is drawn when it is turned to and kept
 * nowhere: only one drawn page is in memory at a time, however long the PDF is.
 */
async function drawPage(index: number): Promise<void> {
  const pdf = opened;
  if (!pdf || index < 0 || index >= pdf.doc.numPages) return;
  pdf.wanted = index;
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
  pdf.pieces[index] ??= await piecesOf(page);
  // Another page was turned to, or another PDF opened, while this one was drawn.
  if (opened !== pdf || pdf.wanted !== index) return;
  pdf.shown = index;
  Object.assign(canvas, { width: sheet.width, height: sheet.height });
  canvas.getContext('2d')!.drawImage(sheet, 0, 0);
  renderMarks();
}

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

/** Marks on the page that is shown, where the values of the form are printed there. A value that stands on another page gets its mark when that page is shown. */
export function renderMarks(): void {
  const on = opened?.pieces[opened.shown] ?? [];
  // Dropdowns hold codes, which are not printed; everything else is looked for.
  const fields = [...$('#form').querySelectorAll<HTMLElement>('[data-path]:not(select)')].map((input) => {
    const path = input.dataset.path!;
    return { path, label: fieldLabel(path) };
  });
  const totals = (['net', 'vat', 'gross'] as const).map((key) => ({ path: `totals.${key}`, label: t(`t.${key}`) }));
  const spots = [...fields, ...totals].flatMap(({ path, label }) =>
    placesOf(path, on).map((rect) => ({ path, label, rect })),
  );
  raiseInner(markAll(spots));
  $('#marks-note').hidden = marks.children.length === 0;
  renderPager();
  highlight(pointed ?? focusedPath());
}

/** A mark for each place a value stands, in their order. A mark on the very place of one before it is its twin. */
function markAll(spots: { path: string; label: string; rect: Rect }[]): { mark: HTMLElement; rect: Rect }[] {
  marks.replaceChildren();
  const taken = new Set<string>();
  return spots.map(({ path, label, rect }) => {
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
    return { mark, rect };
  });
}

/**
 * A value printed inside another one, such as the due date in the sentence of the payment terms, lies on top of it:
 * both marks can be pointed at.
 */
function raiseInner(placed: { mark: HTMLElement; rect: Rect }[]): void {
  for (const { mark, rect } of placed) if (placed.some((other) => inside(rect, other.rect))) mark.style.zIndex = '1';
}

function inside(inner: Rect, outer: Rect): boolean {
  return (
    inner.width * inner.height < outer.width * outer.height &&
    Math.abs(inner.x + inner.width / 2 - outer.x - outer.width / 2) < outer.width / 2 &&
    Math.abs(inner.y + inner.height / 2 - outer.y - outer.height / 2) < outer.height / 2
  );
}

/** Where the value of a field, or one of the totals, is printed among the pieces of one page. */
function placesOf(path: string, on: Piece[]): Rect[] {
  const find = (value: unknown, beside?: Rect[]) => locate(on, value, { beside, widthOf });
  const total = /^totals\.(net|vat|gross)$/.exec(path);
  if (total) return find(state.result?.totals?.[total[1] as 'net' | 'vat' | 'gross'] || undefined);
  const value = valueAt(state.draft, path);
  if (isEmpty(value)) return [];
  const line = /^(lines\.\d+)\.(\w+)$/.exec(path);
  // The numbers of a line item are looked for next to its name: a "2" elsewhere on the page is not its quantity.
  // Known limit: the rate is looked for as "19 %" anywhere, since most invoices print it with the totals only; "7,5 %" is not found.
  if (!line || line[2] === 'name') return find(value);
  if (line[2] === 'vatRate') return find(`${value} %`);
  return find(value, find(valueAt(state.draft, `${line[1]}.name`)));
}

/** Says which page is shown, and lets the pages be turned where there is more than one. */
function renderPager(): void {
  const count = opened?.doc.numPages ?? 1;
  const shown = opened?.shown ?? 0;
  $('#pager').hidden = count < 2;
  $('#page-now').textContent = t('page.now', { n: shown + 1, m: count });
  $<HTMLButtonElement>('#page-prev').disabled = shown === 0;
  $<HTMLButtonElement>('#page-next').disabled = shown >= count - 1;
  $('#preview').setAttribute('aria-label', t('work.preview', { n: shown + 1 }));
}

/** Shows the marks of one value strongly and lets the others step back; without a path all are shown faintly. */
export function highlight(path?: string): void {
  marks.classList.toggle('is-focused', path !== undefined);
  for (const mark of marks.children) mark.classList.toggle('is-active', (mark as HTMLElement).dataset.for === path);
}

export function focusedPath(): string | undefined {
  return (document.activeElement as HTMLElement | null)?.dataset.path;
}

/** Points at a value that has no field, a total for one, or at nothing: its marks stand out until it is let go. */
export function point(path?: string): void {
  pointed = path;
}

/** Turns the preview to the page a value stands on, unless the page that is shown has it too. */
export function turnTo(path: string): void {
  if (!opened) return;
  const page = pageToShow(opened.pieces, opened.shown, (on) => placesOf(path, on).length > 0);
  if (page === undefined || page === opened.shown) return;
  void showPage(page).then(
    () => ($('#page-live').textContent = t('page.turned', { n: page + 1, f: fieldLabel(path) })),
  );
}

/** The band of light over the preview: it keeps travelling while a model reads, and passes once when a PDF was opened. */
export function scan(mode: 'on' | 'once' | 'off'): void {
  const band = $('#scan');
  band.dataset.mode = mode;
  band.hidden = mode === 'off';
}

/** Forgets the pieces of the pages read so far, when a file is opened that is not shown page by page. */
export function forgetPages(): void {
  if (opened) opened.pieces = [];
}

function widthOf(text: string): number {
  return ruler.measureText(text).width;
}
