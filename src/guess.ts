import { isIban } from './check.js';
import { COUNTRY_NAMES } from './ground.js';
import type { InvoiceDraft, InvoiceType, Line, Party, VatCategory } from './model.js';

// Known limit: patterns for German, English and French invoices, no model. A value is believed for what it fits to, not
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
// A label may go on with a word in brackets: "Zwischensumme (netto)". A code such as the category in "USt (S)" is no word.
const AMOUNT = new RegExp(
  `${SEPARATOR}(?:\\([A-Za-zÄÖÜäöüß]{3,}[^)\\d]*\\)\\s*)?(?:\\d{1,2}(?:[.,]\\d+)?\\s*%\\s*)?(?:in\\s+)?${CURRENCY}?\\s*${MONEY}(?![.,]?\\d)`,
);

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

/**
 * The currency after its label, or the one currency the page shows. A page with two, such as one that also gives the
 * VAT in euros, is in the one currency of its totals; where they do not tell either, it stays unread.
 */
function findCurrency(text: string): string | undefined {
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

const VAT_ID_LABEL =
  /ust\.?-?\s?id\.?-?\s?(?:nr\.?)?|umsatzsteuer-?\s?id(?:entifikationsnummer)?|uid(?:-nr\.?)?|vat[\s-]*(?:id|reg(?:istration)?\.?)?\s*(?:no\.?|number)?|(?:n°\s*)?tva(?:\s+intracom\w*)?(?:\s+client)?/;
/** A line that starts with the label of a VAT ID, with or without a colon: "USt-IdNr. ATU12345678". */
const VAT_ID_LINE = new RegExp(`^(?:${VAT_ID_LABEL.source})\\s*:?\\s*[A-Z]{2}`, 'i');
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
/** "12345 Musterstadt", "DE-12345 Musterstadt", "D-12345 Musterstadt", "DE 12345 Musterstadt", and the Dutch "1234 AB Voorbeeldstad". */
const POSTAL = /^(?:([A-Z]{1,2})[- ])?(\d{4} [A-Z]{2}(?= )|\d{4,5})\s+(\p{L}.*)$/u;
/** "Dover, DE 19901", with the country in front ("USA – Dover, DE 19901") or behind ("Dover, DE 19901, USA"). */
const US_PLACE =
  /^(?:(?:USA|United States(?: of America)?)\s[–—-]\s)?([\p{L} .'-]+),\s[A-Z]{2}\s(\d{5}(?:-\d{4})?)(?:,\s(?:USA|United States(?: of America)?))?$/u;
const EU = new Set('AT BE BG CY CZ DE DK EE ES FI FR GR HR HU IE IT LT LU LV MT NL PL PT RO SE SI SK'.split(' '));
/** The letters in front of a postal code: an ISO code, or the older sign of the country. */
const COUNTRY_PREFIX: Record<string, string> = { D: 'DE', A: 'AT', F: 'FR', B: 'BE', L: 'LU', CH: 'CH' };
/** VAT IDs start with the country code, except that Greece writes EL. */
const countryOfVatId = (vatId: string | undefined) => (vatId ? vatId.slice(0, 2).replace('EL', 'GR') : undefined);

/** The country a line names and nothing else, as "ÖSTERREICH" below an address. */
const countryNamed = (line: string | undefined) => Object.entries(COUNTRY_NAMES).find(([, names]) => names.includes(line?.trim().toLowerCase() ?? ''))?.[0];

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
/** The words that title an invoice, also as the end of a longer one ("Teilrechnung"). */
const TITLE_WORD = '\\p{L}*rechnung|rechnungskorrektur|gutschrift|(?:partial|prepayment|advance|corrected)\\s+invoice|invoice|facture|avoir|credit\\s+note';
const TITLE = new RegExp(`(?:^|\\s)(?:${TITLE_WORD})$`, 'iu');
const NAMED = new RegExp(`^(${TITLE_WORD})[ \\t]+([A-Z]{0,3}[-/]?\\d{2,}[\\w/-]*)$`, 'iu');
/** The kinds of invoice a title names. A "Gutschrift" may be a credit note or an invoice the buyer issued, and stays open. */
const TYPES: [RegExp, InvoiceType][] = [
  [/^(?:teilrechnung|partial\s+invoice)$/i, '326'],
  [/^(?:(?:abschlags|anzahlungs|vorauszahlungs)rechnung|(?:prepayment|advance)\s+invoice)$/i, '386'],
  [/^(?:(?:storno|korrektur)rechnung|rechnungskorrektur|corrected\s+invoice)$/i, '384'],
  [/^(?:credit\s+note|avoir)$/i, '381'],
];
const SALUTATION = /^(?:herrn?|frau|mr\.?|mrs\.?|ms\.?|monsieur|madame|mme\.?)$/i;
const LEGAL_FORM = /(?:^|\s)(?:gmbh|mbh|ag|kg|ohg|gbr|e\.\s?[vk]\.|a\.\s?g\.|ltd\.?|inc\.?|llc|plc|sarl|sas|s\.a\.|b\.v\.)(?=\s|$)|&\s*co\b/i;
/** What only the issuer prints about itself: its tax number and its entry in the commercial register. */
const ISSUER_SIGNS = /steuer-?(?:nr|nummer)|\bst\.?-?nr|tax\s+(?:number|no\b)|\bhr[ab]\b|amtsgericht|registergericht|handelsregister|siret/i;
/** What a footer lists beside the issuer's name: its numbers, its VAT ID and its bank account. */
const IDENTIFIERS = new RegExp(`${ISSUER_SIGNS.source}|\\b(?:${VAT_ID_LABEL.source})|\\b(?:iban|bic)\\b`, 'i');

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
    // An address abroad may name its country in a line of its own, below the place.
    const country = countryNamed(lines[i + 1]);
    const tail: string[] = [];
    for (let k = i + (country ? 2 : 1); k < lines.length && tail.length < 4 && (KEY_VALUE.test(lines[k]!) || VAT_ID_LINE.test(lines[k]!)); k++)
      tail.push(lines[k]!);
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
      country: country ?? place.country,
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
  // A name that stands beside a VAT ID, a tax number or a bank account, as in a footer, is the issuer's, even where
  // nothing else makes it the seller.
  const issuer = ({ party }: Found) => rows.some((row) => row.includes(party.name!) && IDENTIFIERS.test(row));
  const left = labelled.length ? labelled : addresses.filter((found) => found.role === undefined && !isSellers(found) && !issuer(found));
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
  /^(?:\d{1,2}(?:[.,]\d+)?\s?%\s*)?(?:(?:netto|brutto|gesamt)(?:betrag|summe)?|zwischensumme|summe|mwst|ust|umsatzsteuer|mehrwertsteuer|rechnungsbetrag|endbetrag|zzgl|total|subtotal|net\s+(?:amount|total)|vat|tax(?:es)?|tva|übertrag)\b/i;
const TOTALS_CELL = /(?:summe|betrag)(?![\p{L}])|\btotal\b/iu;
/** An amount that stands on its own: not part of a date, a longer number or a percentage. */
const PRINTED_AMOUNT = new RegExp(`(?<![\\d.,])${MONEY}(?![.,]?\\d)(?!\\s?%)`, 'g');
// Known limit: the standard and reduced rates of the EU and Switzerland as of 2026; a rate that is not listed reads as no rate.
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
  [/^(pauschal|psch|flat)\.?$/i, 'LS'],
  [/^km\.?$/i, 'KMT'],
  [/^(wochen?|weeks?)\.?$/i, 'WEE'],
  [/^(stk|stück|st|pcs?|pieces?|units?|unit\(s\))\.?$/i, 'C62'],
];
/** The code of a printed unit. A quantity without one counts pieces; a unit not listed here stays open. */
const unitOf = (mark: string) => (mark === '' ? 'C62' : UNITS.find(([pattern]) => pattern.test(mark))?.[1]);
const MONEY_CELL = new RegExp(`^[€$£]?\\s*${MONEY}\\s*${CURRENCY}?$`);
const RATE_CELL = /^\(?(\d{1,2}(?:[.,]\d+)?)\s?%\)?$/;
const QUANTITY_CELL = /^(-?\d+(?:[.,]\d+)?)\s*(\p{L}+\.?)?$/u;
/** A number with what follows it: a percent sign, a currency, or a unit. */
const NUMBER = new RegExp(`(-?\\d[\\d.,']*)\\s*(%|${CURRENCY}|\\p{L}[\\p{L}\\d()²³]*\\.?)?`, 'gu');
const IS_CURRENCY = new RegExp(`^${CURRENCY}$`);
/** How many rows a description may wrap into. */
const MAX_WRAPPED = 4;
/** "Seite 1 von 2", "Page 1 of 2", "1 / 2": where a page ends. Nothing below it belongs to the item above it. */
const PAGE_COUNT = /^(?:(?:seite|page|pagina|página|blatt)\s*)?\d{1,3}\s*(?:von|of|de|sur|di|\/)\s*\d{1,3}$/i;

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
  // A unit in a column of its own belongs to the quantity before it: "8   Std.".
  const before = parts.slice(numbered ? 1 : 0, -1).reduce<string[]>((joined, cell) => {
    const last = joined.at(-1);
    if (last !== undefined && /^-?\d+(?:[.,]\d+)?$/.test(last) && UNITS.some(([pattern]) => pattern.test(cell))) joined[joined.length - 1] = `${last} ${cell}`;
    else joined.push(cell);
    return joined;
  }, []);
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
  if (others.every((figure) => cents(figure.value) === cents(item.total))) return { ...item, quantity: 1, unit: 'C62', unitPrice: item.total };
  const isPrice = (figure: Figure) => IS_CURRENCY.test(figure.mark);
  const hasUnit = (figure: Figure) => figure.mark !== '' && !isPrice(figure);
  for (const [i, a] of others.entries()) {
    for (const b of others.slice(i + 1)) {
      if (Math.round(a.value * b.value * 100) !== cents(item.total)) continue;
      // Known limit: where neither a currency nor a unit nor a whole number tells, the quantity is taken to come first.
      const swap = isPrice(a) || hasUnit(b) || (!hasUnit(a) && !isPrice(b) && !Number.isInteger(a.value) && Number.isInteger(b.value));
      const [quantity, price] = swap ? [b, a] : [a, b];
      return { ...item, quantity: quantity.value, unit: unitOf(quantity.mark), unitPrice: price.value };
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

/** "80,00 € 960,00 €": price and total set so close that they share a cell. Each amount is a cell of its own. */
function splitAmounts(cell: string): string[] {
  const parts: string[] = [];
  for (const word of cell.split(' ')) {
    if (parts.length && MONEY_CELL.test(`${parts.at(-1)} ${word}`)) parts[parts.length - 1] += ` ${word}`;
    else parts.push(word);
  }
  return parts.length > 1 && parts.every((part) => MONEY_CELL.test(part)) ? parts : [cell];
}

/** Joins the lines a text wraps into: with a space, or without one where a hyphen holds two of them together ("Wartungs-", "Vertrag"). */
const unwrap = (lines: string[]) =>
  lines.slice(1).reduce((text, line) => (/[\p{L}\d]-$/u.test(text) || /^-\p{L}/u.test(line) ? text + line : `${text} ${line}`), lines[0] ?? '');

/**
 * The line items: rows with a name and an amount that add up to the printed total, wherever they stand. A
 * description may wrap into the rows around it. Rows that add up to the gross total carry prices with VAT; their net
 * prices are derived from the rate. Rows that do not add up are not believed: nothing is returned and a person fills
 * the lines in.
 *
 * A table may go on over pages. Then the sum so far is often printed at the end of a page and carried over to the
 * next, and the head of the table stands there once more. Such rows end a table on a single page, so they are read
 * as part of one table only where the rows do not add up otherwise.
 */
function readItems(rows: string[], totals: Totals, blocks: string[][] | undefined): Partial<Line>[] | undefined {
  // Without VAT the rows add up to the total itself.
  const net = totals.net ?? (totals.vat === undefined ? totals.gross : undefined);
  // Read as one page first, and only where nothing adds up that way as a table that goes on over pages.
  const found = itemsThatAddUp(rows, totals, net, blocks, false) ?? itemsThatAddUp(rows, totals, net, blocks, true);
  if (!found) return undefined;
  const { run, inclusive } = found;

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
    unit: line.unit,
    unitPrice: line.unitPrice,
    vatCategory: 'S' as VatCategory,
    vatRate: rated ? line.vatRate : undefined,
  }));
}

/**
 * The rows of the table that add up to the net total, or to the gross total where prices include VAT (`inclusive`).
 * With `overPages`, a sum of the items so far and a table head that was printed before do not end the table.
 */
function itemsThatAddUp(
  rows: string[],
  totals: Totals,
  net: number | undefined,
  blocks: string[][] | undefined,
  overPages: boolean,
): { run: Item[]; inclusive: boolean } | undefined {
  const items: Item[] = [];
  /** Rows of text between items: the end of the description above, or the start of the one below. */
  let loose: string[] = [];
  let table = 0;
  /** The last item, while it may still take the rows that follow it. */
  let open: Item | undefined;
  const heads = new Set<string>();
  const closeLoose = () => {
    if (open && loose.length <= MAX_WRAPPED) open.name = unwrap([open.name, ...loose].filter((part): part is string => Boolean(part)));
    loose = [];
  };
  for (const row of rows) {
    const all = cells(row).flatMap(splitAmounts);
    // A row may end with a cell of the column beside the table.
    const parts = all.slice(0, lastIndex(all, (cell) => MONEY_CELL.test(cell)) + 1);
    if (TOTALS_ROW.test(row) || all.some((cell) => TOTALS_CELL.test(cell))) {
      closeLoose();
      open = undefined;
      // The sum of the items so far, printed at a page break: a subtotal below them, a carry-over above the next ones.
      const amount = MONEY_CELL.exec(all.at(-1)!)?.[1];
      const soFar = items.filter((item) => item.table === table).reduce((sum, item) => sum + cents(item.total), 0);
      const carried = overPages && amount !== undefined && soFar !== 0 && cents(toNumber(amount)) === soFar;
      if (!carried) table++;
    } else if (parts.length >= 2) {
      const item = itemOf(parts, table);
      // A row with only number and amount takes its description from the text above it; other text above belongs to the previous item.
      if (item.name === undefined && parts.length === 2) item.name = unwrap(loose.splice(0).slice(-MAX_WRAPPED));
      closeLoose();
      items.push(item);
      open = item;
    } else {
      items.at(-1)?.below.push(...all);
      if (PAGE_COUNT.test(row)) {
        closeLoose();
        open = undefined;
      } else if (all.length === 1 && !/:/.test(row)) loose.push(all[0]!);
      else {
        // Another row ends the description above it, and a row of headings starts another table.
        loose = [];
        open = undefined;
        if (all.length >= 3 && !/\d/.test(row)) {
          if (!(overPages && heads.has(row))) table++;
          heads.add(row);
        }
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
    // Where the block of the name is known, it says what the name is: text below it in another column is none of it.
    if (place) item.name = unwrap([item.cell, ...more]);
  }

  const run = runOf(items, net);
  if (run) return { run, inclusive: false };
  const withVat = totals.net !== undefined ? runOf(items, totals.gross) : undefined;
  return withVat && { run: withVat, inclusive: true };
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
const MONTH_RANGE = new RegExp(`${SEPARATOR}${MONTH}\\s+(\\d{4})\\s*(?:-|–|bis|to|until)\\s*${MONTH}\\s+(\\d{4})`, 'i');
const MONTH_ROW = new RegExp(`^${MONTH}\\s+(\\d{4})$`, 'i');
/** The label of payment terms: what follows it is the terms, whatever words they use. */
const TERMS_LABEL =
  /^(?:zahlungs(?:bedingung(?:en)?|ziel|frist|konditionen)|payment\s+terms?|terms\s+of\s+payment|conditions\s+de\s+(?:paiement|règlement))\s*:?\s*/i;
/** How a sentence starts that says when to pay. "Zahlbetrag" and "Zahlungsart" say something else. */
const TERMS_START =
  /^(?:zahlbar\b|zahlung\s+(?:innerhalb|bis|sofort|ohne|erfolgt|fällig)|bitte\s+(?:überweisen|zahlen|begleichen)|der\s+(?:rechnungs|gesamt)betrag\s+ist|sofort\s+(?:fällig|zahlbar)|payable\b|payment\s+(?:is\s+)?(?:due|within|upon)|please\s+(?:pay|remit|transfer)|net\s+\d+|due\s+(?:on|upon)\s+receipt|paiement\s+(?:à|sous|dans|comptant))/i;

/**
 * The payment terms as printed: what stands after their label, or the sentence that says when to pay, joined over
 * the rows it wraps into. They are taken over word for word; when the due date is, is read separately.
 */
function readPaymentTerms(rows: string[]): string | undefined {
  for (const [i, row] of rows.entries()) {
    const all = cells(row);
    for (const [k, cell] of all.entries()) {
      // "Payment terms   Net 30": the label in one cell, the terms in the next.
      const labelled = TERMS_LABEL.test(cell) ? cell.replace(TERMS_LABEL, '') || all[k + 1] : undefined;
      if (labelled) return labelled;
      if (!TERMS_START.test(cell)) continue;
      const terms = [cell];
      // Alone in its row, the sentence goes on into the next one while it has not ended: where that row starts in
      // lower case, or where this one stops in the middle ("… netto bis 04.12.2026, 3%").
      for (let j = i + 1; all.length === 1 && j < rows.length && terms.length <= MAX_WRAPPED; j++) {
        const [last, next] = [terms.at(-1)!, rows[j]!];
        if (/[.!?]$/.test(last) || cells(next).length > 1 || KEY_VALUE.test(next) || next.endsWith(':')) break;
        if (!/^\p{Ll}/u.test(next) && !/[,;%]$/.test(last)) break;
        terms.push(next);
      }
      return terms.join(' ');
    }
  }
  return undefined;
}

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
  // "September 2026 bis Januar 2027": from the first day of the one month to the last day of the other.
  for (const { hit: m } of after(text, PERIOD_LABEL, MONTH_RANGE)) {
    const [from, to] = [months(m[2]!, monthNumber(m[1]!), monthNumber(m[1]!)), months(m[4]!, monthNumber(m[3]!), monthNumber(m[3]!))];
    if (from && to && from.periodStart < to.periodEnd) return { periodStart: from.periodStart, periodEnd: to.periodEnd };
  }
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
    number: labelled?.hit[1]!.replace(/ /g, '') ?? titles.flatMap((parts) => parts.map((cell) => NAMED.exec(cell)?.[2])).find(Boolean),
    dated: date(dated),
    beside: titles.flatMap((parts) => parts.map((cell) => date(DATE.exec(cell)))).find(Boolean),
  };
}

/** The kind of invoice the title names: the first cell that is a title, alone or with the number. */
function readType(rows: string[]): InvoiceType | undefined {
  const title = rows
    .flatMap(cells)
    .map((cell) => (TITLE.exec(cell)?.index === 0 ? cell : NAMED.exec(cell)?.[1]))
    .find(Boolean);
  return title ? TYPES.find(([pattern]) => pattern.test(title))?.[1] : undefined;
}

// ---------------------------------------------------------------------------------------------------------------
// Contact data and the reference of the buyer. A contact is read for a party only where a heading, a label or the
// party's recognised address identifies it. A single contact with no such indication may belong to somebody else.

const EMAIL = /[\p{L}\d._%+-]+@[\p{L}\d-]+(?:\.[\p{L}\d-]+)+/gu;
/** "E-Mail:" right before an address, and what its cell says before that. */
const EMAIL_LABEL = /^(.*?)(?:e-?mail(?:[- ]?(?:adresse|address))?|courriel)\s*:?\s*$/i;
/** A customer can also be named after the kind of address: "E-Mail des Kunden". */
const CUSTOMER_EMAIL_SUFFIX =
  /(?:e-?mail(?:[- ]?(?:adresse|address))?|courriel)\s+(?:(?:des|der|du|de|of(?:\s+the)?)\s+)?(?:kunden?|käufers?|buyers?|customers?|clients?)\s*:?\s*$/i;
/** "Tel.", "Telefon-Nr.", "Phone", "Mobil"; not a fax, which "Telefax" and "Tel./Fax" name. */
const PHONE_LABEL = /(?<![a-zäöü])(?:tele(?:fon|phone)|tel|phone|fon|mobil(?:e|telefon)?|handy)(?:\.?[-\s]?(?:nr|nummer|number|no))?(?![a-zäöü])\.?/;
/** Digits in groups, one space apart at most: three spaces start the next column. */
const PHONE = new RegExp(`${SEPARATOR}(\\+{0,2}[\\d(](?:[\\d()/.-]| (?=[\\d(/-]))*\\d)`);
const CONTACT_LABEL = /(?:ihre?\s+)?ansprechpartner(?:in)?|(?:sach)?bearbeiter(?:in)?|kontaktperson|contact\s+person|your\s+contact/;
/** A name of two to four words that start with a capital, with its titles. One word may be anything. */
const PERSON = new RegExp(
  `${SEPARATOR}((?:(?:Herrn?|Frau|Mrs?\\.?|Ms\\.?|Dr\\.?|Prof\\.?)\\s)*\\p{Lu}[\\p{L}.'’-]*(?:\\s\\p{Lu}[\\p{L}.'’-]*){1,3})(?=\\s{2}|\\s*$|,)`,
  'u',
);
/** The heading of an address that is neither party's, such as "Lieferadresse:" or "Ship to". */
const OTHER_ADDRESS = /^(?!.*(?:mail|web|internet|bank)).*(?:adresse|address|anschrift|empfänger|(?:ship(?:ped)?|deliver(?:ed)?)\s+to)\s*:?$/i;

/** A value where it stands on the page, with whose it is as far as that place tells. */
interface Mention {
  value: string;
  /** The same for two ways of writing one value. */
  key: string;
  /** `unclear`: a heading stands in a row beside something else, so the row does not tell which column the value is in. */
  role?: Role | 'unclear' | 'seller-address' | 'buyer-address';
}

/**
 * Whose a line is: what the nearest heading above it says, the name of a party ("Verkäufer", "Bill to") or of another
 * address. A date, an amount or a title in between ends the search, since what follows it belongs to the invoice.
 */
function headedBy(lines: string[], i: number): Mention['role'] {
  for (let j = i - 1; j >= 0 && j >= i - 10; j--) {
    const line = lines[j]!;
    if (!line || DATE_OR_AMOUNT.test(line) || TITLE.test(line)) return undefined;
    const roles = cells(line).map((cell) => (BUYER_HEADING.test(cell) ? 'buyer' : SELLER_HEADING.test(cell) ? 'seller' : undefined));
    if (roles.some(Boolean)) return roles.length === 1 ? roles[0] : 'unclear';
    if (roles.length === 1 && OTHER_ADDRESS.test(line)) return 'other';
  }
  return undefined;
}

/**
 * The one value `who` has. Two values that nothing tells apart stay unread, as does a value with no known party.
 * With `columns` the blocks of the page were searched too, and they tell what a row of two columns leaves open.
 */
function theOne(mentions: Mention[], who: 'seller' | 'buyer', columns: boolean): string | undefined {
  const values = new Map<string, { value: string; roles: Set<string> }>();
  for (const { value, key, role } of mentions) {
    const entry = values.get(key) ?? { value, roles: new Set() };
    if (role && !(role === 'unclear' && columns)) entry.roles.add(role);
    values.set(key, entry);
  }
  const entries = [...values.values()];
  const address = `${who}-address`;
  const own = entries.filter(({ roles }) => roles.has(who) && [...roles].every((role) => role === who || role === address));
  if (own.length) return own.length === 1 ? own[0]!.value : undefined;
  // A value merely near an address is weaker evidence than a heading. If the page prints another value of the
  // same kind, neither is chosen on that basis alone.
  return entries.length === 1 && entries[0]!.roles.size === 1 && entries[0]!.roles.has(address) ? entries[0]!.value : undefined;
}

/** E-mail address, phone number and contact of the seller, and the e-mail address of the buyer. */
function readContact(searched: string, columns: boolean, parties: { seller?: Found; buyer?: Found }): { seller: Partial<Party>; buyer: Partial<Party> } {
  const lines = searched.split('\n');
  /** What the cell of the value says before it. */
  const before = (at: number) =>
    searched
      .slice(searched.lastIndexOf('\n', at - 1) + 1, at)
      .split(/\s{3,}/)
      .at(-1)!;
  /** A recognised party's name, alone or in its sender line, identifies the address around it. */
  const partyIn = (cell: string): 'seller' | 'buyer' | 'unclear' | undefined => {
    const name = (senderOf(cell)?.name ?? cell).trim().toLowerCase();
    const matches = (['seller', 'buyer'] as const).filter((who) => parties[who]?.party.name?.toLowerCase() === name);
    return matches.length === 1 ? matches[0] : matches.length > 1 ? 'unclear' : undefined;
  };
  const role = (at: number, customers: boolean): Mention['role'] => {
    if (customers) return 'buyer';
    const sameCell = partyIn(before(at));
    if (sameCell) return sameCell === 'unclear' ? sameCell : `${sameCell}-address`;
    const i = searched.slice(0, at).split('\n').length - 1;
    const underHeading = headedBy(lines, i);
    if (underHeading) return underHeading;
    for (let j = i - 1; j >= 0 && j >= i - 10; j--) {
      const line = lines[j]!;
      if (!line || DATE_OR_AMOUNT.test(line) || TITLE.test(line) || roleOf(line)) break;
      const parts = cells(line);
      const matches = parts.map(partyIn).filter((found) => found !== undefined);
      if (matches.length) return parts.length === 1 && matches.length === 1 && matches[0] !== 'unclear' ? `${matches[0]!}-address` : 'unclear';
    }
    return undefined;
  };

  const emails = [...searched.matchAll(EMAIL)].map((match): Mention => {
    const prefix = before(match.index);
    const label = EMAIL_LABEL.exec(prefix);
    return {
      value: match[0],
      key: match[0].toLowerCase(),
      role: role(match.index, (label !== null && CUSTOMER.test(label[1]!)) || CUSTOMER_EMAIL_SUFFIX.test(prefix)),
    };
  });
  const labelled = (label: RegExp, value: RegExp, key: (found: string) => string) =>
    after(searched, label, value).map(({ hit, at }): Mention => ({ value: hit[1]!, key: key(hit[1]!), role: role(at, CUSTOMER.test(before(at))) }));
  const digits = (found: string) => found.replace(/\D/g, '');
  // A phone number has six digits at least and fifteen with its country code, or one more where the zero of the area
  // code is printed as well: "+49 (0) 30 …".
  const phones = labelled(PHONE_LABEL, PHONE, digits).filter(({ key }) => key.length >= 6 && key.length <= 16);
  const contacts = labelled(CONTACT_LABEL, PERSON, (found) => found.toLowerCase());

  return {
    seller: { contactName: theOne(contacts, 'seller', columns), phone: theOne(phones, 'seller', columns), email: theOne(emails, 'seller', columns) },
    buyer: { email: theOne(emails, 'buyer', columns) },
  };
}

const LEITWEG_LABEL = /leitweg\w*[-\s]?(?:id|nr\.?|nummer)/;
/** Coarse address, fine address and check digits, as a Leitweg-ID is built. */
const LEITWEG = new RegExp(`${SEPARATOR}(\\d{2,12}(?:-[A-Za-z0-9]{1,30})?-\\d{2})(?![\\w-])`);
/** What EN 16931 calls the field (BT-10). "Ihr Zeichen" or "Your reference" may be anything, often the number of an order. */
const REFERENCE_LABEL = /referenz\s+des\s+käufers|käuferreferenz(?:-?\s?(?:nr\.?|nummer))?|buyer(?:['’]?s)?\s+reference/;
/** What stands in the cell after a label: three spaces start the next column. */
const REST_OF_CELL = new RegExp(`${SEPARATOR}(\\S+(?: {1,2}\\S+)*)`);

/** The reference of the buyer after its label, as it is printed: a Leitweg-ID by its shape, another reference as it stands. */
function readBuyerReference(searched: string): string | undefined {
  const found = [
    ...after(searched, LEITWEG_LABEL, LEITWEG),
    // A value that ends with a colon is the next label, in a column of labels.
    ...after(searched, REFERENCE_LABEL, REST_OF_CELL).filter(({ hit }) => !hit[1]!.endsWith(':')),
  ].map(({ hit }) => hit[1]!);
  return new Set(found.map((value) => value.replace(/\s/g, ''))).size === 1 ? found[0] : undefined;
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
  const contact = readContact(searched, options.blocks !== undefined, found);
  return prune({
    number,
    typeCode: readType(rows),
    buyerReference: readBuyerReference(searched),
    issueDate:
      date(/rechnungs-?datum|belegdatum|invoice\s+date|date\s+of\s+issue|issue\s+date|date\s+de\s+(?:la\s+)?facture|date\s+d['’]émission/) ??
      dated ??
      date(/(?<![a-zäöü-])datum|(?<![a-z] ?)date/) ??
      beside,
    deliveryDate: date(/leistungsdatum|lieferdatum|date\s+of\s+(?:supply|delivery)|delivery\s+date|service\s+date/),
    ...readPeriod(searched, rows),
    dueDate: date(/fällig(?:keit(?:s(?:datum|tag|termin))?|\s+am|\s+bis)?|zahlbar\s+bis|due(?:\s+date|\s+by|\s+on)?|payable\s+by|date\s+d['’]échéance/),
    paymentTerms: readPaymentTerms(rows),
    currency: findCurrency(text),
    iban,
    // A BIC belongs to an IBAN; with another kind of account it has no place in the invoice data.
    bic: iban ? first(/\b(?:bic|swift)(?:[-/ ]?code)?/, new RegExp(`${SEPARATOR}([A-Z]{6}[A-Z0-9]{2}(?:[A-Z0-9]{3})?)\\b`)) : undefined,
    vatExemptionReason,
    seller: {
      ...seller,
      taxNumber: first(/steuernummer|steuer-?nr\.?|st\.?-?nr\.?|tax\s+(?:number|no\.?)/, new RegExp(`${SEPARATOR}(\\d{2,3}/\\d{3,4}/\\d{4,5}|\\d{10,13})`)),
      ...contact.seller,
      // A contact named by its label counts before the person an address names in its second line.
      contactName: contact.seller.contactName ?? seller.contactName,
    },
    buyer: { ...buyer, ...contact.buyer },
    lines,
    totals,
  });
}
