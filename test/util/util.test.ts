import { describe, expect, it } from 'vitest';
import { messageOf } from '../../src/util/errors.js';
import { isMalformedNumber, isNegative, isNumber, twoDigits } from '../../src/util/numbers.js';
import { valueAt } from '../../src/util/objects.js';
import { escapeRegExp } from '../../src/util/regexp.js';
import { cells, COLUMN_GAP, rowOf } from '../../src/util/rows.js';

describe('the helpers every layer may use', () => {
  it('escapes what a regular expression would read as syntax', () => {
    expect(escapeRegExp('1.234,56 (EUR) [x]*+?^$|\\')).toBe('1\\.234,56 \\(EUR\\) \\[x\\]\\*\\+\\?\\^\\$\\|\\\\');
    expect(new RegExp(escapeRegExp('RE-2026/1.0')).test('Nr. RE-2026/1.0')).toBe(true);
  });

  it('tells a finite number from everything else', () => {
    expect([1, 0, -2.5].every(isNumber)).toBe(true);
    expect([Number.NaN, Infinity, '1', null, undefined].some(isNumber)).toBe(false);
  });

  it('tells a value that is given but no number, and a negative number', () => {
    expect([Number.NaN, '1', null, Infinity].every(isMalformedNumber)).toBe(true);
    expect([undefined, 0, -2.5].some(isMalformedNumber)).toBe(false);
    expect([-1, -0.01].every(isNegative)).toBe(true);
    expect([0, 1, '-1', Number.NaN, -Infinity, undefined].some(isNegative)).toBe(false);
  });

  it('writes a month or a day with two digits', () => {
    expect([twoDigits(3), twoDigits('3'), twoDigits(10), twoDigits('31')]).toEqual(['03', '03', '10', '31']);
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

  it('writes a row from its cells and takes it apart again', () => {
    // What pdf/text.ts writes, the reader in extract/guess/ reads: both go through here.
    const row = rowOf(['1', 'Beratung E-Rechnung', '10 Std.', '100,00 €']);
    expect(row).toBe(`1${COLUMN_GAP}Beratung E-Rechnung${COLUMN_GAP}10 Std.${COLUMN_GAP}100,00 €`);
    expect(cells(row)).toEqual(['1', 'Beratung E-Rechnung', '10 Std.', '100,00 €']);
  });

  it('takes a wider gap for one gap, and keeps a value behind its colon with its label', () => {
    expect(cells('Menge      Preis')).toEqual(['Menge', 'Preis']);
    expect(cells('Nummer   : 77   Datum: 03.11.2026')).toEqual(['Nummer   : 77', 'Datum: 03.11.2026']);
  });

  it('gives the text of an error, or of whatever else was thrown', () => {
    expect(messageOf(new Error('broken'))).toBe('broken');
    expect(messageOf('plain text')).toBe('plain text');
    expect(messageOf(42)).toBe('42');
  });
});
