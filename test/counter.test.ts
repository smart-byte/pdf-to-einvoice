import { describe, expect, it } from 'vitest';
import { COUNTER_ORIGIN, forBuild, visitOf } from '../site/counter.js';

describe('the page counter of the project website', () => {
  const page = {
    website: 'an-id',
    href: 'https://pdf-to-einvoice.app/privacy?lang=de#de',
    referrer: 'https://example.org/a?b=c#d',
    title: 'Privacy',
    language: 'de-DE',
    screen: '1280x800',
  };

  it('sends where a page is and where the visitor came from, without query string or fragment', () => {
    expect(visitOf(page)).toEqual({
      website: 'an-id',
      hostname: 'pdf-to-einvoice.app',
      url: 'https://pdf-to-einvoice.app/privacy',
      referrer: 'https://example.org/a',
      title: 'Privacy',
      language: 'de-DE',
      screen: '1280x800',
    });
  });

  it('names a page of the site itself by its path when the visitor came from there', () => {
    expect(visitOf({ ...page, referrer: 'https://pdf-to-einvoice.app/?lang=de' }).referrer).toBe('/');
    expect(visitOf({ ...page, referrer: '' }).referrer).toBe('');
  });

  it('adds the name of what happened and its kind, and nothing else', () => {
    expect(visitOf(page, 'created', { format: 'pdf' })).toEqual({ ...visitOf(page), name: 'created', data: { format: 'pdf' } });
  });

  it('is served from the one host a counted page talks to', () => {
    expect(COUNTER_ORIGIN).toBe('https://analytics.smart-byte.com');
  });

  it('leaves in a page only what holds for the build', () => {
    const html = [
      '<p>always</p>',
      '  <!-- with-counter -->',
      '  <p>we count</p>',
      '  <!-- /with-counter -->',
      '  <!-- without-counter -->',
      '  <p>no analytics</p>',
      '  <!-- /without-counter -->',
      '<p>end</p>',
    ].join('\n');
    expect(forBuild(html, false)).toBe('<p>always</p>\n  <p>no analytics</p>\n<p>end</p>');
    expect(forBuild(html, true)).toBe('<p>always</p>\n  <p>we count</p>\n<p>end</p>');
  });
});
