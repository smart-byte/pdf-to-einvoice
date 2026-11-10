import { describe, expect, it } from 'vitest';
import { calculate } from '../src/calculate.js';
import type { Invoice, Line } from '../src/model.js';

const line = (over: Partial<Line> = {}): Line => ({
  name: 'Item',
  quantity: 1,
  unit: 'C62',
  unitPrice: 100,
  vatCategory: 'S',
  vatRate: 19,
  ...over,
});

const invoice = (lines: Line[], over: Partial<Invoice> = {}): Invoice => ({
  number: '1',
  issueDate: '2026-11-03',
  typeCode: '380',
  currency: 'EUR',
  seller: { name: 'S', country: 'DE' },
  buyer: { name: 'B', country: 'DE' },
  lines,
  ...over,
});

describe('calculate', () => {
  it('adds VAT on top of the net total', () => {
    const t = calculate(invoice([line({ quantity: 10 })]));
    expect(t).toMatchObject({ net: 1000, vat: 190, gross: 1190, due: 1190 });
  });

  it('rounds a line total of exactly half a cent up', () => {
    // 1.005 * 100 is 100.49999999999999 in binary floating point.
    const t = calculate(invoice([line({ quantity: 1, unitPrice: 1.005 })]));
    expect(t.lineNet).toEqual([1.01]);
  });

  it('rounds negative amounts away from zero, mirroring positive ones', () => {
    const t = calculate(invoice([line({ quantity: -1, unitPrice: 1.005 })]));
    expect(t.lineNet).toEqual([-1.01]);
  });

  it('uses the printed line total when one is given', () => {
    const t = calculate(invoice([line({ quantity: 3, unitPrice: 0.333, netAmount: 0.99 })]));
    expect(t.net).toBe(0.99);
  });

  it('calculates VAT once per rate on the summed base, not per line', () => {
    // 7 % of 0.50 is 0.035, so rounding per line gives 3 x 0.04 = 0.12; on the base of 1.50 it is 0.105 -> 0.11.
    const t = calculate(invoice([line({ unitPrice: 0.5, vatRate: 7 }), line({ unitPrice: 0.5, vatRate: 7 }), line({ unitPrice: 0.5, vatRate: 7 })]));
    expect(t.vat).toBe(0.11);
  });

  it('breaks VAT down by category and rate', () => {
    const t = calculate(invoice([line({ unitPrice: 100, vatRate: 19 }), line({ unitPrice: 50, vatRate: 7 }), line({ unitPrice: 20, vatRate: 19 })]));
    expect(t.vatBreakdown).toEqual([
      { category: 'S', rate: 19, taxable: 120, tax: 22.8 },
      { category: 'S', rate: 7, taxable: 50, tax: 3.5 },
    ]);
    expect(t.gross).toBe(196.3);
  });

  it('subtracts what was already paid from the amount due', () => {
    const t = calculate(invoice([line()], { prepaidAmount: 19 }));
    expect(t.due).toBe(100);
  });
});
