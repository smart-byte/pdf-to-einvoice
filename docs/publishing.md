# Publishing checklist

For maintainers. The repository starts private; nothing here happens on its own.

## Repository description and topics

So that people and language models find the project, set this on GitHub (the command needs the `gh` CLI):

```bash
gh repo edit smart-byte/pdf-to-einvoice \
  --description "Turn an existing invoice PDF into a valid EN 16931 e-invoice (ZUGFeRD / Factur-X, E-Rechnung) without changing its layout. Browser app, CLI, TypeScript library and MCP server for AI assistants. Runs locally, nothing is uploaded." \
  --add-topic e-invoice --add-topic einvoice --add-topic e-rechnung --add-topic zugferd --add-topic factur-x \
  --add-topic xrechnung --add-topic en16931 --add-topic invoice --add-topic pdf --add-topic pdf-a \
  --add-topic electronic-invoicing --add-topic mcp --add-topic mcp-server --add-topic llm --add-topic ai-tools \
  --add-topic typescript --add-topic browser --add-topic privacy --add-topic webgpu --add-topic cli
```

## Before the repository goes public

- [ ] Read the commit history once more for anything that should not be public.
- [ ] Switch on GitHub Pages with "GitHub Actions" as its source, then run the "Deploy site" workflow (it also runs
      on every push to main that touches the site or the library). The organisation's Team plan allows Pages from a
      private repository; the published site is public either way.
      `gh api -X POST repos/smart-byte/pdf-to-einvoice/pages -f build_type=workflow`
- [ ] Put the address into the repository's "Website" field:
      `gh repo edit smart-byte/pdf-to-einvoice --homepage https://smart-byte.github.io/pdf-to-einvoice/`
- [ ] A custom domain can be put in front later. Model downloads are cached per address, so users load their model
      once more after a move.
- [ ] A German site needs a legal notice and a privacy page; adapt the ones of imagefast.
- [ ] Have a tax adviser read the "Limits" section of the README and the texts under "What you should know" on the
      site.

## Releasing to npm

- [ ] `npm run prepublishOnly` passes and `npm run test:reference` is green.
- [ ] Move the "Unreleased" section of `CHANGELOG.md` under the new version and date.
- [ ] `npm publish --provenance` from CI (trusted publishing), as imagefast does.
