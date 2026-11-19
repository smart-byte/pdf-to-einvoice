# Notes for coding agents

This file is for agents that change this repository. To _use_ the tool as an agent, see "For AI assistants" in the
[README](README.md), the [skill](skills/pdf-to-einvoice/SKILL.md) and [llms.txt](site/public/llms.txt).

## Commands

Node 22.13 or newer (`.nvmrc`), npm.

```bash
npm install
npm test                    # unit tests (vitest)
npm run type-check          # library and website
npm run lint                # oxlint
npm run format              # prettier; `npm run format:check` only checks
npm run build               # the package into dist/
npm run site                # the web app on http://localhost:4350
npm run site:build          # the static site into site-dist/
npm run test:reference      # validates generated e-invoices; needs Java and the validator, see CONTRIBUTING.md
npm run test:browser        # the web app in Chrome, on the built site
npm run eval:reader -- <folder>   # how much the reader gets right, see CONTRIBUTING.md
```

A change is done when `npm test`, `npm run type-check`, `npm run lint` and `npm run format:check` pass.

## Where things are

`src/` is split into layers, one folder each ([docs/architecture.md](docs/architecture.md) shows how an invoice moves
through them). A layer imports only the layers listed beside it;
`test/architecture.test.ts` enforces this, and that there is no cycle between files. `test/` has the same folders, and
`test/site/` for the web app.

| path                 | what it holds                                                                                      | imports          |
| -------------------- | -------------------------------------------------------------------------------------------------- | ---------------- |
| `src/domain/`        | the data model and its JSON Schema (`model.ts`), totals in exact cents (`calculate.ts`), the rules | nothing else     |
|                      | the data has to meet (`check.ts`), the one rule for a VAT rate both use (`vat.ts`), how a date or  |                  |
|                      | an amount is printed (`spellings.ts`), `Finding`, what all of them report (`finding.ts`), and the  |                  |
|                      | English text of every finding (`messages.ts`)                                                      |                  |
| `src/pdf/`           | text and layout of a PDF (`text.ts`), its structure, embedded XML and PDF/A repair (`file.ts`)     | nothing else     |
| `src/extract/`       | reading an invoice from the text without a model (`guess.ts`, parts in `guess/`), dropping         | domain           |
|                      | what a language model returned but the PDF does not show (`ground.ts`)                             |                  |
| `src/generate/`      | the XML (`ubl.ts`) and the e-invoice, in the PDF/A-3 or alone as XRechnung (`create.ts`)           | domain, pdf      |
| `src/inspect/`       | reading (`read-xml.ts`) and checking (`validate.ts`) an existing e-invoice                         | domain, pdf      |
| `src/adapters/`      | command line (`cli.ts`), MCP server (`mcp.ts`), and the work with files on disk both share         | all of the above |
|                      | (`files.ts`); `server.json` describes the server for registries                                    |                  |
| `src/util/`          | small helpers without a subject of their own (`escapeRegExp`, `isNumber`, `messageOf`,             | nothing else     |
|                      | `valueAt`); every layer may use them                                                               |                  |
| `src/index.ts`       | the public API of the package                                                                      | all but adapters |
| `site/`              | the web app: `app/` the start page (`main.ts` loads one module per section), `legal/` the          |                  |
|                      | legal pages, `shared/` what both use. A part uses `shared/` and `src/`, never another part or      |                  |
|                      | `src/adapters/`, and there is no cycle between its files                                           |                  |
| `test/`, `examples/` | tests, by layer, and the invented sample invoice                                                   |                  |

## Rules

- Code, comments and documentation are in English. Every text on the website exists in English and German
  (`site/shared/i18n.ts`).
- No real invoice and no data from one enters the repository, not in fixtures, tests, screenshots or issues.
  `examples/` is invented; `npm run sample` rebuilds it.
- The reader must not be fitted to single layouts. A change to `src/extract/guess.ts`, `src/extract/guess/` or
  `src/pdf/text.ts` comes with the table of `npm run eval:reader` before and after. A wrong value is worse than a
  missing one.
- A change to how files are written comes with `npm run test:reference`.
- A change to the website comes with `npm run test:browser`; a new flow gets a test in `test/site/browser.test.ts`.
- A finding gets its code and its English text from `src/domain/messages.ts`, through `error()` and `warning()` of
  `src/domain/finding.ts`. A new code needs a German text in `site/shared/i18n.ts`; `test/site/i18n.test.ts` says
  which.
- Money is calculated in whole cents (`src/domain/calculate.ts`), never in floating point euros.
- The website makes no request to a third party except the model download the user asks for. No scripts, styles or
  fonts from another origin, in any build. One further request exists, to the page counter of the project
  (`site/shared/counter.ts`, `site/shared/count.ts`): only a build that is given `ANALYTICS_WEBSITE_ID` counts, with the code in
  this repository, and its privacy policy describes it. Nothing of an invoice is ever passed to it.
- New dependencies only where they clearly beat a few lines of own code, and no release younger than 14 days
  (`npm install --before=<date>`; Dependabot waits as long).
- Write the test first and watch it fail.
