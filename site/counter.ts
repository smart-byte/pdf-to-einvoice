// The page counter of the project's own website: a cookieless Umami that the project runs itself. A build gets it only
// when it is given the ID of a website, as the deployment of the project is. Any other build, a local one or one of a
// fork, loads no script from elsewhere and counts nothing. Nothing here touches the browser.

/** Where the counter is served from: the only origin besides the site itself a counted page may run a script of. */
export const COUNTER_ORIGIN = 'https://analytics.smart-byte.com';

/**
 * The script of the counter for a website ID, or nothing without one. It counts only on the named domain, leaves out
 * browsers that send Do Not Track, and sends neither the query string nor the fragment of an address.
 */
export function counterTag(websiteId: string | undefined, domain: string) {
  if (!websiteId) return [];
  const attrs = {
    defer: true,
    src: `${COUNTER_ORIGIN}/script.js`,
    'data-website-id': websiteId,
    'data-domains': domain,
    'data-do-not-track': 'true',
    'data-exclude-search': 'true',
    'data-exclude-hash': 'true',
  };
  return [{ tag: 'script', attrs, injectTo: 'head' as const }];
}

/**
 * Keeps of a page only what holds for the build: the parts between `<!-- with-counter -->` and its closing mark in a
 * build that counts, those between `<!-- without-counter -->` in one that does not. The marks themselves go.
 */
export function forBuild(html: string, counted: boolean): string {
  const [keep, drop] = counted ? ['with-counter', 'without-counter'] : ['without-counter', 'with-counter'];
  return html
    .replace(new RegExp(`[ \\t]*<!-- ${drop} -->[\\s\\S]*?<!-- /${drop} -->\\n?`, 'g'), '')
    .replace(new RegExp(`[ \\t]*<!-- /?${keep} -->\\n?`, 'g'), '');
}
