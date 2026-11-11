// The page counter of the project's own website. A build counts only when it is given the ID of a website in the
// Umami that Smart-Byte runs itself, as the deployment of the project is. Any other build, a local one or one of a
// fork, counts nothing and asks no other host. No script from that server runs in the page: what is sent is put
// together here, so that it can be read in the source. Nothing in this file touches the browser.

/** The server that counts: the only host besides the site itself a counted page sends anything to. */
export const COUNTER_ORIGIN = 'https://analytics.smart-byte.com';

/** What a page knows about a visit. */
export interface Visit {
  website: string;
  href: string;
  referrer: string;
  title: string;
  language: string;
  screen: string;
}

/** An address without its query string and fragment. */
const plain = (address: string, base: string): string => {
  try {
    const url = new URL(address, base);
    url.search = '';
    url.hash = '';
    return url.toString();
  } catch {
    return address;
  }
};

/**
 * What is sent for a page view, or for something that happened (`name`, with its kind in `data`): where the page is
 * and where the visitor came from, both without query string and fragment, the title, the language and the size of
 * the screen. It is what the script of Umami sends; the server adds browser, system and country from the request.
 * Known limit: it follows the interface of the Umami in use. If a later version asks differently, counting stops
 * until this is brought in line; nothing else depends on it.
 */
export function visitOf(visit: Visit, name?: string, data?: Record<string, string>) {
  const { origin, hostname } = new URL(visit.href);
  const referrer = visit.referrer && plain(visit.referrer, visit.href);
  return {
    website: visit.website,
    hostname,
    url: plain(visit.href, visit.href),
    // A page of the site itself is named by its path.
    referrer: referrer === origin || referrer.startsWith(`${origin}/`) ? referrer.slice(origin.length) || '/' : referrer,
    title: visit.title,
    language: visit.language,
    screen: visit.screen,
    ...(name ? { name, data } : {}),
  };
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
