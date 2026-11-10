import { isIban } from './check.js';
import type { InvoiceDraft, Line, Party } from './model.js';

// ponytail: patterns for German and English invoices, no model. They read what carries a label (number, dates, bank
// details, tax IDs, totals) and what sits where convention puts it: the seller in a sender line ("Name · Street ·
// 12345 City"), the buyer in the address block, the items in table rows that end with an amount. An invoice laid out
// differently yields less, never something invented: table rows are only kept when they add up to the printed net
// total. Add labels and layouts here before reaching for anything smarter.

const MONTHS = ['jan', 'feb', 'm[aä]r', 'apr', 'ma[iy]', 'jun', 'jul', 'aug', 'sep', 'o[ck]t', 'nov', 'de[cz]'];
const MONTH = `(${MONTHS.join('|')})[a-zä]*\\.?`;
const SEPARATOR = '^\\s*[:#.]?\\s*';

/** ISO, 3.11.2026, 3 November 2026, November 3, 2026, and 08/10/2026 where it can be read in one way only. */
const DATE = new RegExp(
  `${SEPARATOR}(?:(\\d{4})-(\\d{2})-(\\d{2})|(\\d{1,2})\\.\\s?(\\d{1,2})\\.\\s?(\\d{4})|(\\d{1,2})\\.?\\s+${MONTH}\\s+(\\d{4})|${MONTH}\\s+(\\d{1,2}),?\\s+(\\d{4})|(\\d{1,2})/(\\d{1,2})/(\\d{4}))`,
  'i',
);
const MONEY = "(-?\\d{1,3}(?:[.,' ]\\d{3})*[.,]\\d{2}|-?\\d+[.,]\\d{2})";
const AMOUNT = new RegExp(`${SEPARATOR}(?:\\d{1,2}(?:[.,]\\d+)?\\s*%\\s*)?[€$£]?\\s*${MONEY}(?!\\d)`);

const pad = (n: string | number) => String(n).padStart(2, '0');
const monthNumber = (name: string) => MONTHS.findIndex((m) => new RegExp(`^${m}`, 'i').test(name)) + 1;

function toIsoDate(m: RegExpExecArray, dayFirst: boolean): string | undefined {
  if (m[1]) return `${m[1]}-${m[2]}-${m[3]}`;
  if (m[4]) return `${m[6]}-${pad(m[5]!)}-${pad(m[4])}`;
  if (m[7]) return `${m[9]}-${pad(monthNumber(m[8]!))}-${pad(m[7])}`;
  if (m[10]) return `${m[12]}-${pad(monthNumber(m[10]))}-${pad(m[11]!)}`;
  // With slashes, day and month can be told apart when one is above 12, or when a German label says who wrote it.
  const [a, b] = [Number(m[13]), Number(m[14])];
  if (b > 12 && a <= 12) return `${m[15]}-${pad(a)}-${pad(b)}`;
  if ((a > 12 || dayFirst) && b <= 12) return `${m[15]}-${pad(b)}-${pad(a)}`;
  return undefined;
}

/** "1.499,00" and "1,499.00" both mean 1499: the last separator is the decimal one. */
const toNumber = (printed: string) => Number(printed.replace(/[^\d-]/g, '')) / 100;

/** Applies `value` to what follows each occurrence of `label` on the same line. */
function after(text: string, label: RegExp, value: RegExp): { hit: RegExpExecArray; label: string }[] {
  const hits: { hit: RegExpExecArray; label: string }[] = [];
  for (const match of text.matchAll(new RegExp(label.source, 'gi'))) {
    const rest = text.slice(match.index + match[0].length).split('\n', 1)[0]!;
    const hit = value.exec(rest.slice(0, 60));
    if (hit) hits.push({ hit, label: match[0] });
  }
  return hits;
}

function findIban(text: string): string | undefined {
  for (const match of text.matchAll(/\b[A-Z]{2}\d{2}(?: ?[A-Z0-9]{4}){2,7}(?: ?[A-Z0-9]{1,3})?/g)) {
    const candidate = match[0].replace(/ /g, '');
    // The pattern may swallow a following word; the check digits tell where the IBAN ends.
    for (let length = candidate.length; length >= 15; length--) {
      if (isIban(candidate.slice(0, length))) return candidate.slice(0, length);
    }
  }
  return undefined;
}

