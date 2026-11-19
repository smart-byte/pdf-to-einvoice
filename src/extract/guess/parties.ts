import type { Party } from '../../domain/model.js';
import { TITLE } from './head.js';
import { cells, KEY_VALUE } from './rows.js';
import { anyOf, COUNTRY_NAMES, lastIndex, VAT_ID_LABEL, VAT_ID_LINE } from './values.js';

// Parties. The blocks of a page are its columns; without blocks, the first cells of the rows stand in for the one
// column that matters most.

/** "Name · Street 1 · 12345 City", also written with dashes, bars or dots. */
const SENDER_SEPARATOR = /\s[·|•●–—-]\s/;
/** "12345 Musterstadt", "DE-12345 Musterstadt", "D-12345 Musterstadt", "DE 12345 Musterstadt", and the Dutch "1234 AB Voorbeeldstad". */
const POSTAL = /^(?:([A-Z]{1,2})[- ])?(\d{4} [A-Z]{2}(?= )|\d{4,5})\s+(\p{L}.*)$/u;
/** "Dover, DE 19901", with the country in front ("USA – Dover, DE 19901") or behind ("Dover, DE 19901, USA"). */
const USA = '(?:USA|United States(?: of America)?)';
const US_PLACE = new RegExp(
  `^(?:${USA}\\s[–—-]\\s)?([\\p{L} .'-]+),\\s[A-Z]{2}\\s(\\d{5}(?:-\\d{4})?)(?:,\\s${USA})?$`,
  'u',
);
export const EU = new Set(
  'AT BE BG CY CZ DE DK EE ES FI FR GR HR HU IE IT LT LU LV MT NL PL PT RO SE SI SK'.split(' '),
);
/** The letters in front of a postal code: an ISO code, or the older sign of the country. */
const COUNTRY_PREFIX: Record<string, string> = { D: 'DE', A: 'AT', F: 'FR', B: 'BE', L: 'LU', CH: 'CH' };
/** VAT IDs start with the country code, except that Greece writes EL. */
export const countryOfVatId = (vatId: string | undefined) =>
  vatId ? vatId.slice(0, 2).replace('EL', 'GR') : undefined;

/** The country a line names and nothing else, as "ÖSTERREICH" below an address. */
const countryNamed = (line: string | undefined) =>
  Object.entries(COUNTRY_NAMES).find(([, names]) => names.includes(line?.trim().toLowerCase() ?? ''))?.[0];

/** Postal code, city and country, from the last line of an address. */
function placeOf(line: string): Partial<Party> | undefined {
  const postal = POSTAL.exec(line);
  if (postal)
    return {
      postalCode: postal[2],
      city: postal[3],
      country: COUNTRY_PREFIX[postal[1] ?? ''] ?? (EU.has(postal[1] ?? '') ? postal[1] : undefined),
    };
  const american = US_PLACE.exec(line);
  return american ? { postalCode: american[2], city: american[1]!.trim(), country: 'US' } : undefined;
}

/** The party named by a line like "Name · Street 1 · 12345 City", as letterheads and footers have it. */
export function senderOf(cell: string): Partial<Party> | undefined {
  if (!SENDER_SEPARATOR.test(cell)) return undefined;
  const segments = cell.split(new RegExp(`${SENDER_SEPARATOR.source}|,\\s`)).map((segment) => segment.trim());
  // A street may look like a place ("1500 chemin des vignes"); the place comes last.
  const i = lastIndex(segments, (segment) => POSTAL.test(segment));
  return i >= 1
    ? { name: segments[0], street: i >= 2 ? segments[i - 1] : undefined, ...placeOf(segments[i]!) }
    : undefined;
}

