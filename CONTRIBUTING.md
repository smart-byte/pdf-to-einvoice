# Contributing

Thanks for helping out. The project stays small on purpose: established libraries do the heavy lifting (XML,
PDF, text extraction), and this repository adds the data model, the checks and the front ends.

## Setup

```bash
npm install            # Node >= 22.13, see .nvmrc
npm test               # unit tests (vitest)
npm run type-check     # tsc for src/, test/ and site/
npm run lint           # oxlint
npm run format:check   # prettier
npm run build          # dist/ for the package and the CLI
npm run site           # the web app on http://localhost:4350
npm run site:build     # bundle the web app into site-dist/
npm run sample         # regenerate examples/sample-invoice.pdf from its JSON
```

## Reference validation

`npm test` checks this project's own logic. Whether a generated file really is a valid e-invoice is decided by
a reference validator, the Mustang command line tool: it runs veraPDF (PDF/A-3) and the official EN 16931 /
Factur-X Schematron rules. It needs Java 11 or newer:

```bash
curl -LO https://github.com/ZUGFeRD/mustangproject/releases/download/core-2.26.0/Mustang-CLI-2.26.0.jar
MUSTANG_JAR=$PWD/Mustang-CLI-2.26.0.jar npm run test:reference
```

CI runs this on every push. A new kind of invoice (a VAT category, a document type, a field that changes the XML)
gets a case in `test/reference.test.ts`.

## Measuring the reader

Reading an invoice from its text must not be fitted to a few layouts. A hybrid e-invoice carries its own answer: the
data is in its XML, so the text of the page can be read and compared with it. The public
[ZUGFeRD corpus](https://github.com/ZUGFeRD/corpus) has such files from several vendors:

```bash
git clone --depth 1 https://github.com/ZUGFeRD/corpus.git /tmp/corpus
npm run build
npm run eval:reader -- /tmp/corpus/ZUGFeRDv2/correct            # table: correct, missing, wrong per field
npm run eval:reader -- /tmp/corpus/ZUGFeRDv2/correct --files    # what each file lacks
```

The same script measures reading with a language model, where the web app runs it: in Chrome with WebGPU. It takes
about a minute per invoice, so take a sample. Chrome has to be installed; the model is downloaded once.

```bash
npm run eval:reader -- /tmp/corpus/ZUGFeRDv2/correct --sample 4 --model Qwen2.5-1.5B-Instruct-q4f16_1-MLC
```

Its second table compares three ways of reading the same invoices: the rules alone, the model alone (after dropping
what the page does not show), and what the web app does: the rules first, the model for what they left empty. A
change to the models in `site/llm.ts`, to the prompt or to `src/ground.ts` comes with that table before and after.

A wrong value is worse than a missing one: a missing value is asked for, a wrong one may end up in the XML unnoticed.
A change to `src/guess.ts` or `src/text.ts` comes with the table before and after. Keep the corpus out of this
repository, and do not write rules for a single vendor's sample: most of its files come from very few generators.

## Pull requests

- One change per PR, with a test that fails without it. Tests assert behaviour through the public functions.
- All code, comments and docs are in English. The web app is bilingual: every text has an `en` and a `de` entry in
  `site/i18n.ts`.
- No real invoices in the repository. Fixtures are made up (`examples/`), and `npm run sample` draws the PDF.
- Messages shown to users say what is wrong and what to do. Errors thrown by the library are `InvoiceError`s with
  a `code`; findings have a stable `code` that front ends translate.
- Third-party code that ends up in `dist/` or in the site must be listed in `THIRD_PARTY_NOTICES.md`.
- Run `npm run type-check && npm run lint && npm run format:check && npm test && npm run build` before pushing; CI
  runs the same.

## Dependencies

New dependencies need a reason a few lines of code cannot meet. Install with a cool-down so that a release
published in the last two weeks is never pulled in:

```bash
npm install --before="$(date -v-14d +%F)" <package>     # macOS; on Linux: date -d '14 days ago' +%F
```

## Reporting bugs

Say which front end you used (web app, CLI, library, MCP) and what happened. If a PDF is involved, please do not
attach a real invoice: reduce it to a made-up one that still shows the problem.
