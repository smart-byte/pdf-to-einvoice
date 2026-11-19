import type { Party } from '../../domain/model.js';
import { TITLE } from './head.js';
import { DATE_OR_AMOUNT, type Found, type Role, roleOf, senderOf } from './parties.js';
import { cells } from './rows.js';
import { after, CUSTOMER, SEPARATOR } from './values.js';

// Contact data. A contact is read for a party only where a heading, a label or the party's recognised address
// identifies it. A single contact with no such indication may belong to somebody else.

/** The text searched for contact data, by line as well, and the parties recognised in it. */
interface Searched {
  text: string;
  lines: string[];
  parties: { seller?: Found; buyer?: Found };
}

/** A value where it stands on the page, with whose it is as far as that place tells. */
interface Mention {
  value: string;
  /** The same for two ways of writing one value. */
  key: string;
  /** `unclear`: a heading stands in a row beside something else, so the row does not tell which column the value is in. */
  role?: Role | 'unclear' | 'seller-address' | 'buyer-address';
}

/** E-mail address, phone number and contact of the seller, and the e-mail address of the buyer. */
export function readContact(
  searched: string,
  columns: boolean,
  parties: Searched['parties'],
): { seller: Partial<Party>; buyer: Partial<Party> } {
  const page: Searched = { text: searched, lines: searched.split('\n'), parties };
  const contacts = labelled(page, CONTACT_LABEL, PERSON, (found) => found.toLowerCase());
  // A phone number has six digits at least and fifteen with its country code, or one more where the zero of the area
  // code is printed as well: "+49 (0) 30 …".
  const phones = labelled(page, PHONE_LABEL, PHONE, (found) => found.replace(/\D/g, '')).filter(
    ({ key }) => key.length >= 6 && key.length <= 16,
  );
  const emails = emailsOn(page);
  return {
    seller: {
      contactName: theOne(contacts, 'seller', columns),
      phone: theOne(phones, 'seller', columns),
      email: theOne(emails, 'seller', columns),
    },
    buyer: { email: theOne(emails, 'buyer', columns) },
  };
}

/** Every e-mail address on the page; one labelled as the customer's is the buyer's. */
function emailsOn(page: Searched): Mention[] {
  return [...page.text.matchAll(EMAIL)].map((match): Mention => {
    const prefix = before(page.text, match.index);
    const label = EMAIL_LABEL.exec(prefix);
    const customers = (label !== null && CUSTOMER.test(label[1]!)) || CUSTOMER_EMAIL_SUFFIX.test(prefix);
    return { value: match[0], key: match[0].toLowerCase(), role: roleAt(page, match.index, customers) };
  });
}

/** Every value that matches `value` after a `label`; one in a cell that names the customer is the buyer's. */
function labelled(page: Searched, label: RegExp, value: RegExp, key: (found: string) => string): Mention[] {
  return after(page.text, label, value).map(({ hit, at }): Mention => ({
    value: hit[1]!,
    key: key(hit[1]!),
    role: roleAt(page, at, CUSTOMER.test(before(page.text, at))),
  }));
}

/** What the cell of the value at `at` says before it. */
function before(text: string, at: number): string {
  return text
    .slice(text.lastIndexOf('\n', at - 1) + 1, at)
    .split(/\s{3,}/)
    .at(-1)!;
}

/**
 * Whose the value at `at` is: the buyer's where it is labelled as the customer's; else what the party's name in its
 * own cell, the heading above it or the party's address right above it tells.
 */
function roleAt(page: Searched, at: number, customers: boolean): Mention['role'] {
  if (customers) return 'buyer';
  const sameCell = partyIn(page, before(page.text, at));
  if (sameCell) return sameCell === 'unclear' ? sameCell : `${sameCell}-address`;
  const i = page.text.slice(0, at).split('\n').length - 1;
  return headedBy(page.lines, i) ?? addressAbove(page, i);
}

/**
 * Whose a line is: what the nearest heading above it says, the name of a party ("Verkäufer", "Bill to") or of another
 * address. A date, an amount or a title in between ends the search, since what follows it belongs to the invoice.
 */
function headedBy(lines: string[], i: number): Mention['role'] {
  for (let j = i - 1; j >= 0 && j >= i - 10; j--) {
    const line = lines[j]!;
    if (!line || DATE_OR_AMOUNT.test(line) || TITLE.test(line)) return undefined;
    // Another address, such as one for delivery, heads no contact of either party.
    const roles = cells(line).map((cell) => (roleOf(cell) === 'other' ? undefined : roleOf(cell)));
    if (roles.some(Boolean)) return roles.length === 1 ? roles[0] : 'unclear';
    if (roles.length === 1 && OTHER_ADDRESS.test(line)) return 'other';
  }
  return undefined;
}

