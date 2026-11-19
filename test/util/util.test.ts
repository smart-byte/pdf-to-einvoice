import { describe, expect, it } from 'vitest';
import { messageOf } from '../../src/util/errors.js';
import { isNumber } from '../../src/util/numbers.js';
import { valueAt } from '../../src/util/objects.js';
import { escapeRegExp } from '../../src/util/regexp.js';

describe('the helpers every layer may use', () => {
  it('escapes what a regular expression would read as syntax', () => {
    expect(escapeRegExp('1.234,56 (EUR) [x]*+?^$|\\')).toBe('1\\.234,56 \\(EUR\\) \\[x\\]\\*\\+\\?\\^\\$\\|\\\\');
    expect(new RegExp(escapeRegExp('RE-2026/1.0')).test('Nr. RE-2026/1.0')).toBe(true);
  });

  it('tells a finite number from everything else', () => {
    expect([1, 0, -2.5].every(isNumber)).toBe(true);
    expect([Number.NaN, Infinity, '1', null, undefined].some(isNumber)).toBe(false);
  });

  it('reads a value at a path of keys and indices, and nothing where the path leads nowhere', () => {
    const data = { seller: { name: 'S' }, lines: [{ unitPrice: 0 }, null] };
    expect(valueAt(data, 'seller.name')).toBe('S');
    expect(valueAt(data, 'lines.0.unitPrice')).toBe(0);
    expect(valueAt(data, 'lines.1.name')).toBeUndefined();
    expect(valueAt(data, 'buyer.name')).toBeUndefined();
    expect(valueAt('text', 'length.x')).toBeUndefined();
    expect(valueAt(undefined, 'seller')).toBeUndefined();
  });

  it('gives the text of an error, or of whatever else was thrown', () => {
    expect(messageOf(new Error('broken'))).toBe('broken');
    expect(messageOf('plain text')).toBe('plain text');
    expect(messageOf(42)).toBe('42');
  });
});
