// How a value is printed on a page: the spellings of a date, an amount and a percentage, to look for in the text of a
// PDF, and the names of the months.

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
export function amountSpellings(n: number): string[] {
  // A price may be finer than a cent ("0,4995 €"): it keeps its decimals, two at least.
  const decimals = Math.min(Math.max(2, String(n).split('.')[1]?.length ?? 0), 6);
  const [int, frac] = Math.abs(n).toFixed(decimals).split('.') as [string, string];
  const grouped = (sep: string) => int.replace(/\B(?=(\d{3})+(?!\d))/g, sep);
  const spellings = [
    `${int},${frac}`,
    `${int}.${frac}`,
    `${grouped('.')},${frac}`,
    `${grouped(',')}.${frac}`,
    `${grouped("'")}.${frac}`,
  ];
  // Known limit: a whole number matches any occurrence of its digits ("100" in "1000"); tighten with word boundaries if that hides real mismatches.
  return frac === '00' ? [...spellings, int, grouped('.'), grouped(',')] : spellings;
}

/** The ways a percentage is commonly printed, without whitespace: "10%", "10,0%", "10.00%", "12,345%". */
export function percentSpellings(p: number): string[] {
  const own = String(p).split('.')[1]?.length ?? 0;
  const forms = [own, 1, 2].filter((decimals) => decimals >= own).map((decimals) => p.toFixed(decimals));
  return [...new Set(forms.flatMap((form) => [`${form}%`, `${form.replace('.', ',')}%`]))];
}
