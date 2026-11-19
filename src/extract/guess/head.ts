import type { InvoiceType } from '../../domain/model.js';
import { MAX_WRAPPED } from './items.js';
import { cells, KEY_VALUE, NAMED, TITLE, TYPES } from './parties.js';
import { after, DATE, escape, MONTH, monthNumber, pad, SEPARATOR, toIsoDate } from './values.js';

// The head of the invoice: its number and type, its dates, the service period, the payment terms and the reference
// of the buyer.

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
  /^(?:zahlbar\b|(?:die\s+)?zahlung\s+(?:ist\s+)?(?:innerhalb|bis|sofort|ohne|erfolgt|fällig|\d)|bitte\s+(?:überweisen|zahlen|begleichen)|der\s+(?:rechnungs|gesamt)betrag\s+ist|sofort\s+(?:fällig|zahlbar)|payable\b|payment\s+(?:is\s+)?(?:due|within|upon)|please\s+(?:pay|remit|transfer)|net\s+\d+|due\s+(?:on|upon)\s+receipt|paiement\s+(?:à|sous|dans|comptant))/i;

/**
 * The payment terms as printed: what stands after their label, or the sentence that says when to pay, joined over
 * the rows it wraps into. They are taken over word for word; when the due date is, is read separately.
 */
export function readPaymentTerms(rows: string[]): string | undefined {
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
export function readPeriod(text: string, rows: string[]): { periodStart?: string; periodEnd?: string } {
  const months = (year: string, from: number, to: number) => {
    if (from < 1 || to > 12) return undefined;
    return {
      periodStart: `${year}-${pad(from)}-01`,
      periodEnd: `${year}-${pad(to)}-${new Date(Date.UTC(Number(year), to, 0)).getUTCDate()}`,
    };
  };
  // "September 2026 bis Januar 2027": from the first day of the one month to the last day of the other.
  for (const { hit: m } of after(text, PERIOD_LABEL, MONTH_RANGE)) {
    const [from, to] = [
      months(m[2]!, monthNumber(m[1]!), monthNumber(m[1]!)),
      months(m[4]!, monthNumber(m[3]!), monthNumber(m[3]!)),
    ];
    if (from && to && from.periodStart < to.periodEnd)
      return { periodStart: from.periodStart, periodEnd: to.periodEnd };
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
    rows.map((row) => MONTH_ROW.exec(row.trim())).find(Boolean) ??
    (titled < 0 ? null : MONTH_NAMED.exec(`${rows[titled]}\n${rows[titled + 1] ?? ''}`));
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
export function readNumber(searched: string, rows: string[]): { number?: string; dated?: string; beside?: string } {
  const date = (hit: RegExpExecArray | null | undefined) => (hit ? toIsoDate(hit, false) : undefined);
  // Digits in groups ("100 200 300") are one number.
  const [labelled] = after(
    searched,
    NUMBER_LABEL,
    new RegExp(`${SEPARATOR}(\\d{2,4}(?: \\d{2,4})+(?=\\s{3}|$)|[A-Za-z0-9][\\w/.-]*\\d[\\w/-]*)`),
  );
  const titles = rows.map(cells).filter((parts) => parts.some((cell) => TITLE.test(cell) || NAMED.test(cell)));
  const dated =
    labelled &&
    after(searched, new RegExp(`${escape(labelled.hit[1]!)}\\s+(?:vom|von|issued\\s+(?:at|on)|dated|du|of)`), DATE)[0]
      ?.hit;
  return {
    number:
      labelled?.hit[1]!.replace(/ /g, '') ??
      titles.flatMap((parts) => parts.map((cell) => NAMED.exec(cell)?.[2])).find(Boolean),
    dated: date(dated),
    beside: titles.flatMap((parts) => parts.map((cell) => date(DATE.exec(cell)))).find(Boolean),
  };
}

/** The kind of invoice the title names: the first cell that is a title, alone or with the number. */
export function readType(rows: string[]): InvoiceType | undefined {
  const title = rows
    .flatMap(cells)
    .map((cell) => (TITLE.exec(cell)?.index === 0 ? cell : NAMED.exec(cell)?.[1]))
    .find(Boolean);
  return title ? TYPES.find(([pattern]) => pattern.test(title))?.[1] : undefined;
}

const LEITWEG_LABEL = /leitweg\w*[-\s]?(?:id|nr\.?|nummer)/;
/** Coarse address, fine address and check digits, as a Leitweg-ID is built. */
const LEITWEG = new RegExp(`${SEPARATOR}(\\d{2,12}(?:-[A-Za-z0-9]{1,30})?-\\d{2})(?![\\w-])`);
/** What EN 16931 calls the field (BT-10). "Ihr Zeichen" or "Your reference" may be anything, often the number of an order. */
const REFERENCE_LABEL =
  /referenz\s+des\s+käufers|käuferreferenz(?:-?\s?(?:nr\.?|nummer))?|buyer(?:['’]?s)?\s+reference/;
/** What stands in the cell after a label: three spaces start the next column. */
const REST_OF_CELL = new RegExp(`${SEPARATOR}(\\S+(?: {1,2}\\S+)*)`);

/** The reference of the buyer after its label, as it is printed: a Leitweg-ID by its shape, another reference as it stands. */
export function readBuyerReference(searched: string): string | undefined {
  const found = [
    ...after(searched, LEITWEG_LABEL, LEITWEG),
    // A value that ends with a colon is the next label, in a column of labels.
    ...after(searched, REFERENCE_LABEL, REST_OF_CELL).filter(({ hit }) => !hit[1]!.endsWith(':')),
  ].map(({ hit }) => hit[1]!);
  return new Set(found.map((value) => value.replace(/\s/g, ''))).size === 1 ? found[0] : undefined;
}
