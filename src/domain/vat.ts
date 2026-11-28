import { isNumber } from '../util/numbers.js';
import type { Finding } from './finding.js';
import { error } from './messages.js';
import type { VatCategory } from './model.js';

/** The VAT category given, or S for a rate above 0 without one: a rate alone is the standard one. */
export function categoryOf<C>(stated: C | undefined, rate: unknown): C | 'S' | undefined {
  return stated ?? (isNumber(rate) && rate > 0 ? 'S' : undefined);
}

/**
 * What is wrong with a VAT rate for its category, at `path`: a rate is never negative, the standard category S
 * charges one above 0, every other category charges none. Without a category, only the sign is checked.
 */
export function vatRateError(path: string, category: VatCategory | undefined, rate: number): Finding | undefined {
  if (rate < 0) return error(path, 'vat-rate.negative');
  if (category === 'S' && rate === 0) return error(path, 'vat-rate.standard');
  if (category !== undefined && category !== 'S' && rate !== 0) return error(path, 'vat-rate.zero', { category });
  return undefined;
}
