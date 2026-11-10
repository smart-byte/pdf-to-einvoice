import { isIban } from './check.js';
import type { InvoiceDraft, Line, Party, VatCategory } from './model.js';

// ponytail: patterns for German, English and French invoices, no model. A value is believed for what it fits to, not
// for where it stands: the totals are three printed amounts with net + VAT = gross, the items are rows that add up to
// them, quantity and price are two numbers that multiply to the row total, the seller is the party under a seller
// label, in a sender line or beside its register entry, and the buyer is the address that is left. What does not fit
// stays unread: less, never something invented. Ceiling: labels are still words, and a name is believed as printed;
// add words here before reaching for anything smarter.

const MONTHS = ['jan', 'feb', 'm[aä]r', 'apr', 'ma[iy]', 'jun', 'jul', 'aug', 'sep', 'o[ck]t', 'nov', 'de[cz]'];
const MONTH = `(${MONTHS.join('|')})[a-zä]*\\.?`;
const SEPARATOR = '^\\s*[:#.]?\\s*';

/** ISO, 3.11.2026, 3.11.26, 3 November 2026, November 3, 2026, and 08/10/2026 where it can be read in one way only. */
const DATE = new RegExp(
  `${SEPARATOR}(?:(\\d{4})-(\\d{2})-(\\d{2})|(\\d{1,2})\\.\\s?(\\d{1,2})\\.\\s?(\\d{4}|\\d{2})(?!\\d)|(\\d{1,2})\\.?\\s+${MONTH}\\s+(\\d{4})|${MONTH}\\s+(\\d{1,2}),?\\s+(\\d{4})|(\\d{1,2})/(\\d{1,2})/(\\d{4}|\\d{2})(?!\\d))`,
  'i',
);
const MONEY = "(-?\\d{1,3}(?:[.,' ]\\d{3})*[.,]\\d{2}|-?\\d+[.,]\\d{2})";
const CURRENCY = '(?:€|EUR|US\\$|\\$|USD|£|GBP|CHF)';
const AMOUNT = new RegExp(`${SEPARATOR}(?:\\d{1,2}(?:[.,]\\d+)?\\s*%\\s*)?(?:in\\s+)?${CURRENCY}?\\s*${MONEY}(?![.,]?\\d)`);

const pad = (n: string | number) => String(n).padStart(2, '0');
const century = (year: string) => (year.length === 2 ? `20${year}` : year);
const monthNumber = (name: string) => MONTHS.findIndex((m) => new RegExp(`^${m}`, 'i').test(name)) + 1;
const cents = (n: number) => Math.round(n * 100);
const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** The index of the last item that passes the test, or -1. */
const lastIndex = <T>(items: T[], test: (item: T) => unknown) => items.reduce((last, item, i) => (test(item) ? i : last), -1);

function toIsoDate(m: RegExpExecArray, dayFirst: boolean): string | undefined {
  if (m[1]) return `${m[1]}-${m[2]}-${m[3]}`;
  if (m[4]) return `${century(m[6]!)}-${pad(m[5]!)}-${pad(m[4])}`;
  if (m[7]) return `${m[9]}-${pad(monthNumber(m[8]!))}-${pad(m[7])}`;
  if (m[10]) return `${m[12]}-${pad(monthNumber(m[10]))}-${pad(m[11]!)}`;
  // With slashes, day and month can be told apart when one is above 12, or when a German or French label says who wrote it.
  const [a, b] = [Number(m[13]), Number(m[14])];
  if (b > 12 && a <= 12) return `${century(m[15]!)}-${pad(a)}-${pad(b)}`;
  if ((a > 12 || dayFirst) && b <= 12) return `${century(m[15]!)}-${pad(b)}-${pad(a)}`;
  return undefined;
}

/**
 * "1.499,00" and "1,499.00" both mean 1499: the last separator is the decimal one. Three digits behind the only
 * separator are thousands ("1.000 Stk"), unless a zero stands in front ("0.025").
 */
function toNumber(printed: string): number {
  const digits = printed.replace(/[^\d.,-]/g, '');
  const last = Math.max(digits.lastIndexOf(','), digits.lastIndexOf('.'));
  if (last < 0) return Number(digits);
  const [whole, fraction] = [digits.slice(0, last).replace(/[.,]/g, ''), digits.slice(last + 1)];
  return Number(fraction.length === 3 && Number(whole) !== 0 ? whole + fraction : `${whole}.${fraction}`);
}

interface Hit {
  hit: RegExpExecArray;
  label: string;
  /** Where the label starts. */
  at: number;
}

/**
 * Applies `value` to what follows each occurrence of `label`: in the same line, or in the line below when the label
 * ends a line of one column. Below a label that ends a row of several columns stands the next row, not its value.
 */
function after(text: string, label: RegExp, value: RegExp): Hit[] {
  const hits: Hit[] = [];
  for (const match of text.matchAll(new RegExp(label.source, 'gi'))) {
    const [rest = '', below = ''] = text.slice(match.index + match[0].length).split('\n', 2);
    const before = text.slice(text.lastIndexOf('\n', match.index) + 1, match.index);
    const hit = value.exec((/^[\s:]*$/.test(rest) && !/\s{3}/.test(before) ? below : rest).slice(0, 60));
    if (hit) hits.push({ hit, label: match[0], at: match.index });
  }
  return hits;
}

// ISO 13616 gives every country one IBAN length. Without it, a cut-off part of a wrong IBAN passes the check now and then.
const IBAN_LENGTH = new Map(
  'AD24 AT20 BE16 BG22 CH21 CY28 CZ24 DE22 DK18 EE20 ES24 FI18 FR27 GB22 GR27 HR21 HU28 IE22 IS26 IT27 LI21 LT20 LU20 LV21 MC27 MT31 NL18 NO15 PL28 PT25 RO24 SE24 SI19 SK24 SM27'
    .split(' ')
    .map((entry) => [entry.slice(0, 2), Number(entry.slice(2))]),
);

