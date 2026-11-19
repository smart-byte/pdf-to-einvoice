/** Whether a value is a number that can be calculated with: not NaN, not infinite, and not a string of digits. */
export const isNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
