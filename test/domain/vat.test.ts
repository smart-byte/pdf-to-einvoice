import { describe, expect, it } from 'vitest';
import { categoryOf } from '../../src/domain/vat.js';

describe('the VAT category', () => {
  it('is the one given, or S for a rate above 0 alone', () => {
    expect(categoryOf('AE', 19)).toBe('AE');
    expect(categoryOf(undefined, 19)).toBe('S');
    expect(categoryOf(undefined, 0)).toBeUndefined();
    expect(categoryOf(undefined, '19')).toBeUndefined();
    expect(categoryOf(undefined, undefined)).toBeUndefined();
  });
});
