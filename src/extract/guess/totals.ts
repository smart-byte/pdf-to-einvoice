import type { PrintedTotals } from '../../domain/model.js';
import { cents, fromCents } from '../../domain/money.js';
import { toNumber } from '../../domain/spellings.js';
import { after, AMOUNT, anyOf, MONEY, SEPARATOR } from './values.js';

// Totals: three printed amounts with net + VAT = gross, picked by their labels where several fit.

/** The totals a page prints, as far as the reader found them. */
export type ReadTotals = Pick<PrintedTotals, 'net' | 'vat' | 'gross'>;

/**
 * The totals: three printed amounts with net + VAT = gross. Labels say which three when several fit, and nothing
 * else: an amount after a label is not believed against the sum. One or two labelled amounts are kept when no
 * three amounts fit, as on an invoice without VAT.
 */
export function readTotals(searched: string, text: string): ReadTotals {
  const labelled = labelledIn(searched);
  return labelledSum(labelled) ?? sumOnPage(text, labelled) ?? labelledAlone(labelled);
}

/** The amounts after each label, in cents, in the order they stand. */
type Labelled = Record<'net' | 'vat' | 'gross', number[]>;

function labelledIn(searched: string): Labelled {
  const labelled = (label: RegExp) => centsOf(after(searched, label, AMOUNT).map(({ hit }) => hit[1]!));
  return { net: labelled(NET_LABEL), vat: labelled(VAT_LABEL), gross: labelled(GROSS_LABEL) };
}

/** The first amount after each label, where they add up: net + VAT = gross, or net = gross and no VAT. */
function labelledSum({ net: [net], vat: [vat], gross: [gross] }: Labelled): ReadTotals | undefined {
  if (net === undefined) return undefined;
  if (vat === undefined) {
    // The same amount as net and as gross, and no VAT: an invoice without VAT, whatever else adds up on the page.
    return net === gross ? { net: euros(net), gross: euros(gross) } : undefined;
  }
  return net + vat === gross ? { net: euros(net), vat: euros(vat), gross: euros(gross) } : undefined;
}

/**
 * Three amounts printed anywhere on the page that add up, scored by how many of them stand after their label. The
 * best is believed when no other scores as high; where the page labels no amount at all, when it is the only one
 * that charges VAT.
 */
function sumOnPage(text: string, labelled: Labelled): ReadTotals | undefined {
  const printed = new Set(centsOf([...text.matchAll(PRINTED_AMOUNT)].map((match) => match[1]!)));
  const amounts = [...printed];
  const sums = amounts
    .flatMap((net) =>
      amounts.filter((vat) => fits(net, vat, printed, labelled)).map((vat) => scored(net, vat, labelled)),
    )
    .sort((a, b) => b.score - a.score);
  const unlabelled = Object.values(labelled).every((found) => found.length === 0);
  const [best, second] = sums[0]?.score ? sums : sums.filter((sum) => unlabelled && sum.vat !== 0);
  return best && best.score > (second?.score ?? -1) ? { net: best.net, vat: best.vat, gross: best.gross } : undefined;
}

/**
 * Whether net and VAT, in cents, add up to a printed gross at a share there is. VAT of nothing is believed when a label
 * says so; "0,00" alone may be anything.
 */
function fits(net: number, vat: number, printed: Set<number>, labelled: Labelled): boolean {
  if (net === 0 || !printed.has(net + vat)) return false;
  return share(vat, net) && (vat !== 0 || labelled.vat.includes(0));
}

/** Net, VAT and gross in euros, and how many of the three stand after their label. */
function scored(net: number, vat: number, labelled: Labelled) {
  const score = +labelled.net.includes(net) + +labelled.vat.includes(vat) + +labelled.gross.includes(net + vat);
  return { net: fromCents(net), vat: fromCents(vat), gross: fromCents(net + vat), score };
}

/**
 * One or two labelled amounts, where no three add up, as on an invoice without VAT. Amounts that cannot belong
 * together are not believed either. Net and gross may: the VAT between them is printed in parts where an invoice has
 * several rates.
 */
function labelledAlone({ net: [net], vat: [vat], gross: [gross] }: Labelled): ReadTotals {
  if (net !== undefined && gross !== undefined) {
    return share(gross - net, net) ? { net: euros(net), gross: euros(gross) } : {};
  }
  const whole = net ?? gross;
  return vat === undefined || whole === undefined || share(vat, whole)
    ? { net: euros(net), vat: euros(vat), gross: euros(gross) }
    : {};
}

/** Whether `part` can be the VAT on `whole`: not negative, and no more than the highest rate. */
function share(part: number, whole: number): boolean {
  return part / whole >= 0 && part / whole <= MAX_VAT_SHARE;
}

/** Printed amounts in cents. An amount too large to calculate with is none. */
function centsOf(printed: string[]): number[] {
  return printed.map((amount) => cents(toNumber(amount))).filter((inCents) => !Number.isNaN(inCents));
}

function euros(inCents: number | undefined): number | undefined {
  return inCents === undefined ? undefined : fromCents(inCents);
}

/**
 * The currency after its label, or the one currency the page shows. A page with two, such as one that also gives the
 * VAT in euros, is in the one currency of its totals; where they do not tell either, it stays unread.
 */