export type Role = 'seller' | 'buyer' | 'other';
const BUYER = [
  'bill(?:ed)?\\s+to',
  'invoice\\s+to',
  'sold\\s+to',
  'rechnung\\s+an',
  'rechnungsempfänger',
  'rechnungsadresse',
  'rechnungsanschrift',
  'kunde',
  'customer',
  'client',
  'buyer',
  'käufer',
  'leistungsempfänger',
  'empfänger',
  'destinataire',
  'acheteur',
  'adresse\\s+de\\s+facturation',
  'billing\\s+address',
].join('|');
const SELLER = [
  'verkäufer',
  'lieferant',
  'leistungserbringer',
  'rechnungssteller',
  'absender',
  'seller',
  'supplier',
  'vendor',
  'vendeur',
  'fournisseur',
  'from',
].join('|');
/** A label on a line of its own, such as "Käufer:", "Käufer/Leistungsempfänger:" or "BILL TO". */
const heading = (labels: string) => new RegExp(`^(?:${labels})(?:\\s*[/&]\\s*[\\p{L}-]+)*\\s*:?$`, 'iu');
export const [BUYER_HEADING, SELLER_HEADING] = [heading(BUYER), heading(SELLER)];
const BUYER_START = new RegExp(`^(?:${BUYER})\\b`, 'i');
/** Other headings of an address: a label without a value, or one that says so ("Adresse de livraison", "Warenempfänger"). */
const OTHER_HEADING = /:$|adresse|address|anschrift|empfänger/i;
/** A date or an amount of money: no line of an address holds one. */
export const DATE_OR_AMOUNT = /\d{1,2}[./]\d{1,2}[./]\d{2,4}|\d{4}-\d{2}-\d{2}|\d[.,]\d{2}(?!\d)/;
const SALUTATION = /^(?:herrn?|frau|mr\.?|mrs\.?|ms\.?|monsieur|madame|mme\.?)$/i;
const LEGAL_FORMS = anyOf(
  /gmbh|mbh|ag|kg|ohg|gbr|e\.\s?[vk]\.|a\.\s?g\./, // German
  /ltd\.?|inc\.?|llc|plc/, // English
  /sarl|sas|s\.a\.|b\.v\./, // French, Dutch
);
const LEGAL_FORM = new RegExp(`(?:^|\\s)(?:${LEGAL_FORMS})(?=\\s|$)|&\\s*co\\b`, 'i');
/** What only the issuer prints about itself: its tax number and its entry in the commercial register. */
const ISSUER_SIGNS = new RegExp(
  anyOf(
    // The tax number
    /steuer-?(?:nr|nummer)/,
    /\bst\.?-?nr/,
    /tax\s+(?:number|no\b)/,
    // The entry in the commercial register
    /\bhr[ab]\b/,
    /amtsgericht/,
    /registergericht/,
    /handelsregister/,
    /siret/,
  ),
  'i',
);
/** What only the issuer prints beside its VAT ID: its numbers and its bank account. */
export const ISSUER_OR_BANK = new RegExp(`${ISSUER_SIGNS.source}|\\b(?:iban|bic)\\b`, 'i');
/** What a footer lists beside the issuer's name: its numbers, its VAT ID and its bank account. */
const IDENTIFIERS = new RegExp(`${ISSUER_OR_BANK.source}|\\b(?:${VAT_ID_LABEL.source})`, 'i');

/** Whose address a heading announces: the buyer's, the seller's, or another one, such as a delivery address. */
export function roleOf(line: string): Role | undefined {
  if (BUYER_HEADING.test(line)) return 'buyer';
  if (SELLER_HEADING.test(line)) return 'seller';
  return OTHER_HEADING.test(line) ? 'other' : undefined;
}

/** An address as found on the page, with what tells whose it is. */
export interface Found {
  party: Partial<Party>;
  /** What the heading above it says. */
  role?: Role;
  /** Read from a sender line. */
  sender?: boolean;
  /** The labelled lines right below it, which may hold its VAT ID or tax number. */
  tail: string;
  /** The page spells it twice with its words broken apart differently: its words are not believed. */
  broken?: boolean;
}

/** The words of an address. */
const WORDS = ['name', 'contactName', 'street', 'city'] as const;

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
    for (
      let k = i + (country ? 2 : 1);
      k < lines.length && tail.length < 4 && (KEY_VALUE.test(lines[k]!) || VAT_ID_LINE.test(lines[k]!));
      k++
    )
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
export function readParties(rows: string[], blocks: string[][]): { seller?: Found; buyer?: Found } {
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
    best &&
    best.signs >= 2 &&
    ranked.every((other) => other.signs < best.signs || other.found.party.name === best.found.party.name)
      ? best.found
      : undefined;

  const isSellers = ({ party }: Found) =>
    seller !== undefined &&
    ([party.name, party.contactName, party.street].includes(seller.party.name) ||
      (party.street !== undefined &&
        party.street === seller.party.street &&
        party.postalCode === seller.party.postalCode));
  const labelled = addresses.filter((found) => found.role === 'buyer');
  // A name that stands beside a VAT ID, a tax number or a bank account, as in a footer, is the issuer's, even where
  // nothing else makes it the seller.
  const issuer = ({ party }: Found) => rows.some((row) => row.includes(party.name!) && IDENTIFIERS.test(row));
  const left = labelled.length
    ? labelled
    : addresses.filter((found) => found.role === undefined && !isSellers(found) && !issuer(found));
  const buyer = new Set(left.map((found) => found.party.name)).size === 1 ? left[0] : undefined;

  // An address may stand twice on a page, say in the letterhead and in the footer. Copies that differ in their spaces
  // only show that the text breaks words apart where the print does not, as some PDFs space their letters.
  const squeezed = (value?: string) => value?.replace(/\s+/g, '');
  const checked = (found?: Found) =>
    found &&
    (found.party.postalCode !== undefined &&
    [...senders, ...addresses].some(
      ({ party }) =>
        party.postalCode === found.party.postalCode &&
        WORDS.some(
          (key) =>
            party[key] !== undefined &&
            party[key] !== found.party[key] &&
            squeezed(party[key]) === squeezed(found.party[key]),
        ),
    )
      ? { ...found, broken: true }
      : found);
  return { seller: checked(seller), buyer: checked(buyer) };
}

/** What an address says, without its words where the page breaks them apart. */
export const believed = (found?: Found): Partial<Party> =>
  found?.broken
    ? Object.fromEntries(Object.entries(found.party).filter(([key]) => !(WORDS as readonly string[]).includes(key)))
    : { ...found?.party };
