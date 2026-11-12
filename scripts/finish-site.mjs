// Adds to the built website what the bundler does not write:
//
// - third-party-licenses.txt: the licence texts of everything the site ships. MIT, Apache-2.0, the SIL Open Font
//   License and others ask for their text to travel with every copy, and a bundle is a copy.
// - llms-full.txt: the README, for language models that want the whole documentation in one file.
// - de.html and en.html: the start page once per language, at pdf-to-einvoice.app/de and /en, in that language
//   before any script runs. Search engines and link previews read the HTML; the start page at / follows the visitor.
//
// Run by `npm run site:build` after the bundler.
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const out = join(root, 'site-dist');
const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));

// Everything in `dependencies` counts as shipped, with all it depends on. That is a little more than the site
// bundles (the MCP SDK runs in Node only), which does no harm. Packages the site bundles although they are
// development dependencies of the package are named here: add a new one when the site starts to import it.
const SITE_ONLY = ['@mlc-ai/web-llm', '@fontsource-variable/schibsted-grotesk', '@fontsource-variable/jetbrains-mono'];

/** The folder of a package as Node would find it from `from`: the nearest node_modules that has it. */
function locate(name, from) {
  for (let dir = from; ; dir = dirname(dir)) {
    const candidate = join(dir, 'node_modules', name);
    if (existsSync(join(candidate, 'package.json'))) return candidate;
    if (dir === dirname(dir)) return undefined;
  }
}

const packages = new Map();
const queue = [...Object.keys(manifest.dependencies), ...SITE_ONLY].map((name) => [name, root]);
for (const [name, from] of queue) {
  const dir = locate(name, from);
  // An optional dependency that is not installed is not shipped either.
  if (!dir || packages.has(dir)) continue;
  const info = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
  const files = readdirSync(dir).filter((file) => /^(licen[cs]e|copying|notice)/i.test(file));
  packages.set(dir, {
    id: `${info.name} ${info.version}`,
    licence: info.license,
    text: files.map((file) => readFileSync(join(dir, file), 'utf8').trim()).join('\n\n'),
  });
  for (const dependency of Object.keys({ ...info.dependencies, ...info.optionalDependencies })) queue.push([dependency, dir]);
}

// Many packages carry the same text: it is printed once, under the names of all of them.
const byText = new Map();
const withoutText = [];
for (const { id, licence, text } of [...packages.values()].sort((a, b) => a.id.localeCompare(b.id))) {
  if (!licence && !text) throw new Error(`${id} states no licence: it cannot be shipped without one`);
  if (!text) withoutText.push(`${id} (${licence})`);
  else byText.set(text, [...(byText.get(text) ?? []), `${id} (${licence ?? 'see text'})`]);
}

const rule = '-'.repeat(80);
const sections = [...byText].map(([text, ids]) => `${ids.join('\n')}\n\n${text}`);
if (withoutText.length) sections.push(`These packages name their licence without shipping its text:\n\n${withoutText.join('\n')}`);
writeFileSync(
  join(out, 'third-party-licenses.txt'),
  [readFileSync(join(root, 'THIRD_PARTY_NOTICES.md'), 'utf8').trim(), ...sections].join(`\n\n${rule}\n\n`) + '\n',
);
writeFileSync(join(out, 'llms-full.txt'), readFileSync(join(root, 'README.md'), 'utf8'));

const SITE = 'https://pdf-to-einvoice.app/';
const GERMAN_TITLE = 'pdf-to-einvoice: Aus Ihrer PDF-Rechnung wird eine E-Rechnung';
// What a start page of one language says in its head. index.html is in English; German replaces its texts.
const START_PAGES = {
  en: {},
  de: {
    title: GERMAN_TITLE,
    meta: {
      description:
        'Machen Sie aus der PDF-Rechnung, die Sie schon haben, eine E-Rechnung nach EN 16931 (ZUGFeRD / Factur-X). Ihr Layout bleibt, die Daten kommen als XML dazu. Kostenlos, quelloffen, und alles passiert in Ihrem Browser.',
      'og:title': GERMAN_TITLE,
      'og:description':
        'Ihr Layout bleibt, die Rechnungsdaten kommen als XML nach EN 16931 dazu (ZUGFeRD / Factur-X). Kostenlos, quelloffen, und nichts wird hochgeladen.',
      'og:image': `${SITE}og-de.png`,
      'og:image:alt': 'pdf-to-einvoice: eine Rechnung mit gelb markierten Werten, dahinter die Fassung für Maschinen, das XML der E-Rechnung.',
      'twitter:title': GERMAN_TITLE,
      'twitter:image': `${SITE}og-de.png`,
    },
  },
};

/** Replaces what `pattern` finds, and fails the build when the start page no longer has it. */
const swap = (html, pattern, replacement) => {
  if (!pattern.test(html)) throw new Error(`index.html has nothing that matches ${pattern}`);
  return html.replace(pattern, replacement);
};
const start = readFileSync(join(out, 'index.html'), 'utf8');
for (const [lang, { title, meta = {} }] of Object.entries(START_PAGES)) {
  const address = `${SITE}${lang}`;
  let html = swap(start, /<html lang="[a-z]+">/, `<html lang="${lang}">`);
  html = swap(html, /(<link rel="canonical" href=")[^"]*/, `$1${address}`);
  if (title) html = swap(html, /(<title[^>]*>)[^<]*/, `$1${title}`);
  for (const [key, value] of Object.entries({ 'og:url': address, ...meta })) {
    html = swap(html, new RegExp(`(<meta\\s+(?:name|property)="${key}"\\s+content=")[^"]*`), `$1${value}`);
  }
  writeFileSync(join(out, `${lang}.html`), html);
}
