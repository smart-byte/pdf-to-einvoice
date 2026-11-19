import { describe, expect, it } from 'vitest';
import {
  calculate,
  cents,
  lineAgrees,
  percentAgrees,
  resolveAdjustments,
  slackOf,
  tryCalculate,
} from '../../src/domain/calculate.js';
import type { DocumentAllowance, Invoice, Line } from '../../src/domain/model.js';

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
    const t = calculate(
      invoice([
        line({ unitPrice: 0.5, vatRate: 7 }),
        line({ unitPrice: 0.5, vatRate: 7 }),
        line({ unitPrice: 0.5, vatRate: 7 }),
      ]),
    );
    expect(t.vat).toBe(0.11);
  });

  it('breaks VAT down by category and rate', () => {
    const t = calculate(
      invoice([
        line({ unitPrice: 100, vatRate: 19 }),
        line({ unitPrice: 50, vatRate: 7 }),
        line({ unitPrice: 20, vatRate: 19 }),
      ]),
    );
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
    expect(calculate(invoice([line({ quantity: 2, unitPrice: 249.5, discount: { amount: 50 } })])).lineNet).toEqual([
      449,
    ]);
    expect(calculate(invoice([line({ discount: { percent: 10, amount: 10.01 } })])).lineNet).toEqual([89.99]);
  });

  it('keeps the sign of a discount on a line with a negative quantity', () => {
    expect(calculate(invoice([line({ quantity: -1, discount: { percent: 10 } })])).lineNet).toEqual([-90]);
    expect(calculate(invoice([line({ quantity: -1, discount: { amount: -10 } })])).lineNet).toEqual([-90]);
    expect(
      calculate(invoice([line({ quantity: -1, unitPrice: 0.05, discount: { percent: 10 } })])).lineDiscounts,
    ).toEqual([{ base: -0.05, amount: -0.01 }]);
  });

  it('compares a discount with its percentage before rounding, as Peppol R040 does', () => {
    expect(percentAgrees(0.15, 10, 0.04, 0.02)).toBe(false); // 0.015 is 0.025 away, though it rounds to 0.02
    expect(percentAgrees(0.15, 10, 0.03, 0.02)).toBe(true);
    expect(percentAgrees(-99.75, 10, -9.995, 0.02)).toBe(true);
    expect(percentAgrees(499, 10, 49.92, 0.02)).toBe(true);
    expect(percentAgrees(499, 10, 49.93, 0.02)).toBe(false);
    expect(percentAgrees(4990, 10, 499.5, slackOf('HUF'))).toBe(true);
  });

  it('rounds to the cent half away from zero, also where binary floating point falls short of the half', () => {
    // 1.005 * 100 is 100.49999999999999 in floating point, and 7 * 0.145 is 1.0149999999999999.
    expect(cents(1.005)).toBe(101);
    expect(cents(-1.005)).toBe(-101);
    expect(cents(7 * 0.145)).toBe(102);
    expect(cents(10.004)).toBe(1000);
  });

  it('compares a line total with quantity times price less the discount before rounding', () => {
    expect(lineAgrees(10, 49.9, 0, 499.02, 0.02)).toBe(true);
    expect(lineAgrees(10, 49.9, 0, 499.03, 0.02)).toBe(false);
    expect(lineAgrees(1, 1.005, 0.02, 0.985, 0)).toBe(true);
    expect(lineAgrees(-2, 50, -10, -90, 0.02)).toBe(true);
    expect(lineAgrees(1, 500, 0, 499.5, slackOf('HUF'))).toBe(true);
    expect(lineAgrees(1, 500, 0, 499.49, slackOf('HUF'))).toBe(false);
  });

  it('prefers the printed line total to the discount, and leaves lines without one alone', () => {
    const t = calculate(invoice([line({ netAmount: 90.5, discount: { percent: 10 } }), line()]));
    expect(t.lineNet).toEqual([90.5, 100]);
    expect(t.lineDiscounts).toEqual([{ base: 100, amount: 10 }, undefined]);
  });
});