function findCurrency(text: string): string | undefined {
  const signs: [RegExp, string][] = [
    [/€|\bEUR\b/, 'EUR'],
    [/\$|\bUSD\b/, 'USD'],
    [/£|\bGBP\b/, 'GBP'],
    [/\bCHF\b/, 'CHF'],
  ];
  return signs.find(([pattern]) => pattern.test(text))?.[1];
}

// ---------------------------------------------------------------------------------------------------------------
// Layout: extractText() writes three spaces between columns, so a row splits into cells.

const cells = (row: string) => row.split(/\s{3,}/).map((cell) => cell.trim());
const isSenderLine = (row: string) => row.split(/\s[·|•]\s/).length >= 3;
/** "12345 Musterstadt", "DE-12345 Musterstadt", "D-12345 Musterstadt". */
const POSTAL = /^(?:([A-Z]{1,2})-)?(\d{4,5})\s+(\p{L}.*)$/u;
const COUNTRY_PREFIX: Record<string, string> = {
  D: 'DE',
  DE: 'DE',
  A: 'AT',
  AT: 'AT',
  CH: 'CH',
  F: 'FR',
  FR: 'FR',
  NL: 'NL',
  B: 'BE',
  BE: 'BE',
  L: 'LU',
  LU: 'LU',
};
/** VAT IDs start with the country code, except that Greece writes EL. */
const countryOfVatId = (vatId: string | undefined) => (vatId ? vatId.slice(0, 2).replace('EL', 'GR') : undefined);

function postalPart(cell: string): Partial<Party> | undefined {
  const m = POSTAL.exec(cell);
  return m ? { postalCode: m[2], city: m[3], country: COUNTRY_PREFIX[m[1] ?? ''] } : undefined;
}

/** The seller, from a line like "Name · Street 1 · 12345 City" in the letterhead or footer. */
function readSender(rows: string[]): Partial<Party> {
  for (const row of rows.filter(isSenderLine)) {
    const segments = row.split(/\s[·|•]\s|,\s/).map((segment) => segment.trim());
    const i = segments.findIndex((segment) => POSTAL.test(segment));
    if (i >= 1) return { name: segments[0], street: i >= 2 ? segments[i - 1] : undefined, ...postalPart(segments[i]!) };
  }
  return {};
}

/** The buyer, from the address block: up to three lines above a line that starts with postal code and city. */
function readRecipient(rows: string[]): Partial<Party> {
  const first = (row: string) => cells(row)[0]!;
  const endsBlock = (row: string) =>
    isSenderLine(row) || /:|^(bill to|invoice to|rechnung an|rechnungsempfänger|rechnungsadresse|kunde|customer|empfänger)\b/i.test(first(row));
  for (let i = 0; i < rows.length; i++) {
    const place = isSenderLine(rows[i]!) ? undefined : postalPart(first(rows[i]!));
    if (!place) continue;
    const above: string[] = [];
    for (let j = i - 1; j >= 0 && above.length < 3 && first(rows[j]!) && !endsBlock(rows[j]!); j--) above.unshift(first(rows[j]!));
    if (above.length >= 2) return { name: above[0], contactName: above.length === 3 ? above[1] : undefined, street: above.at(-1), ...place };
  }
  return {};
}

const UNITS: [RegExp, string][] = [
  [/^(std|stunden?|h|hours?|hrs?)\.?$/i, 'HUR'],
  [/^(tage?|days?)\.?$/i, 'DAY'],
  [/^(monate?|months?)\.?$/i, 'MON'],
  [/^kg\.?$/i, 'KGM'],
  [/^(pauschal|psch)\.?$/i, 'LS'],
];
const MONEY_CELL = new RegExp(`^[€$£]?\\s*${MONEY}\\s*(?:€|EUR|\\$|USD|£|GBP|CHF)?$`);
const RATE_CELL = /^(\d{1,2}(?:[.,]\d+)?)\s?%$/;
const QUANTITY_CELL = /^(-?\d+(?:[.,]\d+)?)\s*(\p{L}+\.?)?$/u;
const TOTALS_ROW = /^(netto|zwischensumme|summe|mwst|ust|umsatzsteuer|mehrwertsteuer|gesamt|brutto|rechnungsbetrag|total|subtotal|vat|tax)/i;
const decimal = (printed: string) => Number(printed.replace(',', '.'));