/** The party whose address stands in the lines right above line `i`, up to a heading, a date, an amount or a title. */
function addressAbove(page: Searched, i: number): Mention['role'] {
  for (let j = i - 1; j >= 0 && j >= i - 10; j--) {
    const line = page.lines[j]!;
    if (!line || DATE_OR_AMOUNT.test(line) || TITLE.test(line) || roleOf(line)) break;
    const parts = cells(line);
    const matches = parts.map((cell) => partyIn(page, cell)).filter((found) => found !== undefined);
    if (matches.length)
      return parts.length === 1 && matches.length === 1 && matches[0] !== 'unclear'
        ? `${matches[0]!}-address`
        : 'unclear';
  }
  return undefined;
}

/** A recognised party's name, alone or in its sender line, identifies the address around it. */
function partyIn({ parties }: Searched, cell: string): 'seller' | 'buyer' | 'unclear' | undefined {
  const name = (senderOf(cell)?.name ?? cell).trim().toLowerCase();
  const matches = (['seller', 'buyer'] as const).filter((who) => parties[who]?.party.name?.toLowerCase() === name);
  if (matches.length > 1) return 'unclear';
  return matches[0];
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
  const own = entries.filter(
    ({ roles }) => roles.has(who) && [...roles].every((role) => role === who || role === address),
  );
  if (own.length) return own.length === 1 ? own[0]!.value : undefined;
  // A value merely near an address is weaker evidence than a heading. If the page prints another value of the
  // same kind, neither is chosen on that basis alone.
  return entries.length === 1 && entries[0]!.roles.size === 1 && entries[0]!.roles.has(address)
    ? entries[0]!.value
    : undefined;
}

// What the page is searched for. The functions above use these patterns only when a page is read, so they may stand
// below them.

const EMAIL = /[\p{L}\d._%+-]+@[\p{L}\d-]+(?:\.[\p{L}\d-]+)+/gu;
/** "E-Mail", "E-Mail-Adresse", "courriel". */
const EMAIL_WORD = '(?:e-?mail(?:[- ]?(?:adresse|address))?|courriel)';
/** "E-Mail:" right before an address, and what its cell says before that. */
const EMAIL_LABEL = new RegExp(`^(.*?)${EMAIL_WORD}\\s*:?\\s*$`, 'i');
/** A customer can also be named after the kind of address: "E-Mail des Kunden". */
const OF_THE = '(?:(?:des|der|du|de|of(?:\\s+the)?)\\s+)?';
const CUSTOMER_WORD = '(?:kunden?|käufers?|buyers?|customers?|clients?)';
const CUSTOMER_EMAIL_SUFFIX = new RegExp(`${EMAIL_WORD}\\s+${OF_THE}${CUSTOMER_WORD}\\s*:?\\s*$`, 'i');

/** "Tel.", "Telefon-Nr.", "Phone", "Mobil"; not a fax, which "Telefax" and "Tel./Fax" name. */
const PHONE_WORD = '(?:tele(?:fon|phone)|tel|phone|fon|mobil(?:e|telefon)?|handy)';
/** "-Nr.", "Nummer", "number", "No" after the word. */
const NUMBER_WORD = '(?:\\.?[-\\s]?(?:nr|nummer|number|no))?';
const PHONE_LABEL = new RegExp(`(?<![a-zäöü])${PHONE_WORD}${NUMBER_WORD}(?![a-zäöü])\\.?`);
/** Digits in groups, one space apart at most: three spaces start the next column. */
const PHONE = new RegExp(`${SEPARATOR}(\\+{0,2}[\\d(](?:[\\d()/.-]| (?=[\\d(/-]))*\\d)`);

const CONTACT_LABEL =
  /(?:ihre?\s+)?ansprechpartner(?:in)?|(?:sach)?bearbeiter(?:in)?|kontaktperson|contact\s+person|your\s+contact/;
/** A name of two to four words that start with a capital, with its titles. One word may be anything. */
const TITLES = '(?:(?:Herrn?|Frau|Mrs?\\.?|Ms\\.?|Dr\\.?|Prof\\.?)\\s)*';
const NAME_WORD = "\\p{Lu}[\\p{L}.'’-]*";
const PERSON = new RegExp(`${SEPARATOR}(${TITLES}${NAME_WORD}(?:\\s${NAME_WORD}){1,3})(?=\\s{2}|\\s*$|,)`, 'u');

/** The heading of an address that is neither party's, such as "Lieferadresse:" or "Ship to". */
const NOT_A_CONTACT = '(?!.*(?:mail|web|internet|bank))';
const OTHER_ADDRESS = new RegExp(
  `^${NOT_A_CONTACT}.*(?:adresse|address|anschrift|empfänger|(?:ship(?:ped)?|deliver(?:ed)?)\\s+to)\\s*:?$`,
  'i',
);
