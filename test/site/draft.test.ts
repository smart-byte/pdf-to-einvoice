import { describe, expect, it } from 'vitest';
import { merge, normaliseDraft } from '../../site/app/draft.js';
import type { InvoiceDraft } from '../../src/domain/model.js';

/** A draft and the fields the user has typed into, as the page holds them. */
const target = (draft: InvoiceDraft = {}, touched: string[] = []) => ({ draft, touched: new Set(touched) });

describe('merge', () => {
  it('fills in the fields the user has not typed into, and says which', () => {
    const into = target({ seller: { name: 'Typed' } }, ['seller.name']);
    expect(merge(into, { number: 'RE-1', seller: { name: 'Read', city: 'Musterstadt' } })).toEqual([
      'number',
      'seller.city',
    ]);
    expect(into.draft).toEqual({ number: 'RE-1', seller: { name: 'Typed', city: 'Musterstadt' } });
  });

  it('keeps what is there already where only empty fields are to be filled', () => {
    const into = target({ number: 'RE-1' });
    expect(merge(into, { number: 'RE-2', issueDate: '2026-11-03' }, { onlyEmpty: true })).toEqual(['issueDate']);
    expect(into.draft.number).toBe('RE-1');
  });

  it('takes over the lines as a whole, unless the user has typed into one', () => {
    const lines = [{ name: 'Beratung', quantity: '2' }];
    const into = target();
    expect(merge(into, { lines })).toEqual(['lines.0']);
    expect(into.draft.lines).toEqual([{ name: 'Beratung', quantity: 2 }]);
    const typed = target({ lines: [{ name: 'Mine' }] }, ['lines.0.name']);
    expect(merge(typed, { lines })).toEqual([]);
    expect(typed.draft.lines).toEqual([{ name: 'Mine' }]);
  });

  it('turns printed numbers into numbers', () => {
    const into = target();
    merge(into, { prepaidAmount: '1.499,00', totals: { net: '10,50' } } as unknown as InvoiceDraft);
    expect(into.draft).toEqual({ prepaidAmount: 1499, totals: { net: 10.5 } });
  });
});

describe('normaliseDraft', () => {
  it('reads printed numbers as the reader does: three digits behind the only separator are thousands', () => {
    const quantities = ['1.000', '1,000', '0.025', '1.499,00', '1,499.00', '1,5', '12.345.678', 'zwei'];
    expect(normaliseDraft({ lines: quantities.map((quantity) => ({ quantity })) }).lines).toEqual([
      { quantity: 1000 },
      { quantity: 1000 },
      { quantity: 0.025 },
      { quantity: 1499 },
      { quantity: 1499 },
      { quantity: 1.5 },
      { quantity: 12345678 },
      { quantity: 'zwei' },
    ]);
  });

  it('turns the number-like strings of a model answer into numbers, in the lines and in the totals', () => {
    expect(
      normaliseDraft({ lines: [{ name: '10', quantity: '2', unitPrice: '1.499,00' }], totals: { net: '2.998,00' } }),
    ).toMatchObject({ lines: [{ name: '10', quantity: 2, unitPrice: 1499 }], totals: { net: 2998 } });
  });
});