/**
 * The line items, from table rows that start with a position number and end with an amount. Rows are only believed
 * when they add up to the printed net total; otherwise nothing is returned and a person fills the lines in.
 */
function readItems(rows: string[], netTotal: number | undefined): Partial<Line>[] | undefined {
  const items: (Partial<Line> & { total: number })[] = [];
  let open = false;
  for (const row of rows) {
    const parts = cells(row);
    const last = MONEY_CELL.exec(parts.at(-1)!);
    if (/^\d{1,3}\.?$/.test(parts[0]!) && parts.length >= 3 && last) {
      const item: Partial<Line> & { total: number } = { name: parts[1], total: toNumber(last[1]!) };
      for (const cell of parts.slice(2, -1)) {
        const [rate, money, quantity] = [RATE_CELL.exec(cell), MONEY_CELL.exec(cell), QUANTITY_CELL.exec(cell)];
        if (rate) item.vatRate = decimal(rate[1]!);
        else if (money) item.unitPrice = toNumber(money[1]!);
        else if (quantity) {
          item.quantity = decimal(quantity[1]!);
          item.unit = UNITS.find(([pattern]) => pattern.test(quantity[2] ?? ''))?.[1];
        }
      }
      items.push(item);
      open = true;
    } else if (open && parts.length === 1 && !/:/.test(row) && !TOTALS_ROW.test(row)) {
      // A description that wraps continues on the next row, in a single cell.
      items.at(-1)!.name += ` ${parts[0]}`;
    } else open = false;
  }
  const cents = (n: number) => Math.round(n * 100);
  if (!items.length || netTotal === undefined || cents(items.reduce((sum, item) => sum + item.total, 0)) !== cents(netTotal)) return undefined;

  // A rate that the rows do not carry is the one the totals name, if they name exactly one.
  const totalRates = new Set(
    rows.filter((row) => TOTALS_ROW.test(row)).flatMap((row) => [...row.matchAll(/(\d{1,2}(?:[.,]\d+)?)\s?%/g)].map((m) => decimal(m[1]!))),
  );
  const onlyRate = totalRates.size === 1 ? [...totalRates][0] : undefined;
  return items.map(({ total, ...item }) => {
    const quantity = item.quantity ?? 1;
    return {
      name: item.name,
      quantity,
      unit: item.unit ?? 'C62',
      unitPrice: item.unitPrice ?? (quantity === 1 ? total : undefined),
      vatCategory: 'S' as const,
      vatRate: item.vatRate ?? onlyRate,
    };
  });
}

const PERIOD_LABEL =
  /(?:leistungs|abrechnungs|liefer)?zeitraum|leistungsmonat|leistungsdatum|lieferdatum|(?:service|billing|delivery)\s+(?:period|month)|period/;
const DOTTED = '(\\d{1,2})\\.(\\d{1,2})\\.(\\d{4})';
const PERIOD = new RegExp(
  `${SEPARATOR}(?:Q([1-4])[ /]?(\\d{4})|([1-4])\\.\\s?Quartal\\s+(\\d{4})|${DOTTED}\\s*(?:-|–|bis|to)\\s*${DOTTED}|${MONTH}\\s+(\\d{4})|(\\d{1,2})[./-](\\d{4})(?!\\d)|(\\d{4})-(\\d{2})(?![-\\d]))`,
  'i',
);

/**
 * A service period given as a quarter ("Q2 2026"), a month ("Oktober 2026", "10/2026") or two dates. German VAT
 * law accepts the calendar month as the date of supply (§ 31 (4) UStDV); the XML needs its first and last day.
 */
