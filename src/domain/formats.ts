// The shapes a value of the invoice data has to have, in one place for the checks, the reader and the comparison with
// the page. A pattern without anchors is for finding the value in a text; the function beside it takes a whole value.

/** A pattern that takes a whole value: `pattern` from its first to its last character. */
function whole(pattern: RegExp): (v: unknown) => v is string {
  const anchored = new RegExp(`^(?:${pattern.source})$`, pattern.flags);
  return (v: unknown): v is string => typeof v === 'string' && anchored.test(v);
}

/** Whether a value is a day of the calendar written as `YYYY-MM-DD`; `2026-02-31` is not. */
export function isDate(v: unknown): v is string {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const parsed = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().startsWith(v);
}

/** An IBAN without spaces, in capitals, whose ISO 13616 mod-97 checksum holds. */
export function isIban(v: string): boolean {
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(v)) return false;
  const digits = (v.slice(4) + v.slice(0, 4)).replace(/[A-Z]/g, (c) => String(c.charCodeAt(0) - 55));
  return BigInt(digits) % 97n === 1n;
}

/** A BIC: bank, country and place, and optionally the branch. */
export const BIC = /[A-Z]{6}[A-Z0-9]{2}(?:[A-Z0-9]{3})?/;
export const isBic = whole(BIC);

/** A VAT ID without spaces: the country prefix and up to 12 letters and digits. */
export const isVatId = whole(/[A-Z]{2}[A-Z0-9]{2,12}/);

/** A tax number without spaces: digits, perhaps parted by slashes or hyphens. */
export const isTaxNumber = whole(/\d[\d/-]{7,}/);

/** An e-mail address whose domain has at least two labels, none of them empty (BR-DE-28). */
export const isEmail = whole(/[^@\s]+@(?:[^@.\s]+\.)+[^@.\s]+/);

/** ISO 3166-1 alpha-2, as the data holds a country. */
export const isCountryCode = whole(/[A-Z]{2}/);

/** ISO 4217, as the data holds a currency. */
export const isCurrencyCode = whole(/[A-Z]{3}/);
