import { describe, expect, it } from 'vitest';
import {
  BIC,
  compactCode,
  isBic,
  isCountryCode,
  isCurrencyCode,
  isDate,
  isEmail,
  isIban,
  isTaxNumber,
  isVatId,
} from '../../src/domain/formats.js';

describe('formats', () => {
  it('takes a date only if the calendar has it', () => {
    expect(isDate('2026-02-28')).toBe(true);
    expect(isDate('2026-02-31')).toBe(false);
    expect(isDate('28.02.2026')).toBe(false);
    expect(isDate(20260228)).toBe(false);
  });

  it('checks the IBAN checksum', () => {
    expect(isIban('DE02120300000000202051')).toBe(true);
    expect(isIban('DE03120300000000202051')).toBe(false);
    expect(isIban('DE02 1203 0000 0000 2020 51')).toBe(false);
  });

  it('knows the shape of a VAT ID, a tax number and a BIC', () => {
    expect(isVatId('DE123456789')).toBe(true);
    expect(isVatId('123456789')).toBe(false);
    expect(isTaxNumber('12/345/67890')).toBe(true);
    expect(isTaxNumber('Musterstadt')).toBe(false);
    expect(isBic('BYLADEM1001')).toBe(true);
    expect(isBic('BYLADEM1')).toBe(true);
    expect(isBic('BYLADEM10')).toBe(false);
    expect('BIC: BYLADEM1001 '.match(BIC)?.[0]).toBe('BYLADEM1001');
  });

  it('takes an e-mail address with a domain of whole labels', () => {
    expect(isEmail('rechnung@muster-software.example')).toBe(true);
    expect(isEmail('rechnung@muster-software.example.')).toBe(false);
    expect(isEmail('rechnung@example')).toBe(false);
    expect(isEmail('rechnung@@example.org')).toBe(false);
  });

  it('takes country and currency codes in capitals', () => {
    expect(isCountryCode('DE')).toBe(true);
    expect(isCountryCode('de')).toBe(false);
    expect(isCurrencyCode('EUR')).toBe(true);
    expect(isCurrencyCode('€')).toBe(false);
    expect(isCurrencyCode(undefined)).toBe(false);
  });

  it('writes an IBAN, a BIC or a VAT ID as it is compared: without whitespace, in capitals', () => {
    expect(compactCode(' de02 1203 0000\t0000 2020 51 ')).toBe('DE02120300000000202051');
    expect(compactCode('atu12345678')).toBe('ATU12345678');
  });
});
