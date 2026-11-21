import { describe, expect, it } from 'vitest';
import {
  pageTextOf,
  showsAmount,
  showsCount,
  showsPercent,
  showsSpelling,
  showsWords,
} from '../../src/domain/shown.js';

const page = pageTextOf(
  [
    'Muster Software GmbH · Beispielweg 1 · 12345 Musterstadt',
    'Rechnung Nr. RE-2026-0042   Rechnungsdatum 03.11.2026',
    '2  Softwarelizenz (Jahr)   24.000 Stk.   249,50 €   499,00 €',
    'Rabatt 110 %   USt 19,00 %   Skonto 7,50 %',
    'IBAN DE02 1203 0000 0000 2020 51   Fragen an info@shop.example',
  ].join('\n'),
);

describe('what the text of a page shows', () => {
  it('finds an identifier printed in groups, whatever its case', () => {
    expect(showsSpelling(page, ['de02120300000000202051'])).toBe(true);
    expect(showsSpelling(page, ['DE02120300000000202052'])).toBe(false);
  });

  it('finds a text by its whole words, in any order', () => {
    expect(showsWords(page, 'Software Muster')).toBe(true);
    expect(showsWords(page, 'Softwarelizenz (Jahr)')).toBe(true);
    expect(showsWords(page, 'Stadt')).toBe(false);
    expect(showsWords(page, 'Example')).toBe(false);
  });

  it('finds an amount only where it stands on its own', () => {
    expect(showsAmount(page, 249.5)).toBe(true);
    expect(showsAmount(page, 499)).toBe(true);
    expect(showsAmount(page, 49)).toBe(false);
    expect(showsAmount(page, 3.11)).toBe(false);
  });

  it.each([' ', ' ', ' '])('finds an amount whose thousands are grouped by the space "%s"', (space) => {
    expect(showsAmount(pageTextOf(`Gesamtbetrag 1${space}783,81 €`), 1783.81)).toBe(true);
  });

  it('finds a bare number, grouped or not', () => {
    expect(showsCount(page, 24000)).toBe(true);
    expect(showsCount(page, 2)).toBe(true);
    expect(showsCount(page, 4)).toBe(false);
  });

  it('finds a percentage before its sign, with or without decimals', () => {
    expect(showsPercent(page, 19)).toBe(true);
    expect(showsPercent(page, 7.5)).toBe(true);
    expect(showsPercent(page, 10)).toBe(false);
  });
});
