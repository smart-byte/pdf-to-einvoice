import { describe, expect, it } from 'vitest';
import { calculate, percentAgrees, slackOf } from '../src/calculate.js';
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

  it('takes a percentage discount off the line, rounded to the cent', () => {
    const t = calculate(invoice([line({ quantity: 3, unitPrice: 33.33, discount: { percent: 10 } })]));
    expect(t.lineDiscounts).toEqual([{ base: 99.99, amount: 10 }]);
    expect(t.lineNet).toEqual([89.99]);
    expect(t.vat).toBe(17.1);
  });

  it('takes an amount discount as given, also beside a percentage', () => {
    expect(calculate(invoice([line({ quantity: 2, unitPrice: 249.5, discount: { amount: 50 } })])).lineNet).toEqual([449]);
    expect(calculate(invoice([line({ discount: { percent: 10, amount: 10.01 } })])).lineNet).toEqual([89.99]);
  });

  it('keeps the sign of a discount on a line with a negative quantity', () => {
    expect(calculate(invoice([line({ quantity: -1, discount: { percent: 10 } })])).lineNet).toEqual([-90]);
    expect(calculate(invoice([line({ quantity: -1, discount: { amount: -10 } })])).lineNet).toEqual([-90]);
    expect(calculate(invoice([line({ quantity: -1, unitPrice: 0.05, discount: { percent: 10 } })])).lineDiscounts).toEqual([{ base: -0.05, amount: -0.01 }]);
  });

  it('compares a discount with its percentage before rounding, as Peppol R040 does', () => {
    expect(percentAgrees(0.15, 10, 0.04, 0.02)).toBe(false); // 0.015 is 0.025 away, though it rounds to 0.02
    expect(percentAgrees(0.15, 10, 0.03, 0.02)).toBe(true);
    expect(percentAgrees(-99.75, 10, -9.995, 0.02)).toBe(true);
    expect(percentAgrees(499, 10, 49.92, 0.02)).toBe(true);
    expect(percentAgrees(499, 10, 49.93, 0.02)).toBe(false);
    expect(percentAgrees(4990, 10, 499.5, slackOf('HUF'))).toBe(true);
  });

  it('prefers the printed line total to the discount, and leaves lines without one alone', () => {
    const t = calculate(invoice([line({ netAmount: 90.5, discount: { percent: 10 } }), line()]));
    expect(t.lineNet).toEqual([90.5, 100]);
    expect(t.lineDiscounts).toEqual([{ base: 100, amount: 10 }, undefined]);
  });
});
