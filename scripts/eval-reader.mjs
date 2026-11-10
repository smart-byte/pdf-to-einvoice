// Measures how much of an invoice the reader gets right, on PDFs that carry their own answer: hybrid e-invoices
// (ZUGFeRD 2 / Factur-X) hold the data as XML, so the text of the page can be read and compared with it.
// The public corpus https://github.com/ZUGFeRD/corpus has such files from many vendors and layouts:
//
//   git clone --depth 1 https://github.com/ZUGFeRD/corpus.git /tmp/corpus
//   npm run build && node scripts/eval-reader.mjs /tmp/corpus/ZUGFeRDv2/correct
//
// With `--model <id>` the same invoices are also read by a language model, where the web app runs it: in Chrome
// with WebGPU, through site/llm.ts. That takes about a minute per invoice, so `--sample 4` takes the first four
// usable files of each folder. Chrome has to be installed; the model is downloaded once into `--profile <folder>`.
//
// "wrong" is worse than "missing": a missing value is asked for, a wrong one may go unnoticed.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const [root, ...flags] = process.argv.slice(2);
if (!root)
  throw new Error(
    'usage: node scripts/eval-reader.mjs <folder with e-invoice PDFs> [--files] [--skipped] [--lib path/to/dist/index.js] [--model <id>] [--sample <n>] [--profile <folder>]',
  );
const option = (name) => (flags.includes(name) ? flags[flags.indexOf(name) + 1] : undefined);
const lib = await import(pathToFileURL(option('--lib') ?? fileURLToPath(new URL('../dist/index.js', import.meta.url))).href);
const model = option('--model');
const sample = Number(option('--sample')) || Infinity;

const walk = (dir) =>
  readdirSync(dir)
    .sort()
    .flatMap((name) => (statSync(join(dir, name)).isDirectory() ? walk(join(dir, name)) : /\.pdf$/i.test(name) ? [join(dir, name)] : []));
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
/** For every field the answer key has: whether a reading of the invoice got it. */
const verdicts = (reading, truth) =>
  Object.entries(FIELDS).flatMap(([field, [pick, normalise]]) => {
    const expected = normalise(pick(truth));
    if (expected === undefined) return [];
    const got = normalise(pick(reading));
    return [[field, got === undefined ? 'missing' : got === expected ? 'correct' : 'wrong']];
  });
const count = () => ({ correct: 0, missing: 0, wrong: 0 });

// ---------------------------------------------------------------------------------------------------------------
// Reading with a model

const isEmpty = (v) => v === undefined || v === null || v === '';
/** What the web app does with a model's answer: what the rules found stays, the model fills what is empty. */
function fill(found, answer) {
  const out = structuredClone(found);
  for (const [key, value] of Object.entries(answer ?? {})) {
    if (isEmpty(value)) continue;
    if (key === 'lines') out.lines = out.lines?.length ? out.lines : value;
    else if (typeof value === 'object') out[key] = fill(out[key] ?? {}, value);
    else if (isEmpty(out[key])) out[key] = value;
  }
  return out;
}

/** Opens the web app in Chrome and returns a function that reads a text with the model there. */
async function openModel() {
  const { chromium } = await import('playwright-core');
  const { createServer } = await import('vite');
  const server = await createServer({ configFile: fileURLToPath(new URL('../site/vite.config.ts', import.meta.url)), logLevel: 'error' });
  await server.listen();
  // The profile stays, so the model is downloaded once.
  const profile = option('--profile') ?? join(tmpdir(), 'pdf-to-einvoice-eval-chrome');
  const context = await chromium.launchPersistentContext(profile, { channel: 'chrome', headless: true, args: ['--enable-unsafe-webgpu'] });
  const page = await context.newPage();
  await page.goto(server.resolvedUrls.local[0]);
  // The function runs in the page: it gets the text and the model as arguments, since it sees nothing of this script.
  const inPage = async ([words, modelId]) => (await import('/llm.ts')).readWithBrowserModel(words, modelId, () => {});
  const read = (pageText) => page.evaluate(inPage, [pageText, model]);
  return { read, close: () => context.close().then(() => server.close()) };
}

// ---------------------------------------------------------------------------------------------------------------

const tally = Object.fromEntries(Object.keys(FIELDS).map((field) => [field, count()]));
const ways = { rules: count(), model: count(), 'rules + model': count() };
const browser = model ? await openModel() : undefined;
const taken = {};
const skipped = [];
let [read, unusable, seconds] = [0, 0, 0];
for (const file of walk(root)) {
  const name = relative(root, file);
  const folder = name.split(sep)[0];
  if (taken[folder] >= sample) continue;
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
    taken[folder] = (taken[folder] ?? 0) + 1;
    const marks = [];
    for (const [field, verdict] of verdicts(guess, truth)) {
      tally[field][verdict]++;
      ways.rules[verdict]++;
      if (verdict !== 'correct') marks.push(`${verdict === 'wrong' ? '✗' : '–'}${field}`);
    }
    let took = '';
    if (browser) {
      const started = Date.now();
      // An answer that cannot be used counts as nothing read: every field is missing.
      const answer = await browser.read(layout.text).catch(() => (unusable++, {}));
      // The first invoice waits for the model to load; it is left out of the time per invoice.
      if (read > 1) seconds += (Date.now() - started) / 1000;
      took = `, ${Math.round((Date.now() - started) / 1000)} s`;
      const shown = lib.keepWhatThePdfShows(answer, layout.text);
      for (const [, verdict] of verdicts(shown, truth)) ways.model[verdict]++;
      for (const [, verdict] of verdicts(fill(guess, shown), truth)) ways['rules + model'][verdict]++;
    }
    if (flags.includes('--files') || browser) console.log(`${name}: ${marks.join(' ') || 'all read'}${took}`);
  } catch (error) {
    skipped.push(`${name}: ${error.message.slice(0, 80)}`);
  }
}
await browser?.close();

const share = (n, all) => `${Math.round((100 * n) / all)} %`.padStart(8);
const row = (label, t, note = '') => {
  const all = t.correct + t.missing + t.wrong;
  if (all) console.log(label.padEnd(20), share(t.correct, all), share(t.missing, all), share(t.wrong, all), note && `  ${note}`);
};
console.log(`\n${read} invoices compared, ${skipped.length} skipped`);
console.log('field'.padEnd(20), 'correct'.padStart(8), 'missing'.padStart(8), 'wrong'.padStart(8));
for (const [field, t] of Object.entries(tally)) row(field, t, `(${t.correct + t.missing + t.wrong})`);
row('all fields', ways.rules);
if (model) {
  console.log(`\n${model}: about ${Math.round(seconds / Math.max(1, read - 1))} s per invoice, ${unusable} answers could not be used`);
  console.log('read by'.padEnd(20), 'correct'.padStart(8), 'missing'.padStart(8), 'wrong'.padStart(8));
  for (const [way, t] of Object.entries(ways)) row(way, t);
}
if (flags.includes('--skipped')) console.log('\nskipped:\n' + skipped.join('\n'));
