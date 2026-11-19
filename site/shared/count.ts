// Counts a visit on the project's own website (see counter.ts). In a build without the ID of a website this is
// nothing: the constant below is empty, and what follows it is left out of the build.
import { COUNTER_ORIGIN, visitOf } from './counter.js';

/** The ID of the website in the counter, put in by the build; empty in a build that does not count. */
declare const COUNTER_WEBSITE_ID: string;

/** Counting happens on the project's own address only, not on a copy served elsewhere. */
const DOMAIN = 'pdf-to-einvoice.app';
/** Where the browser notes that visits are not to be counted; the privacy policy offers the switch. */
export const NOT_COUNTED = 'umami.disabled';

let session: string | undefined;
let refused = false;

function wanted(): boolean {
  if (!COUNTER_WEBSITE_ID || refused || location.hostname !== DOMAIN) return false;
  if ([navigator.doNotTrack, (window as { doNotTrack?: string }).doNotTrack].some((value) => value === '1' || value === 'yes')) return false;
  try {
    return localStorage.getItem(NOT_COUNTED) === null;
  } catch {
    // A browser that blocks the local storage cannot note the switch: Do Not Track is its way to say no.
    return true;
  }
}

function send(name?: string, data?: Record<string, string>): void {
  if (!wanted()) return;
  const payload = visitOf(
    {
      website: COUNTER_WEBSITE_ID,
      href: location.href,
      referrer: document.referrer,
      title: document.title,
      language: navigator.language,
      screen: `${screen.width}x${screen.height}`,
    },
    name,
    data,
  );
  void fetch(`${COUNTER_ORIGIN}/api/send`, {
    method: 'POST',
    keepalive: true,
    credentials: 'omit',
    headers: {
      'Content-Type': 'application/json',
      'x-umami-website-id': COUNTER_WEBSITE_ID,
      'x-umami-hostname': location.hostname,
      ...(session === undefined ? {} : { 'x-umami-cache': session }),
    },
    body: JSON.stringify({ type: 'event', payload }),
  })
    .then((response) => response.json())
    .then((answer: { cache?: string; disabled?: boolean } | null) => {
      // The server hands back a token that ties the requests of one visit together, and may say that it does not count.
      session = answer?.cache;
      refused = Boolean(answer?.disabled);
    })
    .catch(() => {
      // The counter is not reachable: the page works all the same.
    });
}

/**
 * Counts this page view, or with a `name` that something happened and of which kind. Nothing of an invoice is ever
 * passed in. In a build without the ID of a website this does nothing, and the code above is not part of the build.
 */
export const countVisit: (name?: string, data?: Record<string, string>) => void = COUNTER_WEBSITE_ID ? send : () => {};
