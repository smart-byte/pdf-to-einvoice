import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

// The page's modules read the language from the address they are served at.
vi.stubGlobal('location', new URL('https://pdf-to-einvoice.app/de'));
const { describe: word } = await import('../../site/app/wording.js');
beforeAll(() => vi.stubGlobal('location', new URL('https://pdf-to-einvoice.app/de')));
afterAll(() => vi.unstubAllGlobals());

describe('describe', () => {
  it('words a value the library quotes from the values of the finding, not from its English text', () => {
    const finding = {
      path: 'seller.name',
      code: 'not-written',
      message: 'Some other wording.',
      params: { value: 'A&B' },
    };
    expect(word(finding)).toBe(
      '„A&B“ ließ sich nicht in das XML schreiben. Bitte melden Sie das als Fehler auf GitHub.',
    );
  });

  it('takes the amounts of a line from the finding, as the check calculated them in cents', () => {
    const finding = {
      path: 'lines.3.netAmount',
      code: 'line-net',
      message: '',
      params: { discounted: true, expected: '0.99', stated: '0.50' },
    };
    expect(word(finding)).toMatch(/ergibt 0,99\s€, auf Ihrer Rechnung steht als Betrag dieser Position aber 0,50\s€/);
  });
});
