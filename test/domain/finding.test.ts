import { describe, expect, it } from 'vitest';
import { error, warning } from '../../src/domain/finding.js';

describe('a finding', () => {
  it('carries the values its text was filled with, so that another language can word them', () => {
    const params = { discounted: true, expected: '0.99', stated: '0.50' };
    expect(error('lines.0.netAmount', 'line-net', params)).toEqual({
      path: 'lines.0.netAmount',
      severity: 'error',
      code: 'line-net',
      message:
        'Quantity times unit price less the discount is 0.99, but the line states 0.50. Correct the quantity, the price or the discount.',
      params,
    });
  });

  it('carries no values where its text has none', () => {
    expect(warning('number', 'format.number')).toEqual({
      path: 'number',
      severity: 'warning',
      code: 'format',
      message: 'Not a number.',
    });
  });
});
