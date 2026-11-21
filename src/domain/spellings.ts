// How a value is printed on a page: the spellings of a date and of an amount, to look for in the text of a PDF, the
// number a printed amount stands for, and the names of the months and of the countries.

/** The names of the months, as German and English invoices print them, in lower case. */
export const MONTHS = [
  ['januar', 'january', 'jan'],
  ['februar', 'february', 'feb'],
  ['märz', 'march', 'mar', 'mär'],
  ['april', 'apr'],
  ['mai', 'may'],
  ['juni', 'june', 'jun'],
  ['juli', 'july', 'jul'],
  ['august', 'aug'],
  ['september', 'sep'],
  ['oktober', 'october', 'oct', 'okt'],
  ['november', 'nov'],
  ['dezember', 'december', 'dec', 'dez'],
];

/** The ways a date is commonly printed, without whitespace, lower case. */
export function dateSpellings(iso: string): string[] {
  const [y, m, d] = iso.split('-') as [string, string, string];
  const day = String(Number(d));
  const month = String(Number(m));
  const yy = y.slice(2);
  const numeric = [
    iso,
    `${d}.${m}.${y}`,
    `${day}.${month}.${y}`,
    `${d}.${m}.${yy}`,
    `${day}.${month}.${yy}`,
    `${d}/${m}/${y}`,
    `${m}/${d}/${y}`,
    `${d}/${m}/${yy}`,
    `${m}/${d}/${yy}`,
    `${d}-${m}-${y}`,
  ];
  // A month that does not exist has no name: such a date is only looked for in digits.
  const named = (MONTHS[Number(m) - 1] ?? []).flatMap((name) => [
    `${day}.${name}${y}`,
    `${d}.${name}${y}`,
    `${day}${name}${y}`,
    `${name}${day},${y}`,
    `${name}${day}${y}`,
  ]);
  return [...numeric, ...named];
}

/** The ways an amount is commonly printed, without whitespace. */
export function amountSpellings(amount: number): string[] {
  // A price may be finer than a cent ("0,4995 €"): it keeps its decimals, two at least.
  const decimals = Math.min(Math.max(2, String(amount).split('.')[1]?.length ?? 0), 6);
  const [int, frac] = Math.abs(amount).toFixed(decimals).split('.') as [string, string];
  const grouped = (sep: string) => int.replace(/\B(?=(\d{3})+(?!\d))/g, sep);
  const spellings = [
    `${int},${frac}`,
    `${int}.${frac}`,
    `${grouped('.')},${frac}`,
    `${grouped(',')}.${frac}`,
    `${grouped("'")}.${frac}`,
  ];
  // A whole amount is also printed without its decimals; shown.ts and the web app's locate.ts take it only where it stands on its own.
  return frac === '00' ? [...spellings, int, grouped('.'), grouped(',')] : spellings;
}

/**
 * "1.499,00" and "1,499.00" both mean 1499: the last separator is the decimal one. Three digits behind the only
 * separator are thousands ("1.000 Stk"), unless a zero stands in front ("0.025").
 */
export function toNumber(printed: string): number {
  const digits = printed.replace(/[^\d.,-]/g, '');
  const last = Math.max(digits.lastIndexOf(','), digits.lastIndexOf('.'));
  if (last < 0) return Number(digits);
  const [whole, fraction] = [digits.slice(0, last).replace(/[.,]/g, ''), digits.slice(last + 1)];
  return Number(fraction.length === 3 && Number(whole) !== 0 ? whole + fraction : `${whole}.${fraction}`);
}

/** How a country is written on a page, in lower case. */
export const COUNTRY_NAMES: Record<string, string[]> = {
  DE: ['deutschland', 'germany'],
  AT: ['österreich', 'austria'],
  CH: ['schweiz', 'switzerland', 'suisse'],
  FR: ['frankreich', 'france'],
  IT: ['italien', 'italy', 'italia'],
  NL: ['niederlande', 'netherlands', 'nederland'],
  BE: ['belgien', 'belgium', 'belgique'],
  LU: ['luxemburg', 'luxembourg'],
  PL: ['polen', 'poland', 'polska'],
  ES: ['spanien', 'spain', 'españa'],
  IE: ['irland', 'ireland'],
  GB: ['großbritannien', 'vereinigtes königreich', 'united kingdom', 'great britain'],
  US: ['usa', 'united states', 'vereinigte staaten'],
};
