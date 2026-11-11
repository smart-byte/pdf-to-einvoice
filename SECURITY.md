# Security policy

pdf-to-einvoice parses PDF files that its users choose and writes invoices that carry legal weight. A file that
crashes or hangs the parser, data that ends up in the XML differently from how it was entered, or anything that
sends invoice content off the device is a security bug here.

## Reporting a vulnerability

Please report privately through GitHub: **Security → Report a vulnerability** on
https://github.com/smart-byte/pdf-to-einvoice. Do not open a public issue for it, and do not attach real invoices.
Include the version, the front end (web app, CLI, library, MCP server) and the steps that reproduce the problem.

## Scope

- Supported: the latest released version.
- The web app is static: no server component, no cookies, no tracking. On its own it only downloads a language model,
  from huggingface.co and raw.githubusercontent.com, and only after the user chooses "Read with AI". A model
  endpoint the user configures receives the invoice text, and the page says so.
- The built pages carry a Content-Security-Policy; `site/vite.config.ts` holds it and says why each exception is
  there.
- The CLI and the MCP server read and write local files only and make no network requests.
- Bugs in the libraries this project builds on (see THIRD_PARTY_NOTICES.md) are best reported upstream as well.