export function findCurrency(text: string): string | undefined {
  const shown = (part: string) => CURRENCY_SIGNS.filter(([pattern]) => pattern.test(part)).map(([, code]) => code);
  const totalsRows = text
    .split('\n')
    .filter((row) => TOTALS_ROW.test(row))
    .join('\n');
  const one = [shown(text), shown(totalsRows)].find((codes) => codes.length === 1) ?? [];
  return after(text, CURRENCY_LABEL, CURRENCY_CODE)[0]?.hit[1] ?? one[0];
}

/** The VAT rate at which `vat` is the tax on `net`, give or take a cent of rounding. */
export function rateOf(net: number, vat: number): number | undefined {
  const off = (rate: number) => Math.abs((cents(net) * rate) / 100 - cents(vat));
  const rate = RATES.reduce((best, candidate) => (off(candidate) < off(best) ? candidate : best));
  return net !== 0 && off(rate) <= (rate === 0 ? 0 : 1) ? rate : undefined;
}

// What the page is searched for. The functions above use these only when a page is read, so they may stand below
// them; `TOTALS_ROW` and `TOTALS_CELL` are used by the items as well.

const VAT_WORD = '(?:ust|mwst|umsatzsteuer|mehrwertsteuer|vat|tax|tva|taxes)\\.?';
const NET_LABEL = new RegExp(
  [
    'nettobetrag',
    'nettosumme',
    'summe\\s+netto',
    'zwischensumme',
    'netto',
    'subtotal',
    'net\\s+(?:amount|total)',
    'total\\s+(?:net|ht)',
    'montant\\s+ht',
    // "ohne USt.", "excl. VAT", "hors taxes"
    `(?:ohne|exkl\\.?|excl(?:\\.|uding)?|hors)\\s+${VAT_WORD}`,
  ].join('|'),
);
// "ohne USt." and "inkl. MwSt." say what another amount is, not how much VAT there is.
const NOT_AFTER = '(?<!(?:ohne|inkl\\.?|incl\\.?|zzgl\\.?|exkl\\.?|excl\\.?|plus|including|excluding|hors)\\s+)';
const VAT_LABEL = new RegExp(
  `${NOT_AFTER}(?:${[
    '(?:vat|tax)\\s+total',
    'total\\s+(?:vat|tax(?:es)?|tva)',
    'montant\\s+tva',
    'steuerbetrag',
    'umsatzsteuer',
    'mehrwertsteuer',
    'mwst\\.?',
    'ust\\.?',
    '\\bvat\\b',
    'sales\\s+tax',
    '\\btva\\b',
  ].join('|')})`,
);
const GROSS_LABEL = new RegExp(
  [
    'gesamt(?:betrag|summe)?',
    'rechnungsbetrag',
    'brutto(?:betrag|summe)?',
    'endbetrag',
    'grand\\s+total',
    'amount\\s+due',
    '(?:total|montant)\\s+ttc',
    'total(?:\\s+amount)?(?:\\s+due)?',
    // "inkl. MwSt.", "including VAT"
    `(?:inkl\\.?|incl(?:\\.|uding)?)\\s+${VAT_WORD}`,
  ].join('|'),
);

/** A row that sums up: it starts with a word for a total ("Taxi" and "Nettopreis" are none), or a cell of it is one ("Positionssumme", "Zahlbetrag", "Total HT"). */
export const TOTALS_ROW = new RegExp(
  `^(?:\\d{1,2}(?:[.,]\\d+)?\\s?%\\s*)?(?:${anyOf(
    /(?:netto|brutto|gesamt)(?:betrag|summe)?|zwischensumme|summe/,
    /mwst|ust|umsatzsteuer|mehrwertsteuer/,
    /rechnungsbetrag|endbetrag|zzgl/,
    /total|subtotal|net\s+(?:amount|total)|vat|tax(?:es)?|tva|übertrag/,
  )})\\b`,
  'i',
);
export const TOTALS_CELL = /(?:summe|betrag)(?![\p{L}])|\btotal\b/iu;

/** An amount that stands on its own: not part of a date, a longer number or a percentage. */
const PRINTED_AMOUNT = new RegExp(`(?<![\\d.,])${MONEY}(?![.,]?\\d)(?!\\s?%)`, 'g');
/** No invoice carries more VAT than the highest rate; one with several rates carries less. */
const MAX_VAT_SHARE = 0.3;

const CURRENCY_SIGNS: [RegExp, string][] = [
  [/€|\bEUR\b/, 'EUR'],
  [/\$|\bUSD\b/, 'USD'],
  [/£|\bGBP\b/, 'GBP'],
  [/\bCHF\b/, 'CHF'],
];
const CURRENCY_LABEL = /währung|currency|devise/;
const CURRENCY_CODE = new RegExp(`${SEPARATOR}([A-Z]{3})\\b`);

// Known limit: the standard and reduced rates of the EU and Switzerland as of 2026; a rate that is not listed reads as no rate.
const RATES = [
  0, 2.1, 2.6, 3.8, 4, 4.8, 5, 5.5, 6, 7, 8, 8.1, 9, 9.5, 10, 12, 13, 13.5, 14, 15, 17, 18, 19, 20, 21, 22, 23, 24, 25,
  25.5, 27,
];