describe('discounts and charges on the whole invoice', () => {
  const at = (vatRate: number, over: Partial<Line> = {}) => line({ vatRate, ...over });
  const mixed = [at(7), at(19)];
  const freight = (over: DocumentAllowance = {}): DocumentAllowance => ({ amount: 5, reason: 'Fracht', ...over });
  const problems = (lines: Line[], over: Partial<Invoice>) =>
    resolveAdjustments(invoice(lines, over)).problems.map(({ path, code, severity }) => ({ path, code, severity }));

  it('takes a percentage off every VAT group and a charge in its own, and adds up to BT-106 to BT-109', () => {
    const t = calculate(invoice(mixed, { discounts: [{ percent: 10 }], charges: [freight({ vatRate: 19 })] }));
    expect(t).toMatchObject({ lineTotal: 200, allowances: 20, charges: 5, net: 185, vat: 24.35, gross: 209.35 });
    expect(t.vatBreakdown).toEqual([
      { category: 'S', rate: 7, taxable: 90, tax: 6.3 },
      { category: 'S', rate: 19, taxable: 95, tax: 18.05 },
    ]);
    expect(t.adjustments).toEqual([
      { list: 'discounts', index: 0, category: 'S', rate: 7, amount: 10, base: 100, percent: 10 },
      { list: 'discounts', index: 0, category: 'S', rate: 19, amount: 10, base: 100, percent: 10 },
      { list: 'charges', index: 0, category: 'S', rate: 19, amount: 5, reason: 'Fracht' },
    ]);
  });

  it('puts an amount on the one VAT group the lines have', () => {
    const t = calculate(invoice([line()], { discounts: [{ amount: 15, reason: 'Treuerabatt' }] }));
    expect(t).toMatchObject({ lineTotal: 100, allowances: 15, charges: 0, net: 85, vat: 16.15 });
    expect(t.adjustments).toEqual([
      { list: 'discounts', index: 0, category: 'S', rate: 19, amount: 15, reason: 'Treuerabatt' },
    ]);
  });

  it('gives a charge at a rate no line has a VAT group of its own (BR-S-08)', () => {
    const t = calculate(invoice([at(7)], { charges: [freight({ amount: 10, vatRate: 19 })] }));
    expect(t).toMatchObject({ net: 110, vat: 8.9, gross: 118.9 });
    expect(t.vatBreakdown).toEqual([
      { category: 'S', rate: 7, taxable: 100, tax: 7 },
      { category: 'S', rate: 19, taxable: 10, tax: 1.9 },
    ]);
  });

  it('gives a charge in another category its own group at 0 %', () => {
    const t = calculate(invoice([line()], { charges: [freight({ amount: 3, reason: 'Porto', vatCategory: 'E' })] }));
    expect(t.vatBreakdown).toEqual([
      { category: 'S', rate: 19, taxable: 100, tax: 19 },
      { category: 'E', rate: 0, taxable: 3, tax: 0 },
    ]);
  });

  it('applies a percentage only to the VAT groups its category or rate names', () => {
    const lines = [at(7), at(19), line({ vatCategory: 'Z', vatRate: 0 })];
    const of = (entry: DocumentAllowance) =>
      calculate(invoice(lines, { discounts: [entry] })).adjustments.map((a) => `${a.category}${a.rate}:${a.amount}`);
    expect(of({ percent: 10, vatRate: 19 })).toEqual(['S19:10']);
    expect(of({ percent: 10, vatCategory: 'S' })).toEqual(['S7:10', 'S19:10']);
    expect(of({ percent: 10, vatRate: 0 })).toEqual(['Z0:10']);
    expect(of({ percent: 10 })).toEqual(['S7:10', 'S19:10', 'Z0:10']);
  });

  it('tells two categories at 0 % apart by the category', () => {
    const lines = [line({ vatCategory: 'Z', vatRate: 0 }), line({ vatCategory: 'E', vatRate: 0 })];
    expect(calculate(invoice(lines, { discounts: [{ amount: 10, vatCategory: 'E' }] })).adjustments).toMatchObject([
      { category: 'E', rate: 0, amount: 10 },
    ]);
    expect(problems(lines, { discounts: [{ amount: 10, vatRate: 0 }] })).toEqual([
      { path: 'discounts.0.vatCategory', code: 'adjustment-group', severity: 'error' },
    ]);
  });

  it('keeps the signs of a credit note: a percentage of negative lines is negative, and so is a charge on them', () => {
    const t = calculate(
      invoice([line({ quantity: -2, unitPrice: 50 })], {
        discounts: [{ percent: 10 }],
        charges: [freight({ amount: -5 })],
      }),
    );
    expect(t).toMatchObject({ lineTotal: -100, allowances: -10, charges: -5, net: -95, vat: -18.05 });
    expect(
      resolveAdjustments(invoice([line({ quantity: -2, unitPrice: 50 })], { charges: [freight({ amount: -5 })] }))
        .problems,
    ).toEqual([]);
  });

  it('rounds each group amount half away from zero, down to 0.00', () => {
    expect(calculate(invoice([line({ unitPrice: 0.05 })], { discounts: [{ percent: 10 }] })).allowances).toBe(0.01);
    expect(
      calculate(invoice([line({ quantity: -1, unitPrice: 0.05 })], { discounts: [{ percent: 10 }] })).allowances,
    ).toBe(-0.01);
    const t = calculate(invoice([line({ unitPrice: 0.04 })], { discounts: [{ percent: 10 }] }));
    expect(t).toMatchObject({ allowances: 0, net: 0.04 });
    expect(t.adjustments).toHaveLength(1);
  });

  it('takes every percentage of the lines alone, so the order of the entries does not matter', () => {
    const first = calculate(invoice([line()], { discounts: [{ percent: 10 }, { amount: 5 }] }));
    const second = calculate(invoice([line()], { discounts: [{ amount: 5 }, { percent: 10 }] }));
    expect(first.net).toBe(85);
    expect(second.net).toBe(85);
  });

  it('takes the stated amount beside a percentage on one group if it is within R040, measured before rounding', () => {
    expect(
      calculate(invoice([line({ unitPrice: 0.15 })], { discounts: [{ percent: 10, amount: 0.03 }] })).allowances,
    ).toBe(0.03);
    expect(problems([line({ unitPrice: 0.15 })], { discounts: [{ percent: 10, amount: 0.03 }] })).toEqual([]);
    expect(problems([line({ unitPrice: 0.15 })], { discounts: [{ percent: 10, amount: 0.04 }] })).toEqual([
      { path: 'discounts.0.amount', code: 'adjustment-mismatch', severity: 'error' },
    ]);
    expect(
      problems([line({ unitPrice: 0.15 })], { currency: 'HUF', discounts: [{ percent: 10, amount: 0.5 }] }),
    ).toEqual([]);
  });

  it('wants the amount beside a percentage on several groups to be their rounded sum, to the cent', () => {
    expect(
      calculate(invoice(mixed, { discounts: [{ percent: 10, amount: 20 }] })).adjustments.map((a) => a.amount),
    ).toEqual([10, 10]);
    expect(problems(mixed, { discounts: [{ percent: 10, amount: 20 }] })).toEqual([]);
    expect(problems(mixed, { discounts: [{ percent: 10, amount: 20.01 }] })).toEqual([
      { path: 'discounts.0.amount', code: 'adjustment-mismatch', severity: 'error' },
    ]);
    expect(problems(mixed, { discounts: [{ percent: 10, amount: 25 }] })).toEqual([
      { path: 'discounts.0.amount', code: 'adjustment-mismatch', severity: 'error' },
    ]);
  });

  it('does not split an amount between VAT groups, and does not guess a group', () => {
    const error = (path: string) => [{ path, code: 'adjustment-group', severity: 'error' }];
    expect(problems(mixed, { discounts: [{ amount: 10 }] })).toEqual(error('discounts.0.vatRate'));
    expect(problems(mixed, { discounts: [{ amount: 10, vatCategory: 'S' }] })).toEqual(error('discounts.0.vatRate'));
    expect(problems([line({ vatCategory: 'Z', vatRate: 0 })], { charges: [freight({ vatCategory: 'S' })] })).toEqual(
      error('charges.0.vatRate'),
    );
    expect(problems([line()], { charges: [freight({ vatRate: 0 })] })).toEqual(error('charges.0.vatCategory'));
    expect(problems([at(19)], { discounts: [{ percent: 10, vatRate: 7 }] })).toEqual(error('discounts.0.vatRate'));
    expect(() => calculate(invoice(mixed, { discounts: [{ amount: 10 }] }))).toThrow(/several VAT/);
  });

  it('refuses a negative VAT rate, and reports every fault of an entry in the order of its fields', () => {
    expect(problems([line()], { discounts: [{ amount: 5, vatRate: -19 }] })).toEqual([
      { path: 'discounts.0.vatRate', code: 'vat-rate', severity: 'error' },
    ]);
    expect(problems([line()], { charges: [{ percent: -5, vatRate: 'x' as unknown as number }] })).toEqual([
      { path: 'charges.0.vatRate', code: 'format', severity: 'error' },
      { path: 'charges.0.percent', code: 'adjustment', severity: 'error' },
      { path: 'charges.0.reason', code: 'charge-reason', severity: 'error' },
    ]);
  });

  it('without the lines checks each entry by itself and places none', () => {
    const t = resolveAdjustments(invoice(mixed, { discounts: [{ amount: 10 }, { percent: -1 }] }), false);
    expect(t).toMatchObject({ adjustments: [], resolved: false });
    expect(t.problems.map(({ path, code }) => `${path} ${code}`)).toEqual(['discounts.1.percent adjustment']);
    expect(resolveAdjustments(invoice(mixed), false)).toEqual({ adjustments: [], problems: [], resolved: false });
  });

  it('gives the totals with the problems of the entries, and none while one cannot be placed, without throwing', () => {
    const placed = tryCalculate(invoice([line()], { discounts: [{ amount: -10 }] }));
    expect(placed.totals?.net).toBe(110);
    expect(placed.problems).toMatchObject([{ path: 'discounts.0.amount', code: 'adjustment-sign' }]);
    const stuck = tryCalculate(invoice(mixed, { discounts: [{ amount: 10 }] }));
    expect(stuck.totals).toBeUndefined();
    expect(stuck.problems).toMatchObject([{ path: 'discounts.0.vatRate', severity: 'error' }]);
    expect(tryCalculate(invoice(mixed), false)).toEqual({ problems: [] });
  });

  it('warns about an amount against the sign of its lines, but not in a group of its own', () => {
    const t = resolveAdjustments(invoice([line()], { discounts: [{ amount: -10 }] }));
    expect(t.problems).toMatchObject([{ path: 'discounts.0.amount', code: 'adjustment-sign', severity: 'warning' }]);
    expect(calculate(invoice([line()], { discounts: [{ amount: -10 }] })).net).toBe(110);
    expect(problems([line()], { charges: [freight({ amount: -3, vatCategory: 'E' })] })).toEqual([]);
  });
});