function findIban(text: string): string | undefined {
  for (const match of text.matchAll(/\b[A-Z]{2}\d{2}(?: ?[A-Z0-9]{4}){2,7}(?: ?[A-Z0-9]{1,3})?/g)) {
    const candidate = match[0].replace(/ /g, '');
    // The pattern may swallow a following word; the length of the country tells where the IBAN ends.
    const iban = candidate.slice(0, IBAN_LENGTH.get(candidate.slice(0, 2)) ?? candidate.length);
    if (iban.length === (IBAN_LENGTH.get(iban.slice(0, 2)) ?? iban.length) && isIban(iban)) return iban;
  }
  return undefined;
}

const CURRENCY_SIGNS: [RegExp, string][] = [
  [/€|\bEUR\b/, 'EUR'],
  [/\$|\bUSD\b/, 'USD'],
  [/£|\bGBP\b/, 'GBP'],
  [/\bCHF\b/, 'CHF'],
];

/** The currency after its label, or the one currency the page shows. A page with two does not tell which one the invoice is in. */
function findCurrency(text: string): string | undefined {
  const shown = CURRENCY_SIGNS.filter(([pattern]) => pattern.test(text));
  return after(text, /währung|currency|devise/, new RegExp(`${SEPARATOR}([A-Z]{3})\\b`))[0]?.hit[1] ?? (shown.length === 1 ? shown[0]![1] : undefined);
}

const VAT_ID_LABEL =
  /ust\.?-?\s?id\.?-?\s?(?:nr\.?)?|umsatzsteuer-?\s?id(?:entifikationsnummer)?|uid(?:-nr\.?)?|vat[\s-]*(?:id|reg(?:istration)?\.?)?\s*(?:no\.?|number)?|(?:n°\s*)?tva(?:\s+intracom\w*)?(?:\s+client)?/;
