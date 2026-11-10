// Draws examples/sample-invoice.pdf from examples/sample-invoice.json.
// The result is an ordinary PDF (not PDF/A, no XML): the kind of file people
// already have. All names and numbers in it are made up.
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { PDFDocument, rgb } from '@cantoo/pdf-lib';
import * as fontkit from 'fontkit';

const require = createRequire(import.meta.url);
const here = (path) => new URL(path, import.meta.url);
const invoice = JSON.parse(readFileSync(here('../examples/sample-invoice.json'), 'utf8'));

const money = (n) => `${new Intl.NumberFormat('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n)} €`;
const day = (iso) => iso.split('-').reverse().join('.');
const UNITS = { HUR: 'Std.', C62: 'Stk.' };

const doc = await PDFDocument.create();
doc.registerFontkit(fontkit);
const font = (file) => doc.embedFont(readFileSync(require.resolve(`dejavu-fonts-ttf/ttf/${file}`)), { subset: true });
const regular = await font('DejaVuSans.ttf');
const bold = await font('DejaVuSans-Bold.ttf');

const page = doc.addPage([595.28, 841.89]); // A4
const ink = rgb(0.12, 0.15, 0.14);
const muted = rgb(0.39, 0.44, 0.39);
const accent = rgb(0.91, 0.4, 0.21);
const text = (s, x, y, { size = 9.5, f = regular, color = ink, right = false } = {}) =>
  page.drawText(s, { x: right ? x - f.widthOfTextAtSize(s, size) : x, y, size, font: f, color });
const rule = (y, color = rgb(0.88, 0.9, 0.85)) => page.drawLine({ start: { x: 56, y }, end: { x: 539, y }, thickness: 0.8, color });

const { seller, buyer } = invoice;
page.drawRectangle({ x: 56, y: 770, width: 18, height: 18, color: accent });
text(seller.name, 82, 775, { size: 13, f: bold });
text(`${seller.name} · ${seller.street} · ${seller.postalCode} ${seller.city}`, 56, 700, { size: 7, color: muted });
[buyer.name, buyer.street, `${buyer.postalCode} ${buyer.city}`].forEach((s, i) => text(s, 56, 682 - i * 14));

text('Rechnung', 56, 600, { size: 20, f: bold });
[
  ['Rechnungsnummer', invoice.number],
  ['Rechnungsdatum', day(invoice.issueDate)],
  ['Leistungsdatum', day(invoice.deliveryDate)],
].forEach(([label, value], i) => {
  text(label, 340, 682 - i * 14, { color: muted });
  text(value, 539, 682 - i * 14, { right: true });
});

let y = 560;
text('Pos.', 56, y, { f: bold });
text('Bezeichnung', 90, y, { f: bold });
text('Menge', 360, y, { f: bold, right: true });
text('Einzelpreis', 450, y, { f: bold, right: true });
text('Gesamt', 539, y, { f: bold, right: true });
rule(y - 7, ink);
let net = 0;
invoice.lines.forEach((line, i) => {
  y -= 24;
  const total = line.quantity * line.unitPrice;
  net += total;
  text(String(i + 1), 56, y);
  text(line.name, 90, y);
  text(`${line.quantity} ${UNITS[line.unit] ?? line.unit}`, 360, y, { right: true });
  text(money(line.unitPrice), 450, y, { right: true });
  text(money(total), 539, y, { right: true });
  rule(y - 9);
});

const { totals } = invoice;
y -= 34;
[
  ['Nettobetrag', money(totals.net), regular],
  [`Umsatzsteuer ${invoice.lines[0].vatRate} %`, money(totals.vat), regular],
  ['Gesamtbetrag', money(totals.gross), bold],
].forEach(([label, value, f]) => {
  text(label, 360, y, { f });
  text(value, 539, y, { f, right: true });
  y -= 16;
});

text(`${invoice.paymentTerms} Fällig am ${day(invoice.dueDate)}.`, 56, y - 30);
rule(86);
text(`${seller.name} · ${seller.street} · ${seller.postalCode} ${seller.city} · ${seller.email}`, 56, 70, { size: 7.5, color: muted });
text(`IBAN ${invoice.iban.replace(/(.{4})/g, '$1 ').trim()} · BIC ${invoice.bic} · USt-IdNr. ${seller.vatId}`, 56, 58, { size: 7.5, color: muted });

doc.setTitle(`Rechnung ${invoice.number}`);
writeFileSync(here('../examples/sample-invoice.pdf'), await doc.save());
console.log('examples/sample-invoice.pdf written, net', net);
