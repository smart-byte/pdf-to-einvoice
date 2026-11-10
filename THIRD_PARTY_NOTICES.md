# Third-party notices

pdf-to-einvoice's own code is the TypeScript in `src/` and `site/`. It builds on the following components. The
npm package declares them as dependencies; the web app bundles them. Their licences apply to those parts.

## Used by the library, the CLI and the web app

- **@e-invoice-eu/core** — Guido Flohr, WTFPL. Writes the CII XML and embeds it into the PDF. Its browser bundle
  contains **ajv** (MIT), **xmlbuilder2** (MIT), **jsonpath-plus** (MIT), **@e965/xlsx** (Apache-2.0),
  **@esgettext/runtime** (WTFPL) and **tslib** (0BSD), and it embeds an sRGB colour profile into the files it
  writes. https://github.com/gflohr/e-invoice-eu
- **@cantoo/pdf-lib** — a maintained fork of pdf-lib by Andrew Dillon, MIT. https://github.com/cantoo-scribe/pdf-lib
- **pdf.js** (`pdfjs-dist`) — Mozilla Foundation, Apache-2.0. https://github.com/mozilla/pdf.js
- **fast-xml-parser** — Amit Gupta, MIT. https://github.com/NaturalIntelligence/fast-xml-parser

## Used by the MCP server

- **@modelcontextprotocol/sdk** — Anthropic, PBC, MIT. https://github.com/modelcontextprotocol/typescript-sdk

## Used by the web app only

- **WebLLM** (`@mlc-ai/web-llm`) — MLC AI, Apache-2.0. Loaded only when the user chooses "Read with AI".
  https://github.com/mlc-ai/web-llm
- **Schibsted Grotesk** — Schibsted, SIL Open Font License 1.1 (via `@fontsource-variable/schibsted-grotesk`).
- **JetBrains Mono** — JetBrains, SIL Open Font License 1.1 (via `@fontsource-variable/jetbrains-mono`).

Language models are not part of this project or its bundles. The page offers to download them from
huggingface.co (and their program code from raw.githubusercontent.com) at the user's request; the defaults are Qwen2.5-1.5B-Instruct and Qwen3-4B (Alibaba Cloud,
Apache-2.0) and Phi-3.5-mini-instruct (Microsoft, MIT), in the builds published by MLC AI.

## In the sample invoice

- `examples/sample-invoice.pdf` embeds subsets of **DejaVu Sans** (Bitstream Vera licence and public domain
  additions). https://dejavu-fonts.github.io/License.html
