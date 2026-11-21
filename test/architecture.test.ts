import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// The layers of `src/`, and which layers each may import. Like a package rule in ArchUnit: a folder alone does not
// stop an import, this test does. AGENTS.md describes the layers.
const LAYERS: Record<string, string[]> = {
  /** Small helpers without a subject of their own: escaping, numbers, errors. Every layer may use them. */
  util: ['util'],
  /** The invoice data, its totals and the rules it has to meet. Knows nothing of PDFs or files. */
  domain: ['domain', 'util'],
  /** Reading the text of a PDF and its structure; knows nothing of invoices. */
  pdf: ['pdf', 'util'],
  /** Invoice data from the text of a PDF. */
  extract: ['domain', 'extract', 'util'],
  /** The e-invoice from invoice data: XML, and the PDF/A-3 that carries it. */
  generate: ['domain', 'pdf', 'generate', 'util'],
  /** Reading and checking an existing e-invoice. */
  inspect: ['domain', 'pdf', 'inspect', 'util'],
  /** Command line and MCP server: files on disk, arguments, output. */
  adapters: ['domain', 'pdf', 'extract', 'generate', 'inspect', 'adapters', 'util'],
};
/** The public API of the package may export every layer except the adapters, which need Node. */
const INDEX = ['domain', 'pdf', 'extract', 'generate', 'inspect', 'util'];
/** Entry points: nothing in `src/` imports them. The command line starts the MCP server, never the other way round. */
const ENTRY_POINTS = ['adapters/cli.ts'];

const root = fileURLToPath(new URL('..', import.meta.url));
const src = join(root, 'src');
/** `from '...'`, `import('...')`, and an import for its side effects alone, `import '...'`. */
const IMPORT = /(?:\bfrom\s*|\bimport\s*\(\s*|^import\s+)'(\.{1,2}\/[^']+)'/gm;

const sources = (dir: string) =>
  (readdirSync(join(root, dir), { recursive: true }) as string[])
    .filter((file) => file.endsWith('.ts'))
    .map((file) => join(root, dir, file));

/** The files of the project a source file imports, by relative path; `.js` stands for the `.ts` beside it. */
const importsOf = (file: string) =>
  [...readFileSync(file, 'utf8').matchAll(IMPORT)].map((match) =>
    resolve(dirname(file), match[1]!.replace(/\.js$/, '.ts')),
  );

const inSrc = (file: string) => relative(src, file).split('/');
/** The folder under `src/` a file is in; `index.ts` for the public API. */
const layerOf = (file: string) => inSrc(file)[0]!;

/** Every cycle of imports among `files`, each as the chain of paths that closes it. */
function cyclesIn(files: string[]): string[] {
  const graph = new Map(files.map((file) => [file, importsOf(file).filter((target) => files.includes(target))]));
  const cycles: string[] = [];
  const done = new Set<string>();
  const visit = (file: string, path: string[]) => {
    const seen = path.indexOf(file);
    if (seen >= 0) {
      cycles.push([...path.slice(seen), file].map((f) => relative(root, f)).join(' -> '));
      return;
    }
    if (done.has(file)) return;
    for (const target of graph.get(file) ?? []) visit(target, [...path, file]);
    done.add(file);
  };
  for (const file of files) visit(file, []);
  return cycles;
}

describe('the layers of src/', () => {
  const files = sources('src');

  it('puts every file into a layer', () => {
    const stray = files
      .map((file) => relative(src, file))
      .filter((path) => path !== 'index.ts' && !((path.split('/')[0] ?? '') in LAYERS));
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
    expect(cyclesIn(files)).toEqual([]);
  });

  it('has no cycle between the files of the web app either', () => {
    expect(cyclesIn(sources('site'))).toEqual([]);
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

describe('the tests', () => {
  // Like src/test/java beside src/main/java: the tests of a layer are found in the folder of the same name.
  it('stand in the folder of the layer they test, or of the web app', () => {
    const folders = new Set([...Object.keys(LAYERS), 'site']);
    const stray = sources('test')
      .map((file) => relative(join(root, 'test'), file))
      .filter((path) => path !== 'architecture.test.ts' && !folders.has(path.split('/')[0] ?? ''));
    expect(stray).toEqual([]);
  });
});

// The web app has parts of its own: the start page, the legal pages, and what both use. A page is free to use `src/`
// (except the adapters, see above), but not another page's code.
const SITE_PARTS: Record<string, string[]> = {
  /** The start page: reading a PDF, the form, the check, creating the e-invoice. */
  app: ['app', 'shared'],
  /** The script of the legal notice and the privacy policy. */
  legal: ['legal', 'shared'],
  /** What every page uses: texts in two languages, the theme, the page counter, the style sheet. */
  shared: ['shared'],
};
/** Files of the web app that stand in no part: the configuration of the build, which may use what the pages share. */
const SITE_CONFIG: Record<string, string[]> = { 'vite.config.ts': ['shared'] };

describe('the parts of site/', () => {
  const site = join(root, 'site');
  const files = sources('site');
  const partOf = (file: string) => relative(site, file).split('/')[0]!;

  it('puts every script into a part', () => {
    const stray = files
      .map((file) => relative(site, file))
      .filter((path) => !(path in SITE_CONFIG) && !((path.split('/')[0] ?? '') in SITE_PARTS));
    expect(stray).toEqual([]);
  });

  it('changes what the start page knows of its invoice in state.ts only', () => {
    // The type of `state` forbids replacing one of its fields, or adding to its set and its map. It cannot forbid
    // reaching into the draft, so that is looked for here.
    const WRITE =
      /\bstate\.draft\b[\w.[\]?!]*\s*(?:\?\?=|\|\|=|=(?!=))|\b(?:setPath|merge|Object\.assign)\(\s*state\b|\bdelete\s+state\./;
    const wrong = files
      .filter((file) => partOf(file) === 'app' && !file.endsWith('/state.ts'))
      .flatMap((file) =>
        readFileSync(file, 'utf8')
          .split('\n')
          .flatMap((line, i) => (WRITE.test(line) ? [`${relative(site, file)}:${i + 1}: ${line.trim()}`] : [])),
      );
    expect(wrong).toEqual([]);
  });

  it('imports only from the parts each part may use', () => {
    const wrong = files.flatMap((file) => {
      const path = relative(site, file);
      const allowed = SITE_CONFIG[path] ?? SITE_PARTS[partOf(file)] ?? [];
      return importsOf(file)
        .filter((target) => !relative(site, target).startsWith('..'))
        .filter((target) => !allowed.includes(partOf(target)))
        .map((target) => `${path} -> ${relative(site, target)}`);
    });
    expect(wrong).toEqual([]);
  });
});
