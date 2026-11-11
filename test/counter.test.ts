import { describe, expect, it } from 'vitest';
import { COUNTER_ORIGIN, counterTag, forBuild } from '../site/counter.js';

describe('the page counter of the project website', () => {
  it('is in no build that is not given the ID of a website', () => {
    expect(counterTag(undefined, 'pdf-to-einvoice.app')).toEqual([]);
    expect(counterTag('', 'pdf-to-einvoice.app')).toEqual([]);
  });

  it('counts on the named domain only, honours Do Not Track and sends neither query string nor fragment', () => {
    expect(counterTag('an-id', 'pdf-to-einvoice.app')).toEqual([
      {
        tag: 'script',
        injectTo: 'head',
        attrs: {
          defer: true,
          src: `${COUNTER_ORIGIN}/script.js`,
          'data-website-id': 'an-id',
          'data-domains': 'pdf-to-einvoice.app',
          'data-do-not-track': 'true',
          'data-exclude-search': 'true',
          'data-exclude-hash': 'true',
        },
      },
    ]);
  });

  it('leaves in a page only what holds for the build', () => {
    const page = [
      '<p>always</p>',
      '  <!-- with-counter -->',
      '  <p>we count</p>',
      '  <!-- /with-counter -->',
      '  <!-- without-counter -->',
      '  <p>no analytics</p>',
      '  <!-- /without-counter -->',
      '<p>end</p>',
    ].join('\n');
    expect(forBuild(page, false)).toBe('<p>always</p>\n  <p>no analytics</p>\n<p>end</p>');
    expect(forBuild(page, true)).toBe('<p>always</p>\n  <p>we count</p>\n<p>end</p>');
  });
});
