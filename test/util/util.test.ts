import { describe, expect, it } from 'vitest';
import { messageOf } from '../../src/util/errors.js';
import { isNumber } from '../../src/util/numbers.js';
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

  it('gives the text of an error, or of whatever else was thrown', () => {
    expect(messageOf(new Error('broken'))).toBe('broken');
    expect(messageOf('plain text')).toBe('plain text');
    expect(messageOf(42)).toBe('42');
  });
});
