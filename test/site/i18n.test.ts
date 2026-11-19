import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { check } from '../../src/domain/check.js';
import { codeOf, MESSAGES, type MessageKey } from '../../src/domain/messages.js';
import type { InvoiceDraft } from '../../src/domain/model.js';

/** Every code the library can put on a finding or an `InvoiceError`: the catalog of its texts lists each one. */
const libraryCodes = () => new Set(Object.keys(MESSAGES).map((key) => codeOf(key as MessageKey)));

const sample = (): InvoiceDraft => JSON.parse(readFileSync(new URL('../../examples/sample-invoice.json', import.meta.url), 'utf8'));

describe('German texts', () => {
  it('finds every code the library produces in the catalog of its texts', () => {
    // Drafts that are wrong in many ways at once: what the library says about them must be in the catalog.
    const empty = check({ typeCode: '386', lines: [{ vatCategory: 'K', vatRate: 19 }] } as InvoiceDraft, { rules: 'xrechnung', pdfText: '' });
    const odd = check(
      {
        ...sample(),
        paymentTerms: '#SKONTO#',
        periodStart: '2026-10-31',
        periodEnd: '2026-10-01',
        seller: { ...sample().seller, phone: '1', email: 'mail' },
        lines: [
          { ...sample().lines![0]!, netAmount: 1 },
          { ...sample().lines![0]!, unitPrice: -1 },
        ],
        totals: { gross: 1 },
      },
      { rules: 'xrechnung', pdfText: 'Rechnung' },
    );
    const produced = new Set([...empty.findings, ...odd.findings].map((finding) => finding.code));
    expect(produced.size).toBeGreaterThan(20);
    expect([...produced].filter((code) => !libraryCodes().has(code))).toEqual([]);
  });

  it('has a German text for every code', async () => {
    // The page's module reads the language from the address it is served at.
    vi.stubGlobal('location', new URL('https://pdf-to-einvoice.app/'));
    const { STRINGS } = await import('../../site/shared/i18n.js');
    expect([...libraryCodes()].filter((code) => !STRINGS[`e.${code}`]?.de)).toEqual([]);
    vi.unstubAllGlobals();
  });

  it('has no German text for a code the library does not know', async () => {
    // A German text left over from a code that was renamed or dropped would never be shown.
    vi.stubGlobal('location', new URL('https://pdf-to-einvoice.app/'));
    const { STRINGS } = await import('../../site/shared/i18n.js');
    // A text may have variants, `e.format.country` beside `e.format`: the code is what stands before them.
    const translated = new Set(Object.keys(STRINGS).flatMap((key) => (key.startsWith('e.') ? [key.split('.')[1]!] : [])));
    expect([...translated].filter((code) => !libraryCodes().has(code))).toEqual([]);
    vi.unstubAllGlobals();
  });
});

describe('Footer', () => {
  it('is the same on every page and leaves the site only for the source', () => {
    const [home, ...others] = ['index.html', 'privacy.html', 'legal-notice.html'].map((page) => {
      const html = readFileSync(new URL(`../../site/${page}`, import.meta.url), 'utf8');
      return [...html.slice(html.indexOf('<footer')).matchAll(/<a href="([^"]+)"/g)].map((match) => match[1]!);
    });
    for (const links of others) expect(links).toEqual(home);
    expect(home!.filter((href) => /^https?:/.test(href))).toEqual(['https://github.com/smart-byte/pdf-to-einvoice']);
  });
});
