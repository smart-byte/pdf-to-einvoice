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
npm run eval:reader -- <folder>   # how much the reader gets right, see CONTRIBUTING.md
```

A change is done when `npm test`, `npm run type-check`, `npm run lint` and `npm run format:check` pass.

## Where things are

| path                             | what it holds                                                                                  |
| -------------------------------- | ---------------------------------------------------------------------------------------------- |
| `src/model.ts`                   | the invoice data model and its JSON Schema                                                     |
| `src/calculate.ts`               | totals and VAT in exact cents                                                                  |
| `src/check.ts`                   | required fields, formats, arithmetic, the XRechnung rules, comparison with the text of the PDF |
| `src/text.ts`, `src/guess.ts`    | text and layout of a PDF, and reading an invoice from them without a model                     |
| `src/ground.ts`                  | drops what a language model returned but the PDF does not show                                 |
| `src/ubl.ts`, `src/create.ts`    | the XML (in the PDF, or alone as XRechnung) and the PDF/A-3 file                               |
| `src/read.ts`, `src/validate.ts` | reading and checking an existing e-invoice                                                     |
| `src/cli.ts`, `src/mcp.ts`       | command line and MCP server; `server.json` describes the server for registries                 |
| `site/`                          | the web app; it imports `src/` directly                                                        |
| `test/`, `examples/`             | tests and the invented sample invoice                                                          |

## Rules

- Code, comments and documentation are in English. Every text on the website exists in English and German
  (`site/i18n.ts`).
- No real invoice and no data from one enters the repository, not in fixtures, tests, screenshots or issues.
  `examples/` is invented; `npm run sample` rebuilds it.
- The reader must not be fitted to single layouts. A change to `src/guess.ts` or `src/text.ts` comes with the table
  of `npm run eval:reader` before and after. A wrong value is worse than a missing one.
- A change to how files are written comes with `npm run test:reference`.
- Money is calculated in whole cents (`src/calculate.ts`), never in floating point euros.
- The website makes no request to a third party except the model download the user asks for. No CDN, no analytics,
  no web fonts from elsewhere.
- New dependencies only where they clearly beat a few lines of own code, and no release younger than 14 days
  (`npm install --before=<date>`; Dependabot waits as long).
- Write the test first and watch it fail.
