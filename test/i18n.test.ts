import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { check } from '../src/check.js';
import type { InvoiceDraft } from '../src/model.js';

const source = (file: string) => readFileSync(new URL(`../src/${file}`, import.meta.url), 'utf8');

/**
 * Every code the library can put on a finding or an `InvoiceError`, read from its source: the argument right before
 * the message where a finding is added (`error(path, 'required', 'The ...')`), the value of `code:`, and the first
 * argument of an `InvoiceError`. The checks of `xrechnungFindings` add the prefix `xrechnung-` to theirs.
 */
function libraryCodes(): Set<string> {
  const literal = `'([a-z]+(?:-[a-z]+)*)'`;
  const codesIn = (text: string) =>
    [
      new RegExp(`,\\s*${literal},\\s*(?:'[A-Z]|\`(?:[A-Z]|\\$\\{))`, 'g'),
      new RegExp(`\\bcode: ${literal}`, 'g'),
      new RegExp(`new InvoiceError\\(${literal}`, 'g'),
    ].flatMap((pattern) => [...text.matchAll(pattern)].map((match) => match[1]!));
  const rules = source('check.ts');
  const start = rules.indexOf('function xrechnungFindings(');
  const end = rules.indexOf('\n}\n', start);
  return new Set([
    ...codesIn(rules.slice(0, start) + rules.slice(end) + source('create.ts') + source('validate.ts')),
    ...codesIn(rules.slice(start, end)).map((code) => `xrechnung-${code}`),
  ]);
}

const sample = (): InvoiceDraft => JSON.parse(readFileSync(new URL('../examples/sample-invoice.json', import.meta.url), 'utf8'));

describe('German texts', () => {
  it('reads the codes the library produces from its source', () => {
    // Drafts that are wrong in many ways at once: what the library says about them must be among the codes read.
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
    const { STRINGS } = await import('../site/i18n.js');
    expect([...libraryCodes()].filter((code) => !STRINGS[`e.${code}`]?.de)).toEqual([]);
    vi.unstubAllGlobals();
  });
});