/** A German VAT ID has a shape of its own, DE and nine digits. An IBAN goes on with digits, a SEPA creditor ID with letters. */
const GERMAN_VAT_ID = /(?<![A-Z0-9])DE(?: ?\d){9}(?! ?\d)/g;
/** What stands before the label of a VAT ID that is the customer's ("Ihre USt-IdNr."), or ends it ("N° TVA client"). */
const CUSTOMER = /(?:customer|client|kunden?-?|käufers?|buyer(?:'s)?|ihre|your)\s*$/i;

/** The VAT IDs of a text in the order they are printed, each once: after a label ("DE123456789", "DE 123 456 789") or by the German shape. */
function vatIdsIn(text: string): { id: string; customer: boolean }[] {
  const found = [
    ...after(text, VAT_ID_LABEL, new RegExp(`${SEPARATOR}([A-Z]{2}(?: ?[A-Z0-9]){8,12})\\b`)).map(({ hit, label, at }) => ({
      id: hit[1]!.replace(/ /g, ''),
      at,
      customer: CUSTOMER.test(text.slice(Math.max(0, at - 20), at)) || CUSTOMER.test(label),
    })),
    ...[...text.matchAll(GERMAN_VAT_ID)].map((match) => ({ id: match[0].replace(/ /g, ''), at: match.index, customer: false })),
  ].sort((a, b) => a.at - b.at);
  return found.filter((entry, i) => found.findIndex((other) => other.id === entry.id) === i);
}

// ---------------------------------------------------------------------------------------------------------------
// Parties. extractLayout() writes three spaces between columns, so a row splits into cells; its blocks are the
// columns themselves. Without blocks, the first cells of the rows stand in for the one column that matters most.

/** A value that starts with a colon stays with its label: "Nummer   : 77" is one cell. */
const cells = (row: string) => row.split(/\s{3,}(?!:)/).map((cell) => cell.trim());
/** "Name · Street 1 · 12345 City", also written with dashes, bars or dots. */
const SENDER_SEPARATOR = /\s[·|•●–—-]\s/;
/** "12345 Musterstadt", "DE-12345 Musterstadt", "D-12345 Musterstadt", "DE 12345 Musterstadt". */
const POSTAL = /^(?:([A-Z]{1,2})[- ])?(\d{4,5})\s+(\p{L}.*)$/u;
/** "Dover, DE 19901", with the country in front ("USA – Dover, DE 19901") or behind ("Dover, DE 19901, USA"). */
const US_PLACE =
  /^(?:(?:USA|United States(?: of America)?)\s[–—-]\s)?([\p{L} .'-]+),\s[A-Z]{2}\s(\d{5}(?:-\d{4})?)(?:,\s(?:USA|United States(?: of America)?))?$/u;
const EU = new Set('AT BE BG CY CZ DE DK EE ES FI FR GR HR HU IE IT LT LU LV MT NL PL PT RO SE SI SK'.split(' '));
/** The letters in front of a postal code: an ISO code, or the older sign of the country. */
const COUNTRY_PREFIX: Record<string, string> = { D: 'DE', A: 'AT', F: 'FR', B: 'BE', L: 'LU', CH: 'CH' };
/** VAT IDs start with the country code, except that Greece writes EL. */
const countryOfVatId = (vatId: string | undefined) => (vatId ? vatId.slice(0, 2).replace('EL', 'GR') : undefined);

/** Postal code, city and country, from the last line of an address. */
function placeOf(line: string): Partial<Party> | undefined {
  const postal = POSTAL.exec(line);
  if (postal) return { postalCode: postal[2], city: postal[3], country: COUNTRY_PREFIX[postal[1] ?? ''] ?? (EU.has(postal[1] ?? '') ? postal[1] : undefined) };
  const american = US_PLACE.exec(line);
  return american ? { postalCode: american[2], city: american[1]!.trim(), country: 'US' } : undefined;
}

/** The party named by a line like "Name · Street 1 · 12345 City", as letterheads and footers have it. */
function senderOf(cell: string): Partial<Party> | undefined {
  if (!SENDER_SEPARATOR.test(cell)) return undefined;
  const segments = cell.split(new RegExp(`${SENDER_SEPARATOR.source}|,\\s`)).map((segment) => segment.trim());
  // A street may look like a place ("1500 chemin des vignes"); the place comes last.
  const i = lastIndex(segments, (segment) => POSTAL.test(segment));
  return i >= 1 ? { name: segments[0], street: i >= 2 ? segments[i - 1] : undefined, ...placeOf(segments[i]!) } : undefined;
}

type Role = 'seller' | 'buyer' | 'other';
const BUYER =
  'bill(?:ed)?\\s+to|invoice\\s+to|sold\\s+to|rechnung\\s+an|rechnungsempfänger|rechnungsadresse|rechnungsanschrift|kunde|customer|client|buyer|käufer|leistungsempfänger|empfänger|destinataire|acheteur|adresse\\s+de\\s+facturation|billing\\s+address';
const SELLER = 'verkäufer|lieferant|leistungserbringer|rechnungssteller|absender|seller|supplier|vendor|vendeur|fournisseur|from';
/** A label on a line of its own, such as "Käufer:", "Käufer/Leistungsempfänger:" or "BILL TO". */
const heading = (labels: string) => new RegExp(`^(?:${labels})(?:\\s*[/&]\\s*[\\p{L}-]+)*\\s*:?$`, 'iu');
const [BUYER_HEADING, SELLER_HEADING] = [heading(BUYER), heading(SELLER)];
const BUYER_START = new RegExp(`^(?:${BUYER})\\b`, 'i');
/** Other headings of an address: a label without a value, or one that says so ("Adresse de livraison", "Warenempfänger"). */
const OTHER_HEADING = /:$|adresse|address|anschrift|empfänger/i;
/** A line with a label and its value, such as "Kundennummer: 77" or "GLN 4012345000009". */
const KEY_VALUE = /\S\s*:\s*\S|^\p{L}[\p{L}.-]*\s+\d[\d ]{7,}$/u;
/** A date or an amount of money: no line of an address holds one. */
const DATE_OR_AMOUNT = /\d{1,2}[./]\d{1,2}[./]\d{2,4}|\d{4}-\d{2}-\d{2}|\d[.,]\d{2}(?!\d)/;
/** The title of the document, alone or at the end of a cell ("Ihre Rechnung"), and with its number ("Rechnung 2301"). */
const TITLE = /(?:^|\s)(?:Rechnung|Invoice|Facture)$/i;
const NAMED = /^(?:Rechnung|Invoice|Facture|Avoir)[ \t]+([A-Z]{0,3}[-/]?\d{2,}[\w/-]*)$/i;
const SALUTATION = /^(?:herrn?|frau|mr\.?|mrs\.?|ms\.?|monsieur|madame|mme\.?)$/i;
const LEGAL_FORM = /(?:^|\s)(?:gmbh|mbh|ag|kg|ohg|gbr|e\.\s?[vk]\.|a\.\s?g\.|ltd\.?|inc\.?|llc|plc|sarl|sas|s\.a\.|b\.v\.)(?=\s|$)|&\s*co\b/i;
/** What only the issuer prints about itself: its tax number and its entry in the commercial register. */
const ISSUER_SIGNS = /steuer-?(?:nr|nummer)|\bst\.?-?nr|tax\s+(?:number|no\b)|\bhr[ab]\b|amtsgericht|registergericht|handelsregister|siret/i;

function roleOf(line: string): Role | undefined {
  return BUYER_HEADING.test(line) ? 'buyer' : SELLER_HEADING.test(line) ? 'seller' : OTHER_HEADING.test(line) ? 'other' : undefined;
}

/** An address as found on the page, with what tells whose it is. */
interface Found {
  party: Partial<Party>;
  /** What the heading above it says. */
  role?: Role;
  /** Read from a sender line. */
  sender?: boolean;
  /** The labelled lines right below it, which may hold its VAT ID or tax number. */
  tail: string;
}

/**
 * The addresses of one column: the lines above a line with postal code and city, up to three of them, or up to five
 * under a heading. A heading, a labelled value, a date, an amount, a sender line or the place of another address
 * ends the address above it.
 */
function addressesIn(lines: string[]): Found[] {
  const ends = (line: string) =>
    !line ||
    /:/.test(line) ||
    KEY_VALUE.test(line) ||
    roleOf(line) ||
    BUYER_START.test(line) ||
    DATE_OR_AMOUNT.test(line) ||
    TITLE.test(line) ||
    placeOf(line) ||
    senderOf(line);
  const found: Found[] = [];
  lines.forEach((line, i) => {
    // Of two lines that look like a place the lower one is it: "1500 chemin des vignes" stands above "84000 Villexemple".
    const place = senderOf(line) || placeOf(lines[i + 1] ?? '') ? undefined : placeOf(line);
    if (!place) return;
    /** The lines above the place, and what the heading above them says. Labelled values may stand between heading and address. */
    const climb = (through: boolean) => {
      const above: string[] = [];
      let j = i - 1;
      // Under a heading an address may also name a person and a department; without one, more lines are anything.
      for (; j >= 0 && above.length < (through ? 5 : 3); j--) {
        if (through && KEY_VALUE.test(lines[j]!)) continue;
        if (ends(lines[j]!)) break;
        above.unshift(lines[j]!);
      }
      for (let hops = 0; j >= 0 && hops < 3 && KEY_VALUE.test(lines[j]!); hops++) j--;
      return { above, role: j >= 0 ? roleOf(lines[j]!) : undefined };
    };
    // Under a heading everything down to the place is the address, also past a labelled value in its midst. Without
    // one, such a value ends the address above it: it may belong to anything.
    const under = climb(true);
    const { above, role } = under.role ? under : climb(false);
    if (above.length < 2) return;
    const tail: string[] = [];
    for (let k = i + 1; k < lines.length && tail.length < 4 && KEY_VALUE.test(lines[k]!); k++) tail.push(lines[k]!);
    const [first, second] = above.length >= 3 ? above : [above[0]!];
    // "Herrn" above a name and a second line with the legal form belong to the name; another second line names a person.
    const joined = second !== undefined && (SALUTATION.test(first!) || LEGAL_FORM.test(second));
    // A person has no number: two lines with one are two streets, as when rows mix two addresses. Neither is believed.
    const mixed = second !== undefined && !joined && /\d/.test(second);
    const party = {
      name: joined ? `${first} ${second}` : first,
      contactName: joined || mixed ? undefined : second,
      street: mixed ? undefined : above.at(-1),
      ...place,
    };
    found.push({ party, role, tail: tail.join('\n') });
  });
  return found;
}

/**
 * Seller and buyer. The seller is the party under a seller label or in a sender line, or the one that repeats on the
 * page and shows its register entry; nobody else prints those. The buyer is the address under a buyer label, or the
 * one address that is neither the seller's nor under another label. Two addresses that nothing tells apart stay unread.
 */
function readParties(rows: string[], blocks: string[][]): { seller?: Found; buyer?: Found } {
  const senders = rows.flatMap((row) =>
    cells(row).flatMap((cell) => {
      const party = senderOf(cell);
      return party ? [{ party, sender: true, tail: row }] : [];
    }),
  );
  const addresses = blocks.flatMap(addressesIn);
  const signs = (found: Found) => {
    const named = rows.filter((row) => row.includes(found.party.name!));
    return (
      (found.sender || found.role === 'seller' ? 2 : 0) +
      (named.length > 1 ? 1 : 0) +
      (ISSUER_SIGNS.test(found.tail) || named.some((row) => ISSUER_SIGNS.test(row)) ? 1 : 0)
    );
  };
  const ranked = [...senders, ...addresses.filter((found) => found.role === undefined || found.role === 'seller')]
    .map((found) => ({ found, signs: signs(found) }))
    .sort((a, b) => b.signs - a.signs);
  const [best] = ranked;
  const seller =
    best && best.signs >= 2 && ranked.every((other) => other.signs < best.signs || other.found.party.name === best.found.party.name) ? best.found : undefined;

  const isSellers = ({ party }: Found) =>
    seller !== undefined &&
    ([party.name, party.contactName, party.street].includes(seller.party.name) ||
      (party.street !== undefined && party.street === seller.party.street && party.postalCode === seller.party.postalCode));
  const labelled = addresses.filter((found) => found.role === 'buyer');
  const left = labelled.length ? labelled : addresses.filter((found) => found.role === undefined && !isSellers(found));
  return { seller, buyer: new Set(left.map((found) => found.party.name)).size === 1 ? left[0] : undefined };
}

// ---------------------------------------------------------------------------------------------------------------
// Totals

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
const TOTALS_ROW =
  /^(?:\d{1,2}(?:[.,]\d+)?\s?%\s*)?(?:(?:netto|brutto|gesamt)(?:betrag|summe)?|zwischensumme|summe|mwst|ust|umsatzsteuer|mehrwertsteuer|rechnungsbetrag|endbetrag|zzgl|total|subtotal|vat|tax(?:es)?|tva|übertrag)\b/i;
const TOTALS_CELL = /(?:summe|betrag)(?![\p{L}])|\btotal\b/iu;
/** An amount that stands on its own: not part of a date, a longer number or a percentage. */
const PRINTED_AMOUNT = new RegExp(`(?<![\\d.,])${MONEY}(?![.,]?\\d)(?!\\s?%)`, 'g');
// ponytail: the standard and reduced rates of the EU and Switzerland as of 2026; a rate that is not listed reads as no rate.
const RATES = [0, 2.1, 2.6, 3.8, 4, 4.8, 5, 5.5, 6, 7, 8, 8.1, 9, 9.5, 10, 12, 13, 13.5, 14, 15, 17, 18, 19, 20, 21, 22, 23, 24, 25, 25.5, 27];
/** No invoice carries more VAT than the highest rate; one with several rates carries less. */
const MAX_VAT_SHARE = 0.3;

/** The VAT rate at which `vat` is the tax on `net`, give or take a cent of rounding. */
function rateOf(net: number, vat: number): number | undefined {
  const off = (rate: number) => Math.abs((cents(net) * rate) / 100 - cents(vat));
  const rate = RATES.reduce((best, candidate) => (off(candidate) < off(best) ? candidate : best));
  return net !== 0 && off(rate) <= (rate === 0 ? 0 : 1) ? rate : undefined;
}

type Totals = { net?: number; vat?: number; gross?: number };

/**
 * The totals: three printed amounts with net + VAT = gross. Labels say which three when several fit, and nothing
 * else: an amount after a label is not believed against the sum. One or two labelled amounts are kept when no
 * three amounts fit, as on an invoice without VAT.
 */
function readTotals(searched: string, text: string): Totals {
  const labelled = (label: RegExp) => after(searched, label, AMOUNT).map(({ hit }) => cents(toNumber(hit[1]!)));
  const hits = { net: labelled(NET_LABEL), vat: labelled(VAT_LABEL), gross: labelled(GROSS_LABEL) };
  const [net, vat, gross] = [hits.net[0], hits.vat[0], hits.gross[0]];
  const first = { net: net === undefined ? net : net / 100, vat: vat === undefined ? vat : vat / 100, gross: gross === undefined ? gross : gross / 100 };
  if (net !== undefined && vat !== undefined && net + vat === gross) return first;

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

// ---------------------------------------------------------------------------------------------------------------
// Items

const UNITS: [RegExp, string][] = [
  [/^(std|stunden?|h|hours?|hrs?)\.?$/i, 'HUR'],
  [/^(tage?|days?)\.?$/i, 'DAY'],
  [/^(monate?|months?)\.?$/i, 'MON'],
  [/^kg\.?$/i, 'KGM'],
  [/^(l|liter|litre)(\(?s\)?)?\.?$/i, 'LTR'],
  [/^(m²|qm)\.?$/i, 'MTK'],
  [/^m\.?$/i, 'MTR'],
  [/^(pauschal|psch)\.?$/i, 'LS'],
];
const MONEY_CELL = new RegExp(`^[€$£]?\\s*${MONEY}\\s*${CURRENCY}?$`);
const RATE_CELL = /^\(?(\d{1,2}(?:[.,]\d+)?)\s?%\)?$/;
const QUANTITY_CELL = /^(-?\d+(?:[.,]\d+)?)\s*(\p{L}+\.?)?$/u;
/** A number with what follows it: a percent sign, a currency, or a unit. */
const NUMBER = new RegExp(`(-?\\d[\\d.,']*)\\s*(%|${CURRENCY}|\\p{L}[\\p{L}\\d()²³]*\\.?)?`, 'gu');
const IS_CURRENCY = new RegExp(`^${CURRENCY}$`);
/** How many rows a description may wrap into. */
const MAX_WRAPPED = 4;

/** A row of the table as read: `total` is its net amount, or its gross amount where prices include VAT. */
interface Item {
  name?: string;
  quantity?: number;
  unit?: string;
  unitPrice?: number;
  vatRate?: number;
  total: number;
  /** Counts the summing rows and headings above it: the items of an invoice stand in one table. */
  table: number;
  /** The cell that holds its name, as printed. */
  cell?: string;
  /** The cells of the rows between this item and the next: its description may go on in some of them. */
  below: string[];
}

/** A number in a row, with the sign or word behind it, and whether it is written like an amount of money. */
interface Figure {
  value: number;
  mark: string;
  money: boolean;
}

/**
 * One row of the table, from its cells up to the one with the row total. Which number is the quantity and which the
 * price is read from the product: the two that multiply to the total. A row may also carry net, VAT and gross.
 */
function itemOf(parts: string[], table: number): Item {
  const numbered = /^\d{1,3}\.?$/.test(parts[0]!);
  const before = parts.slice(numbered ? 1 : 0, -1);
  const name = before.find((cell) => !RATE_CELL.test(cell) && !MONEY_CELL.test(cell) && !QUANTITY_CELL.test(cell));
  const figures: Figure[] = before
    .filter((cell) => cell !== name && /^\(?[€$£]?\s*-?\d/.test(cell))
    .flatMap((cell) => [...cell.matchAll(NUMBER)])
    .map(([, number, mark = '']) => ({ value: toNumber(number!), mark, money: /[.,]\d{2}$/.test(number!) }));
  const item: Item = { name, cell: name, total: toNumber(MONEY_CELL.exec(parts.at(-1)!)![1]!), table, below: [] };

  const rates = figures.filter((figure) => figure.mark === '%');
  if (rates.length === 1) item.vatRate = rates[0]!.value;
  let others = figures.filter((figure) => figure.mark !== '%');
  // "10,00 €   1,90 €   11,90 €": net, VAT and gross of the row.
  const [net, vat] = others.filter((figure) => figure.money).slice(-2);
  if (net && vat && cents(net.value) + cents(vat.value) === cents(item.total) && rateOf(net.value, vat.value) !== undefined) {
    item.total = net.value;
    others = others.filter((figure) => figure !== net && figure !== vat);
  }

  // Nothing but the total, or the total once more: one unit at that price.
  if (others.every((figure) => cents(figure.value) === cents(item.total))) return { ...item, quantity: 1, unitPrice: item.total };
  const isPrice = (figure: Figure) => IS_CURRENCY.test(figure.mark);
  const hasUnit = (figure: Figure) => figure.mark !== '' && !isPrice(figure);
  for (const [i, a] of others.entries()) {
    for (const b of others.slice(i + 1)) {
      if (Math.round(a.value * b.value * 100) !== cents(item.total)) continue;
      // ponytail: where neither a currency nor a unit nor a whole number tells, the quantity is taken to come first.
      const swap = isPrice(a) || hasUnit(b) || (!hasUnit(a) && !isPrice(b) && !Number.isInteger(a.value) && Number.isInteger(b.value));
      const [quantity, price] = swap ? [b, a] : [a, b];
      return { ...item, quantity: quantity.value, unit: UNITS.find(([pattern]) => pattern.test(quantity.mark))?.[1], unitPrice: price.value };
    }
  }
  // No two numbers give the total, e.g. because of a discount or a rounded quantity: both stay open.
  return item;
}

/** The longest run of consecutive items of one table that adds up to the total, with the rows of nothing around it. */
function runOf(items: Item[], total: number | undefined): Item[] | undefined {
  if (total === undefined) return undefined;
  const weight = (run: Item[]) => run.filter((item) => cents(item.total) !== 0).length;
  let best: Item[] | undefined;
  for (const [i, start] of items.entries()) {
    const inTable = (item: Item | undefined): item is Item => item?.table === start.table;
    const isZero = (item: Item | undefined) => inTable(item) && cents(item.total) === 0;
    if (isZero(start)) continue;
    let sum = 0;
    for (let j = i; inTable(items[j]); j++) {
      sum += cents(items[j]!.total);
      if (sum !== cents(total)) continue;
      let [from, to] = [i, j];
      while (isZero(items[from - 1])) from--;
      while (isZero(items[to + 1])) to++;
      const run = items.slice(from, to + 1);
      if (!best || weight(run) > weight(best)) best = run;
      break;
    }
  }
  return best;
}

/** Joins the lines a text wraps into: with a space, or without one where a hyphen holds two of them together ("Wartungs-", "Vertrag"). */
const unwrap = (lines: string[]) =>
  lines.slice(1).reduce((text, line) => (/[\p{L}\d]-$/u.test(text) || /^-\p{L}/u.test(line) ? text + line : `${text} ${line}`), lines[0] ?? '');

/**
 * The line items: rows with a name and an amount that add up to the printed total, wherever they stand. A
 * description may wrap into the rows around it. Rows that add up to the gross total carry prices with VAT; their net
 * prices are derived from the rate. Rows that do not add up are not believed: nothing is returned and a person fills
 * the lines in.
 */
function readItems(rows: string[], totals: Totals, blocks: string[][] | undefined): Partial<Line>[] | undefined {
  const items: Item[] = [];
  /** Rows of text between items: the end of the description above, or the start of the one below. */
  let loose: string[] = [];
  let table = 0;
  /** The last item, while it may still take the rows that follow it. */
  let open: Item | undefined;
  const closeLoose = () => {
    if (open && loose.length <= MAX_WRAPPED) open.name = unwrap([open.name, ...loose].filter((part): part is string => Boolean(part)));
    loose = [];
  };
  for (const row of rows) {
    const all = cells(row);
    // A row may end with a cell of the column beside the table.
    const parts = all.slice(0, lastIndex(all, (cell) => MONEY_CELL.test(cell)) + 1);
    if (TOTALS_ROW.test(row) || all.some((cell) => TOTALS_CELL.test(cell))) {
      closeLoose();
      open = undefined;
      table++;
    } else if (parts.length >= 2) {
      const item = itemOf(parts, table);
      // A row with only number and amount takes its description from the text above it; other text above belongs to the previous item.
      if (item.name === undefined && parts.length === 2) item.name = unwrap(loose.splice(0).slice(-MAX_WRAPPED));
      closeLoose();
      items.push(item);
      open = item;
    } else {
      items.at(-1)?.below.push(...all);
      if (all.length === 1 && !/:/.test(row)) loose.push(all[0]!);
      else {
        // Another row ends the description above it, and a row of headings starts another table.
        loose = [];
        open = undefined;
        if (all.length >= 3 && !/\d/.test(row)) table++;
      }
    }
  }
  closeLoose();

  // Beside a description that wraps, other columns go on, and the rows mix them. Its block has it alone: the lines
  // below its first one, as far as they stand in the rows of this item.
  const seen = new Map<string, number>();
  for (const item of items) {
    if (!blocks || item.cell === undefined) continue;
    // The same text may name several items: they stand in the blocks in the order of the rows.
    const nth = seen.get(item.cell) ?? 0;
    seen.set(item.cell, nth + 1);
    const place = blocks.flatMap((block) => block.flatMap((line, i) => (line === item.cell ? [{ block, i }] : [])))[nth];
    const more: string[] = [];
    for (let k = (place?.i ?? 0) + 1; place && more.length < MAX_WRAPPED && item.below.includes(place.block[k]!) && !KEY_VALUE.test(place.block[k]!); k++)
      more.push(place.block[k]!);
    if (more.length) item.name = unwrap([item.cell, ...more]);
  }

  // Without VAT the rows add up to the total itself.
  const net = totals.net ?? (totals.vat === undefined ? totals.gross : undefined);
  let run = runOf(items, net);
  const inclusive = !run && totals.net !== undefined;
  if (inclusive) run = runOf(items, totals.gross);
  if (!run) return undefined;

  // A rate that the rows do not carry is the one the totals name, if they name exactly one.
  const totalRates = new Set(
    rows.filter((row) => TOTALS_ROW.test(row)).flatMap((row) => [...row.matchAll(/(\d{1,2}(?:[.,]\d+)?)\s?%/g)].map((m) => toNumber(m[1]!))),
  );
  const onlyRate = totalRates.size === 1 ? [...totalRates][0] : undefined;
  const lines = run.map((item) => ({ ...item, vatRate: item.vatRate ?? onlyRate, net: cents(item.total) }));
  if (inclusive) {
    for (const line of lines) {
      if (line.vatRate === undefined || !line.quantity) return undefined;
      line.net = Math.round((cents(line.total) * 100) / (100 + line.vatRate));
      line.unitPrice = Math.round(line.net / line.quantity) / 100;
      // The printed net total has to come out to the cent, also line by line.
      if (cents(line.quantity * line.unitPrice) !== line.net) return undefined;
    }
    if (lines.reduce((sum, line) => sum + line.net, 0) !== cents(totals.net!)) return undefined;
  }
  // Rates are believed when they give the printed VAT: a percentage in a row may as well be a discount.
  const taxable = new Map<number | undefined, number>();
  for (const line of lines) taxable.set(line.vatRate, (taxable.get(line.vatRate) ?? 0) + line.net);
  const tax = [...taxable].reduce((sum, [rate, base]) => sum + Math.round((base * (rate ?? NaN)) / 100), 0);
  const rated = totals.vat === undefined || Math.abs(tax - cents(totals.vat)) <= taxable.size;
  return lines.map((line) => ({
    name: line.name || undefined,
    quantity: line.quantity,
    unit: line.unit ?? 'C62',
    unitPrice: line.unitPrice,
    vatCategory: 'S' as VatCategory,
    vatRate: rated ? line.vatRate : undefined,
  }));
}

/** The printed sentence that says why no VAT is charged, joined over the rows it wraps into. */
function readVatNote(rows: string[]): string | undefined {
  const start = rows.findIndex(
    (row) =>
      /\b(vat|umsatzsteuer|mehrwertsteuer|steuerschuld\w*|reverse[- ]charge|steuerfrei\w*|steuerbefreit\w*|nicht steuerbar)\b|§\s?\d+\w*\s.*ustg/i.test(row) &&
      !TOTALS_ROW.test(row) &&
      !cells(row).some(senderOf) &&
      !/\b[A-Z]{2} ?\d[\d ]{7,}/.test(row),
  );
  if (start < 0) return undefined;
  const note = [rows[start]!.replace(/^\s*(note|hinweis|anmerkung)\s*:\s*/i, '')];
  // The sentence goes on while a row starts in lower case and the one before it did not end.
  for (let i = start + 1; i < rows.length && note.length <= MAX_WRAPPED && !/[.!?]$/.test(note.at(-1)!) && /^[\p{Ll}\d§(]/u.test(rows[i]!); i++)
    note.push(rows[i]!);
  return note.join(' ').replace(/\s+/g, ' ').trim();
}

// ---------------------------------------------------------------------------------------------------------------
// Number, dates, period

const PERIOD_LABEL =
  /(?:leistungs|abrechnungs|liefer)?zeitraum|leistungsmonat|leistungsdatum|lieferdatum|(?:service|billing|delivery)\s+(?:period|month)|period/;
const DOTTED = '(\\d{1,2})\\.(\\d{1,2})\\.(\\d{4})';
const PERIOD = new RegExp(
  `${SEPARATOR}(?:Q([1-4])[ /]?(\\d{4})|([1-4])\\.\\s?Quartal\\s+(\\d{4})|${DOTTED}\\s*(?:-|–|bis|to)\\s*${DOTTED}|${MONTH}\\s+(\\d{4})|(\\d{1,2})[./-](\\d{4})(?!\\d)|(\\d{4})-(\\d{2})(?![-\\d]))`,
  'i',
);
const MONTH_ROW = new RegExp(`^${MONTH}\\s+(\\d{4})$`, 'i');
/** "im September 2026", "für Oktober 2026", "for March 2026". */
const MONTH_NAMED = new RegExp(`\\b(?:im|für|for|in)\\s+${MONTH}\\s+(\\d{4})\\b`, 'i');

/**
 * A service period given as a quarter ("Q2 2026"), a month ("Oktober 2026", "10/2026") or two dates, after its
 * label, as a row that holds nothing but a month, or as the month the title names ("Ihre Rechnung", below it "für
 * September 2026"). German VAT law accepts the calendar month as the date of supply (§ 31 (4) UStDV); the XML needs
 * its first and last day.
 */
function readPeriod(text: string, rows: string[]): { periodStart?: string; periodEnd?: string } {
  const months = (year: string, from: number, to: number) => {
    if (from < 1 || to > 12) return undefined;
    return { periodStart: `${year}-${pad(from)}-01`, periodEnd: `${year}-${pad(to)}-${new Date(Date.UTC(Number(year), to, 0)).getUTCDate()}` };
  };
  for (const { hit: m } of after(text, PERIOD_LABEL, PERIOD)) {
    const quarter = Number(m[1] ?? m[3]);
    const period = quarter
      ? months(m[2] ?? m[4]!, quarter * 3 - 2, quarter * 3)
      : m[5]
        ? { periodStart: `${m[7]}-${pad(m[6]!)}-${pad(m[5])}`, periodEnd: `${m[10]}-${pad(m[9]!)}-${pad(m[8]!)}` }
        : m[11]
          ? months(m[12]!, monthNumber(m[11]), monthNumber(m[11]))
          : m[13]
            ? months(m[14]!, Number(m[13]), Number(m[13]))
            : months(m[15]!, Number(m[16]), Number(m[16]));
    if (period) return period;
  }
  const titled = rows.findIndex((row) => cells(row).some((cell) => TITLE.test(cell)));
  const named =
    rows.map((row) => MONTH_ROW.exec(row.trim())).find(Boolean) ?? (titled < 0 ? null : MONTH_NAMED.exec(`${rows[titled]}\n${rows[titled + 1] ?? ''}`));
  return (named && months(named[2]!, monthNumber(named[1]!), monthNumber(named[1]!))) || {};
}

const NUMBER_LABEL = new RegExp(
  [
    'rechnungs?-?\\s?(?:nummer|nr\\.?)',
    'invoice\\s*(?:number|no\\.?|#)',
    'facture\\s*(?:n°|no\\.?|numéro)',
    '(?:n°|numéro)\\s*(?:de\\s+)?facture',
    // A bare "Nr.:" counts only at the start of a cell: "IBAN Nr.: DE02 …" is not an invoice number.
    '(?<=^|\\n|\\s{3})(?:nr|no)\\.?\\s*:',
    // "Rechnungskorrektur Nr. …", "Gutschrift (…) Nr. …": the title of the document, then its number. A title that
    // goes on to name another document ("Rechnung zu Bestellung Nr. …") would give that one's number.
    '(?<=^|\\n)[a-zäöüß]*(?:rechnung|gutschrift|invoice|facture|avoir)(?:(?!bestell|auftrag|order|liefer|angebot|vertrag|kunde|customer)[^\\n\\d])*?\\s(?:nr\\.?|no\\.?|n°|#|nummer|number)(?=[\\s:])',
  ].join('|'),
);

/**
 * The invoice number: after its label, or straight after the word "Rechnung" / "Invoice". Also the date that the
 * same sentence gives ("Nr. 4711 vom 21.10.2026"), and the date beside the title.
 */
function readNumber(searched: string, rows: string[]): { number?: string; dated?: string; beside?: string } {
  const date = (hit: RegExpExecArray | null | undefined) => (hit ? toIsoDate(hit, false) : undefined);
  // Digits in groups ("100 200 300") are one number.
  const [labelled] = after(searched, NUMBER_LABEL, new RegExp(`${SEPARATOR}(\\d{2,4}(?: \\d{2,4})+(?=\\s{3}|$)|[A-Za-z0-9][\\w/.-]*\\d[\\w/-]*)`));
  const titles = rows.map(cells).filter((parts) => parts.some((cell) => TITLE.test(cell) || NAMED.test(cell)));
  const dated = labelled && after(searched, new RegExp(`${escape(labelled.hit[1]!)}\\s+(?:vom|von|issued\\s+(?:at|on)|dated|du|of)`), DATE)[0]?.hit;
  return {
    number: labelled?.hit[1]!.replace(/ /g, '') ?? titles.flatMap((parts) => parts.map((cell) => NAMED.exec(cell)?.[1])).find(Boolean),
    dated: date(dated),
    beside: titles.flatMap((parts) => parts.map((cell) => date(DATE.exec(cell)))).find(Boolean),
  };
}

const GERMAN_WORDS = /\b(rechnung\w*|mwst|ust|umsatzsteuer|mehrwertsteuer|netto|brutto|gesamt\w*|betrag|datum|menge|zahlbar|leistung\w*|lieferung)\b/gi;
const ENGLISH_WORDS = /\b(invoice|vat|tax|subtotal|total|amount|date|quantity|payable|payment|due|delivery)\b/gi;

/** The language an invoice is written in, judged by the words invoices use. English when nothing tells. */
export function languageOf(text: string): 'de' | 'en' {
  return (text.match(GERMAN_WORDS)?.length ?? 0) > (text.match(ENGLISH_WORDS)?.length ?? 0) ? 'de' : 'en';
}

/** Removes undefined values and objects that end up empty. */
function prune<T extends object>(object: T): T {
  if (Array.isArray(object)) return object.map((item) => prune(item)) as T;
  const entries = Object.entries(object)
    .map(([k, v]) => [k, v && typeof v === 'object' ? prune(v) : v] as const)
    .filter(([, v]) => v !== undefined && !(typeof v === 'object' && !Array.isArray(v) && Object.keys(v as object).length === 0));
  return Object.fromEntries(entries) as T;
}

export interface GuessOptions {
  /** The blocks of the page as extractLayout() returns them. With them, an address is read even where rows mix it with the column beside it. */
  blocks?: string[][];
}

/**
 * Reads an invoice from its text without any model: values that fit together, wherever the layout puts them. A
 * starting point for review, not a result: check every value.
 */
export function guessFromText(text: string, options: GuessOptions = {}): InvoiceDraft {
  const rows = text.split('\n');
  // Labels are looked up in the rows first, then in the blocks, where a value stands below its label.
  const searched = [text, ...(options.blocks ?? []).map((block) => block.join('\n'))].join('\n\n');
  const date = (label: RegExp) =>
    after(searched, label, DATE)
      .map(({ hit, label: found }) => toIsoDate(hit, /datum|fällig|zahlbar|facture|échéance/i.test(found)))
      .find(Boolean);
  const first = (label: RegExp, value: RegExp) => after(searched, label, value)[0]?.hit[1];

  const found = readParties(rows, options.blocks ?? [rows.map((row) => cells(row)[0]!)]);
  const totals = readTotals(searched, text);
  const lines = readItems(rows, totals, options.blocks);

  // A VAT ID belongs to the party in whose address it stands. Otherwise the customer's is labelled as such, and the seller's is the first of the rest.
  const vatIds = vatIdsIn(searched);
  const inAddress = (party: Found | undefined) => (party ? vatIdsIn(party.tail)[0]?.id : undefined);
  const buyer: Partial<Party> = { ...found.buyer?.party, vatId: inAddress(found.buyer) ?? vatIds.find(({ customer }) => customer)?.id };
  const seller: Partial<Party> = {
    ...found.seller?.party,
    vatId: inAddress(found.seller) ?? vatIds.find(({ id, customer }) => !customer && id !== buyer.vatId)?.id,
  };
  seller.country ??= countryOfVatId(seller.vatId);
  // An address without a country is at home when VAT is charged: that is the ordinary domestic invoice.
  buyer.country ??= countryOfVatId(buyer.vatId) ?? (buyer.postalCode && lines?.some((line) => (line.vatRate ?? 0) > 0) ? seller.country : undefined);

  // An invoice that shows no VAT at all charges none. Why, the country of the buyer tells: outside the EU the sale is
  // not subject to VAT, elsewhere in the EU the buyer owes it, at home the seller is exempt. A person confirms this.
  const showsNoVat =
    totals.vat === undefined &&
    lines?.every((line) => line.vatRate === undefined) &&
    (totals.net === undefined || totals.gross === undefined || cents(totals.net) === cents(totals.gross));
  let vatExemptionReason: string | undefined;
  if (lines && showsNoVat && buyer.country) {
    const vatCategory: VatCategory = !EU.has(buyer.country) ? 'O' : buyer.country !== seller.country ? 'AE' : 'E';
    for (const line of lines) Object.assign(line, { vatCategory, vatRate: 0 });
    vatExemptionReason = readVatNote(rows);
  }

  const { number, dated, beside } = readNumber(searched, rows);
  const iban = findIban(text);
  return prune({
    number,
    issueDate:
      date(/rechnungs-?datum|belegdatum|invoice\s+date|date\s+of\s+issue|issue\s+date|date\s+de\s+(?:la\s+)?facture|date\s+d['’]émission/) ??
      dated ??
      date(/(?<![a-zäöü-])datum|(?<![a-z] ?)date/) ??
      beside,
    deliveryDate: date(/leistungsdatum|lieferdatum|date\s+of\s+(?:supply|delivery)|delivery\s+date|service\s+date/),
    ...readPeriod(searched, rows),
    dueDate: date(/fällig(?:keit(?:s(?:datum|tag|termin))?|\s+am|\s+bis)?|zahlbar\s+bis|due(?:\s+date|\s+by|\s+on)?|payable\s+by|date\s+d['’]échéance/),
    currency: findCurrency(text),
    iban,
    // A BIC belongs to an IBAN; with another kind of account it has no place in the invoice data.
    bic: iban ? first(/\b(?:bic|swift)(?:[-/ ]?code)?/, new RegExp(`${SEPARATOR}([A-Z]{6}[A-Z0-9]{2}(?:[A-Z0-9]{3})?)\\b`)) : undefined,
    vatExemptionReason,
    seller: {
      ...seller,
      taxNumber: first(/steuernummer|steuer-?nr\.?|st\.?-?nr\.?|tax\s+(?:number|no\.?)/, new RegExp(`${SEPARATOR}(\\d{2,3}/\\d{3,4}/\\d{4,5}|\\d{10,13})`)),
    },
    buyer,
    lines,
    totals,
  });
}
