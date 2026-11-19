import { after, AMOUNT, cents, MONEY, SEPARATOR, toNumber } from './values.js';

// Totals: three printed amounts with net + VAT = gross, picked by their labels where several fit.

const VAT_WORD = '(?:ust|mwst|umsatzsteuer|mehrwertsteuer|vat|tax|tva|taxes)\\.?';
const NET_LABEL = new RegExp(
  `nettobetrag|nettosumme|summe\\s+netto|zwischensumme|netto|subtotal|net\\s+(?:amount|total)|total\\s+(?:net|ht)|montant\\s+ht|(?:ohne|exkl\\.?|excl(?:\\.|uding)?|hors)\\s+${VAT_WORD}`,
);
// "ohne USt." and "inkl. MwSt." say what another amount is, not how much VAT there is.
const VAT_LABEL = new RegExp(
  `(?<!(?:ohne|inkl\\.?|incl\\.?|zzgl\\.?|exkl\\.?|excl\\.?|plus|including|excluding|hors)\\s+)(?:(?:vat|tax)\\s+total|total\\s+(?:vat|tax(?:es)?|tva)|montant\\s+tva|steuerbetrag|umsatzsteuer|mehrwertsteuer|mwst\\.?|ust\\.?|\\bvat\\b|sales\\s+tax|\\btva\\b)`,
);
const GROSS_LABEL = new RegExp(
  `gesamt(?:betrag|summe)?|rechnungsbetrag|brutto(?:betrag|summe)?|endbetrag|grand\\s+total|amount\\s+due|(?:total|montant)\\s+ttc|total(?:\\s+amount)?(?:\\s+due)?|(?:inkl\\.?|incl(?:\\.|uding)?)\\s+${VAT_WORD}`,
);
/** A row that sums up: it starts with a word for a total ("Taxi" and "Nettopreis" are none), or a cell of it is one ("Positionssumme", "Zahlbetrag", "Total HT"). */
export const TOTALS_ROW =
  /^(?:\d{1,2}(?:[.,]\d+)?\s?%\s*)?(?:(?:netto|brutto|gesamt)(?:betrag|summe)?|zwischensumme|summe|mwst|ust|umsatzsteuer|mehrwertsteuer|rechnungsbetrag|endbetrag|zzgl|total|subtotal|net\s+(?:amount|total)|vat|tax(?:es)?|tva|übertrag)\b/i;
export const TOTALS_CELL = /(?:summe|betrag)(?![\p{L}])|\btotal\b/iu;
/** An amount that stands on its own: not part of a date, a longer number or a percentage. */
const PRINTED_AMOUNT = new RegExp(`(?<![\\d.,])${MONEY}(?![.,]?\\d)(?!\\s?%)`, 'g');
// Known limit: the standard and reduced rates of the EU and Switzerland as of 2026; a rate that is not listed reads as no rate.
const RATES = [0, 2.1, 2.6, 3.8, 4, 4.8, 5, 5.5, 6, 7, 8, 8.1, 9, 9.5, 10, 12, 13, 13.5, 14, 15, 17, 18, 19, 20, 21, 22, 23, 24, 25, 25.5, 27];
/** No invoice carries more VAT than the highest rate; one with several rates carries less. */
const MAX_VAT_SHARE = 0.3;

/** The VAT rate at which `vat` is the tax on `net`, give or take a cent of rounding. */
export function rateOf(net: number, vat: number): number | undefined {
  const off = (rate: number) => Math.abs((cents(net) * rate) / 100 - cents(vat));
  const rate = RATES.reduce((best, candidate) => (off(candidate) < off(best) ? candidate : best));
  return net !== 0 && off(rate) <= (rate === 0 ? 0 : 1) ? rate : undefined;
}

export type Totals = { net?: number; vat?: number; gross?: number };

/**
 * The totals: three printed amounts with net + VAT = gross. Labels say which three when several fit, and nothing
 * else: an amount after a label is not believed against the sum. One or two labelled amounts are kept when no
 * three amounts fit, as on an invoice without VAT.
 */
export function readTotals(searched: string, text: string): Totals {
  const labelled = (label: RegExp) => after(searched, label, AMOUNT).map(({ hit }) => cents(toNumber(hit[1]!)));
  const hits = { net: labelled(NET_LABEL), vat: labelled(VAT_LABEL), gross: labelled(GROSS_LABEL) };
  const [net, vat, gross] = [hits.net[0], hits.vat[0], hits.gross[0]];
  const first = { net: net === undefined ? net : net / 100, vat: vat === undefined ? vat : vat / 100, gross: gross === undefined ? gross : gross / 100 };
  if (net !== undefined && vat !== undefined && net + vat === gross) return first;
  // The same amount as net and as gross, and no VAT: an invoice without VAT, whatever else adds up on the page.
  if (net !== undefined && net === gross && vat === undefined) return { net: first.net, gross: first.gross };

  const printed = new Set([...text.matchAll(PRINTED_AMOUNT)].map((match) => cents(toNumber(match[1]!))));
  const sums: { net: number; vat: number; gross: number; score: number }[] = [];
  for (const n of printed) {
    for (const v of printed) {
      // VAT of nothing is believed when a label says so; "0,00" alone may be anything.
      if (n === 0 || !printed.has(n + v) || v / n < 0 || v / n > MAX_VAT_SHARE || (v === 0 && !hits.vat.includes(0))) continue;
      sums.push({ net: n / 100, vat: v / 100, gross: (n + v) / 100, score: +hits.net.includes(n) + +hits.vat.includes(v) + +hits.gross.includes(n + v) });
    }
  }
  sums.sort((a, b) => b.score - a.score);
  // Where the page labels no amount at all, a sum is believed when it is the only one that charges VAT.
  const unlabelled = net === undefined && vat === undefined && gross === undefined;
  const [best, second] = sums[0]?.score ? sums : unlabelled ? sums.filter((sum) => sum.vat !== 0) : [];
  if (best && best.score > (second?.score ?? -1)) return { net: best.net, vat: best.vat, gross: best.gross };

  // Labelled amounts that cannot belong together are not believed either. Net and gross may: the VAT between them
  // is printed in parts where an invoice has several rates.
  const share = (part: number, whole: number) => part / whole >= 0 && part / whole <= MAX_VAT_SHARE;
  if (net !== undefined && gross !== undefined) return share(gross - net, net) ? { net: first.net, gross: first.gross } : {};
  const whole = net ?? gross;
  return vat === undefined || whole === undefined || share(vat, whole) ? first : {};
}

const CURRENCY_SIGNS: [RegExp, string][] = [
  [/€|\bEUR\b/, 'EUR'],
  [/\$|\bUSD\b/, 'USD'],
  [/£|\bGBP\b/, 'GBP'],
  [/\bCHF\b/, 'CHF'],
];

/**
 * The currency after its label, or the one currency the page shows. A page with two, such as one that also gives the
 * VAT in euros, is in the one currency of its totals; where they do not tell either, it stays unread.
 */
export function findCurrency(text: string): string | undefined {
  const shown = (part: string) => CURRENCY_SIGNS.filter(([pattern]) => pattern.test(part)).map(([, code]) => code);
  const [onPage, inTotals] = [
    shown(text),
    shown(
      text
        .split('\n')
        .filter((row) => TOTALS_ROW.test(row))
        .join('\n'),
    ),
  ];
  const one = onPage.length === 1 ? onPage : inTotals.length === 1 ? inTotals : [];
  return after(text, /währung|currency|devise/, new RegExp(`${SEPARATOR}([A-Z]{3})\\b`))[0]?.hit[1] ?? one[0];
}
