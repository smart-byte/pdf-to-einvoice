// Measures how much of an invoice the pattern reader gets right, on PDFs that carry their own answer: hybrid
// e-invoices (ZUGFeRD 2 / Factur-X) hold the data as XML, so the text of the page can be read and compared with it.
// The public corpus https://github.com/ZUGFeRD/corpus has such files from many vendors and layouts:
//
//   git clone --depth 1 https://github.com/ZUGFeRD/corpus.git /tmp/corpus
//   npm run build && node scripts/eval-reader.mjs /tmp/corpus/ZUGFeRDv2/correct
//
// "wrong" is worse than "missing": a missing value is asked for, a wrong one may go unnoticed.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';

const [root, ...flags] = process.argv.slice(2);
if (!root) throw new Error('usage: node scripts/eval-reader.mjs <folder with e-invoice PDFs> [--files] [--skipped] [--lib path/to/dist/index.js]');
const libPath = flags.includes('--lib') ? flags[flags.indexOf('--lib') + 1] : new URL('../dist/index.js', import.meta.url).pathname;
const lib = await import(pathToFileURL(libPath).href);

const walk = (dir) =>
  readdirSync(dir).flatMap((name) => (statSync(join(dir, name)).isDirectory() ? walk(join(dir, name)) : /\.pdf$/i.test(name) ? [join(dir, name)] : []));
const text = (v) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().toLowerCase() : v);
const id = (v) => (typeof v === 'string' ? v.replace(/\s+/g, '').toUpperCase() : v);
const cents = (v) => (typeof v === 'number' ? Math.round(v * 100) : v);
/** field name -> how to pick it and how to normalise it for comparison */
const FIELDS = {
  number: [(i) => i.number, text],
  issueDate: [(i) => i.issueDate, text],
  'seller.name': [(i) => i.seller?.name, text],
  'seller.postalCode': [(i) => i.seller?.postalCode, id],
  'seller.vatId': [(i) => i.seller?.vatId, id],
  'buyer.name': [(i) => i.buyer?.name, text],
  'buyer.postalCode': [(i) => i.buyer?.postalCode, id],
  'totals.net': [(i) => i.totals?.net, cents],
  'totals.vat': [(i) => i.totals?.vat, cents],
  'totals.gross': [(i) => i.totals?.gross, cents],
  'lines (count)': [(i) => i.lines?.length || undefined, (v) => v],
  iban: [(i) => i.iban, id],
};

const tally = Object.fromEntries(Object.keys(FIELDS).map((field) => [field, { correct: 0, missing: 0, wrong: 0 }]));
let read = 0;
const skipped = [];
for (const file of walk(root)) {
  const name = relative(root, file);
  try {
    const pdf = new Uint8Array(readFileSync(file));
    const xml = await lib.readEmbeddedXml(pdf);
    if (xml === null) throw new Error('no embedded XML');
    const truth = lib.readInvoiceXml(xml).invoice;
    const layout = lib.extractLayout ? await lib.extractLayout(pdf) : { text: await lib.extractText(pdf) };
    if (!layout.text.trim()) throw new Error('no text layer');
    // Some samples carry the XML of another invoice than the page shows: no answer key for that page.
    if (!id(layout.text).includes(id(truth.number))) throw new Error('the page does not show the invoice number of its XML');
    const guess = lib.guessFromText(layout.text, layout);
    read++;
    const marks = [];
    for (const [field, [pick, normalise]] of Object.entries(FIELDS)) {
      const expected = normalise(pick(truth));
      if (expected === undefined) continue;
      const got = normalise(pick(guess));
      const verdict = got === undefined ? 'missing' : got === expected ? 'correct' : 'wrong';
      tally[field][verdict]++;
      if (verdict !== 'correct') marks.push(`${verdict === 'wrong' ? '✗' : '–'}${field}`);
    }
    if (flags.includes('--files')) console.log(`${name}: ${marks.join(' ') || 'all read'}`);
  } catch (error) {
    skipped.push(`${name}: ${error.message.slice(0, 80)}`);
  }
}

console.log(`\n${read} invoices compared, ${skipped.length} skipped`);
console.log('field'.padEnd(20), 'correct'.padStart(8), 'missing'.padStart(8), 'wrong'.padStart(8));
let [sumCorrect, sumAll, sumWrong] = [0, 0, 0];
for (const [field, t] of Object.entries(tally)) {
  const all = t.correct + t.missing + t.wrong;
  if (!all) continue;
  const share = (n) => `${Math.round((100 * n) / all)} %`.padStart(8);
  console.log(field.padEnd(20), share(t.correct), share(t.missing), share(t.wrong), `  (${all})`);
  sumCorrect += t.correct;
  sumAll += all;
  sumWrong += t.wrong;
}
console.log(
  'all fields'.padEnd(20),
  `${Math.round((100 * sumCorrect) / sumAll)} %`.padStart(8),
  ''.padStart(8),
  `${Math.round((100 * sumWrong) / sumAll)} %`.padStart(8),
);
if (flags.includes('--skipped')) console.log('\nskipped:\n' + skipped.join('\n'));
