# Releasing

For maintainers.

## A new version on npm

1. Move the "Unreleased" section of `CHANGELOG.md` under the new version and its date, and set the same version in
   `package.json` (`npm version <x.y.z> --no-git-tag-version` also updates the lockfile).
2. Merge that change, then tag the merge commit and push the tag: `git tag v<x.y.z> && git push origin v<x.y.z>`.
3. The "Release" workflow checks the tag against `package.json` and the changelog, runs the checks and the reference
   validation, publishes to npm with a provenance statement and creates the GitHub release from the changelog
   section.

npm trusts the workflow directly (trusted publishing), so no token is stored. On npmjs.com the package's settings
name repository `smart-byte/pdf-to-einvoice` and workflow file `release.yml` as its trusted publisher.

## The website

The "Deploy site" workflow builds `site/` and publishes it to Cloudflare on every push to main that touches the site,
the library or the examples; it can also be started by hand. The site is a Worker that serves static files only
(`site/wrangler.jsonc`) at https://pdf-to-einvoice.app; the domain lives in the same Cloudflare account. The workflow
needs two repository secrets: `CLOUDFLARE_API_TOKEN` (template "Edit Cloudflare Workers", limited to the account and
the zone) and `CLOUDFLARE_ACCOUNT_ID`. Response headers are set in `site/public/_headers`.

Model downloads are cached per address: after a move to another domain, users load their model once more.

## Repository settings the project relies on

- A ruleset protects main: no deletion, no force-push, changes through pull requests with the checks `test` and
  `reference` passed.
- Private vulnerability reporting is switched on (`SECURITY.md` sends reporters there).
- Dependabot waits 14 days before it proposes a new release (`.github/dependabot.yml`).
- Description and topics make the project findable: e-invoice, einvoice, e-rechnung, zugferd, factur-x, en16931,
  invoice, pdf, pdf-a, electronic-invoicing, mcp, mcp-server, llm, ai-tools, typescript, browser, privacy, webgpu,
  cli.