function readPeriod(text: string): { periodStart?: string; periodEnd?: string } {
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
  return {};
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

/**
 * Reads an invoice from its text without any model: labelled values, the seller and buyer from where German and
 * English invoices put them, and table rows that add up. A starting point for review, not a result: check every
 * value.
 */
export function guessFromText(text: string): InvoiceDraft {
  const rows = text.split('\n');
  const date = (label: RegExp) =>
    after(text, label, DATE)
      .map(({ hit, label: found }) => toIsoDate(hit, /datum|fällig|zahlbar/i.test(found)))
      .find(Boolean);
  const amount = (label: RegExp) => after(text, label, AMOUNT).map(({ hit }) => toNumber(hit[1]!))[0];
  const first = (label: RegExp, value: RegExp) => after(text, label, value)[0]?.hit[1];

  const vatIdLabel =
    /ust\.?-?\s?id\.?-?\s?(?:nr\.?)?|umsatzsteuer-?\s?id(?:entifikationsnummer)?|uid(?:-nr\.?)?|vat\s*(?:id|reg(?:istration)?\.?)?\s*(?:no\.?|number)?/;
  const vatIds = [...new Set(after(text, vatIdLabel, new RegExp(`${SEPARATOR}([A-Z]{2} ?[A-Z0-9]{8,12})\\b`)).map(({ hit }) => hit[1]!.replace(/ /g, '')))];
  const totals = {
    net: amount(/nettobetrag|nettosumme|summe\s+netto|zwischensumme|netto|subtotal|net\s+(?:amount|total)/),
    vat: amount(/umsatzsteuer|mehrwertsteuer|mwst\.?|ust\.?|\bvat\b|sales\s+tax/),
    gross: amount(/gesamt(?:betrag|summe)?|rechnungsbetrag|bruttobetrag|endbetrag|brutto|grand\s+total|amount\s+due|total(?:\s+amount)?(?:\s+due)?/),
  };
  const lines = readItems(rows, totals.net);
  const seller: Partial<Party> = { ...readSender(rows), vatId: vatIds[0] };
  seller.country ??= countryOfVatId(seller.vatId);
  const buyer: Partial<Party> = { ...readRecipient(rows), vatId: vatIds[1] };
  // An address without a country is at home when VAT is charged: that is the ordinary domestic invoice.
  buyer.country ??= countryOfVatId(buyer.vatId) ?? (buyer.postalCode && lines?.some((line) => (line.vatRate ?? 0) > 0) ? seller.country : undefined);

  return prune({
    number: first(
      /rechnungs?-?\s?(?:nummer|nr\.?)|invoice\s*(?:number|no\.?|#)|(?<![\wäöü.-])nr\.?\s*:/,
      new RegExp(`${SEPARATOR}([A-Za-z0-9][\\w/.-]*\\d[\\w/-]*)`),
    ),
    issueDate: date(/rechnungsdatum|invoice\s+date|date\s+of\s+issue|issue\s+date/) ?? date(/(?<![a-zäöü])datum|(?<![a-z] ?)date/),
    deliveryDate: date(/leistungsdatum|lieferdatum|date\s+of\s+(?:supply|delivery)|delivery\s+date|service\s+date/),
    ...readPeriod(text),
    dueDate: date(/fällig(?:keitsdatum|\s+am|\s+bis)?|zahlbar\s+bis|due(?:\s+date|\s+by|\s+on)?|payable\s+by/),
    currency: findCurrency(text),
    iban: findIban(text),
    bic: first(/\b(?:bic|swift)(?:[-/ ]?code)?/, new RegExp(`${SEPARATOR}([A-Z]{6}[A-Z0-9]{2}(?:[A-Z0-9]{3})?)\\b`)),
    seller: {
      ...seller,
      taxNumber: first(/steuernummer|steuer-?nr\.?|st\.?-?nr\.?|tax\s+(?:number|no\.?)/, new RegExp(`${SEPARATOR}(\\d{2,3}/\\d{3,4}/\\d{4,5}|\\d{10,13})`)),
    },
    buyer,
    lines,
    totals,
  });
}
