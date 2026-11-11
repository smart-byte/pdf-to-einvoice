# Contributing

Thanks for helping out. The project stays small on purpose: established libraries do the heavy lifting (XML,
PDF, text extraction), and this repository adds the data model, the checks and the front ends.

The commands, a map of the code and the rules are in [AGENTS.md](AGENTS.md); they hold for people as for coding
agents. Everyone who takes part is expected to follow the [code of conduct](CODE_OF_CONDUCT.md).

## Pull requests

- One change per PR, with a test that fails without it. Tests assert behaviour through the public functions.
- Messages shown to users say what is wrong and what to do. Findings and `InvoiceError`s carry a stable `code` that
  front ends translate.
- Third-party code that ends up in `dist/` or in the site is listed in `THIRD_PARTY_NOTICES.md`.
- Run `npm run type-check && npm run lint && npm run format:check && npm test && npm run build` before pushing; CI
  runs the same.

## Reference validation

`npm test` checks this project's own logic. Whether a generated file conforms is checked by a reference validator,
the Mustang command line tool: veraPDF for PDF/A-3 and the official EN 16931, Factur-X and XRechnung rules. It needs
Java 11 or newer:

```bash
curl -LO https://github.com/ZUGFeRD/mustangproject/releases/download/core-2.26.0/Mustang-CLI-2.26.0.jar
MUSTANG_JAR=$PWD/Mustang-CLI-2.26.0.jar npm run test:reference
```

CI runs this on every push. A new kind of invoice (a VAT category, a document type, a field that changes the XML)
gets a case in `test/reference.test.ts`.

## Measuring the reader

A hybrid e-invoice carries its own answer: the data is in its XML, so what is read from the page can be compared
with it. The public [ZUGFeRD corpus](https://github.com/ZUGFeRD/corpus) has such files from several vendors:

```bash
git clone --depth 1 https://github.com/ZUGFeRD/corpus.git /tmp/corpus
npm run build
npm run eval:reader -- /tmp/corpus/ZUGFeRDv2/correct            # table: correct, missing, wrong per field
npm run eval:reader -- /tmp/corpus/ZUGFeRDv2/correct --files    # what each file lacks
npm run eval:reader -- /tmp/corpus/ZUGFeRDv2/correct --sample 4 --model Qwen2.5-1.5B-Instruct-q4f16_1-MLC
```

The last line also reads with a language model, as the web app does: in Chrome with WebGPU, about a minute per
invoice. Its second table compares the rules alone, the model alone, and the rules with the model for what they left
empty.

A change to `src/guess.ts`, `src/text.ts`, `src/ground.ts`, the prompt or the models in `site/llm.ts` comes with the
table before and after. Keep the corpus out of this repository, and write no rule for a single vendor's sample: most
of its files come from very few generators.

## Dependencies

A new dependency needs a reason a few lines of code cannot meet. Install with a cool-down, so that a release
published in the last two weeks is never pulled in:

```bash
npm install --before="$(date -v-14d +%F)" <package>     # macOS; on Linux: date -d '14 days ago' +%F
```

## Reporting bugs

Say which front end you used (web app, CLI, library, MCP) and what happened. Please do not attach a real invoice:
reduce it to a made-up one that still shows the problem.
