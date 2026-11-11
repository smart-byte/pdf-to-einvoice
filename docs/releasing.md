# Releasing

For maintainers.

## A new version on npm

1. Move the "Unreleased" section of `CHANGELOG.md` under the new version and its date, and set the same version in
   `package.json` (`npm version <x.y.z> --no-git-tag-version` also updates the lockfile).
2. Merge that change, then start the "Release" workflow by hand on main (Actions → Release → Run workflow). Nothing
   else starts it: publishing to npm cannot be undone.
3. It checks the version against the changelog and the existing tags, runs the checks and the reference validation,
   publishes to npm with a provenance statement, and then creates the tag `v<x.y.z>` and the GitHub release from the
   changelog section.

npm trusts the workflow directly (trusted publishing), so no token is stored. On npmjs.com the package's settings
name repository `smart-byte/pdf-to-einvoice` and workflow file `release.yml` as its trusted publisher.

## The website

The "Deploy site" workflow builds `site/` and publishes it to Cloudflare. It runs only when started by hand on main
(Actions → Deploy site → Run workflow): a merge does not change the live site. The site is a Worker that serves
static files only (`site/wrangler.jsonc`) at https://pdf-to-einvoice.app; response headers are set in
`site/public/_headers`. The page counter is part of that site only: the workflow hands the build the repository variable
`ANALYTICS_WEBSITE_ID`, the ID of the website in our Umami. Without it a build has no counter, and its privacy policy
does not describe one. The workflow needs two repository secrets: `CLOUDFLARE_API_TOKEN` (template "Edit Cloudflare
Workers", limited to the account and the zone) and `CLOUDFLARE_ACCOUNT_ID`.

## Repository settings the project relies on

- A ruleset protects main: no deletion, no force-push. A second one lets only admins move or delete a version tag
  (`v*`) once it exists; the release workflow creates them.
- Actions: the workflow token is read-only unless a workflow asks for more, Actions may not approve pull requests,
  and only GitHub's own actions and `cloudflare/wrangler-action` may run. Workflows from pull requests of outside
  contributors wait for approval.
- The environment `production` deploys from main only.
- Private vulnerability reporting is switched on (`SECURITY.md` sends reporters there).
- Dependabot waits 14 days before it proposes a new release (`.github/dependabot.yml`).
