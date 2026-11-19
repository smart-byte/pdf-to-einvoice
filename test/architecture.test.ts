import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// The layers of `src/`, and which layers each may import. Like a package rule in ArchUnit: a folder alone does not
// stop an import, this test does. AGENTS.md describes the layers.
const LAYERS: Record<string, string[]> = {
  /** The invoice data, its totals and the rules it has to meet. Knows nothing of PDFs or files. */
  domain: ['domain'],
  /** Reading the text of a PDF and its structure; knows nothing of invoices. */
  pdf: ['pdf'],
  /** Invoice data from the text of a PDF. */
  extract: ['domain', 'extract'],
  /** The e-invoice from invoice data: XML, and the PDF/A-3 that carries it. */
  generate: ['domain', 'pdf', 'generate'],
  /** Reading and checking an existing e-invoice. */
  inspect: ['domain', 'pdf', 'inspect'],
  /** Command line and MCP server: files on disk, arguments, output. */
  adapters: ['domain', 'pdf', 'extract', 'generate', 'inspect', 'adapters'],
};
/** The public API of the package may export every layer except the adapters, which need Node. */
const INDEX = ['domain', 'pdf', 'extract', 'generate', 'inspect'];
/** Entry points: nothing in `src/` imports them. The command line starts the MCP server, never the other way round. */
const ENTRY_POINTS = ['adapters/cli.ts'];

const root = fileURLToPath(new URL('..', import.meta.url));
const src = join(root, 'src');
const IMPORT = /(?:\bfrom\s*|\bimport\s*\(\s*)'(\.{1,2}\/[^']+)'/g;

const sources = (dir: string) =>
  (readdirSync(join(root, dir), { recursive: true }) as string[]).filter((file) => file.endsWith('.ts')).map((file) => join(root, dir, file));

/** The files of the project a source file imports, by relative path; `.js` stands for the `.ts` beside it. */
const importsOf = (file: string) => [...readFileSync(file, 'utf8').matchAll(IMPORT)].map((match) => resolve(dirname(file), match[1]!.replace(/\.js$/, '.ts')));

const inSrc = (file: string) => relative(src, file).split('/');
/** The folder under `src/` a file is in; `index.ts` for the public API. */
const layerOf = (file: string) => inSrc(file)[0]!;

describe('the layers of src/', () => {
  const files = sources('src');

  it('puts every file into a layer', () => {
    const stray = files.map((file) => relative(src, file)).filter((path) => path !== 'index.ts' && !((path.split('/')[0] ?? '') in LAYERS));
    expect(stray).toEqual([]);
  });

  it('imports only from the layers each layer may use', () => {
    const wrong = files.flatMap((file) => {
      const from = layerOf(file);
      const allowed = from === 'index.ts' ? INDEX : (LAYERS[from!] ?? []);
      return importsOf(file)
        .filter((target) => !relative(src, target).startsWith('..'))
        .filter((target) => !allowed.includes(layerOf(target)!))
        .map((target) => `${relative(src, file)} -> ${relative(src, target)}`);
    });
    expect(wrong).toEqual([]);
  });

  it('imports no entry point', () => {
    const wrong = files.flatMap((file) =>
      importsOf(file)
        .filter((target) => ENTRY_POINTS.includes(relative(src, target)))
        .map((target) => `${relative(src, file)} -> ${relative(src, target)}`),
    );
    expect(wrong).toEqual([]);
  });

  it('has no cycle between files, not even through a type', () => {
    const graph = new Map(files.map((file) => [file, importsOf(file).filter((target) => files.includes(target))]));
    const cycles: string[] = [];
    const done = new Set<string>();
    const visit = (file: string, path: string[]) => {
      const seen = path.indexOf(file);
      if (seen >= 0) {
        cycles.push([...path.slice(seen), file].map((f) => relative(src, f)).join(' -> '));
        return;
      }
      if (done.has(file)) return;
      for (const target of graph.get(file) ?? []) visit(target, [...path, file]);
      done.add(file);
    };
    for (const file of files) visit(file, []);
    expect(cycles).toEqual([]);
  });

  it('keeps the adapters, which need Node, out of the web app', () => {
    const wrong = sources('site').flatMap((file) =>
      importsOf(file)
        .filter((target) => inSrc(target)[0] === 'adapters')
        .map((target) => `${relative(root, file)} -> ${relative(root, target)}`),
    );
    expect(wrong).toEqual([]);
  });
});
