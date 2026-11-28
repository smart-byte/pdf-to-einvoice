/** Whether a value is a number that can be calculated with: not NaN, not infinite, and not a string of digits. */
export const isNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

/** A value that is given and is not a number. */
export function isMalformedNumber(value: unknown): boolean {
  return value !== undefined && !isNumber(value);
}

export function isNegative(value: unknown): boolean {
  return isNumber(value) && value < 0;
}

/** Whether one amount is below 0 and the other above it; 0 has no sign. As numbers or as BigInt. */
export function signsDiffer(a: number | bigint, b: number | bigint): boolean {
  return Math.sign(Number(a)) * Math.sign(Number(b)) < 0;
}

/** A month or a day with two digits, as a date writes it: 3 is "03". */
export function twoDigits(value: string | number): string {
  return String(value).padStart(2, '0');
}
