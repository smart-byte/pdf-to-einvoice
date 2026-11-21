import { describe, expect, it } from 'vitest';
import { amountSpellings, COUNTRY_NAMES, toNumber } from '../../src/domain/spellings.js';

describe('how a value is printed', () => {
  it.each([
    ['1.499,00', 1499],
    ['1,499.00', 1499],
    ['1.000', 1000],
    ['0.025', 0.025],
    ['-3,50 €', -3.5],
    ['42', 42],
  ])('reads %s as %d', (printed, number) => {
    expect(toNumber(printed)).toBe(number);
  });

  it('reads an amount back from each way it is spelt', () => {
    for (const spelling of amountSpellings(1783.81)) expect(toNumber(spelling)).toBe(1783.81);
  });

  it('knows a country by the names a page prints for it', () => {
    expect(COUNTRY_NAMES.DE).toContain('deutschland');
    expect(COUNTRY_NAMES.AT).toContain('austria');
  });
});
