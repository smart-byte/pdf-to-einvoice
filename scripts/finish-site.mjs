// Adds to the built website what the bundler does not write:
//
// - third-party-licenses.txt: the licence texts of everything the site ships. MIT, Apache-2.0, the SIL Open Font
//   License and others ask for their text to travel with every copy, and a bundle is a copy.
// - llms-full.txt: the README, for language models that want the whole documentation in one file.
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
console.log(`third-party-licenses.txt: ${packages.size} packages, ${byText.size} licence texts, ${withoutText.length} without a text file`);
