// The XML that goes into the file, shown as it would be written.
import { $, el, setText } from './dom.js';
import { formatMoney, reasonOf } from './wording.js';
import { lang, t } from '../shared/i18n.js';
import { shownFormat, state } from './state.js';

const xmlSection = $<HTMLDetailsElement>('#xml');
let xmlTimer = 0;
let xmlRun = 0;

/** An element of the XML exactly as it is written there: the first `names[0]`, in it the first `names[1]`, and so on. */
function fragment(xml: string, ...names: string[]): string | undefined {
  let part: string | undefined = xml;
  for (const name of names) part = part && new RegExp(`<${name}(\\s[^>]*)?>[^]*?</${name}>`).exec(part)?.[0];
  return part;
}

/**
 * Shows the XML that "Create" would write right now: the one in the PDF, or for an XRechnung the file of its own. It
 * is not put together a second time for this view: the file is created and its XML is shown, and the rows of the
 * table are cut out of that XML.
 */
async function renderXml(): Promise<void> {
  const run = ++xmlRun;
  const [status, pair, whole] = [$('#xml-status'), $('#xml-pair'), $('#xml-whole')];
  const instead = (text: string) => {
    status.textContent = text;
    pair.hidden = whole.hidden = true;
  };
  if (!state.pdf || !state.result?.invoice) return instead(t('xml.errors'));
  if (pair.hidden) status.textContent = t('xml.busy');
  try {
    const invoice = structuredClone(state.draft);
    const { createEInvoice, createXRechnung } = await import('../../src/generate/create.js');
    const { xml, totals } =
      shownFormat() === 'xrechnung'
        ? await createXRechnung({ invoice })
        : await createEInvoice({ pdf: state.pdf, invoice });
    // The data has changed again in the meantime: the newer run shows its XML.
    if (run !== xmlRun) return;
    const date = (iso: unknown) =>
      new Intl.DateTimeFormat(lang(), { dateStyle: 'medium', timeZone: 'UTC' }).format(new Date(`${iso}T00:00:00Z`));
    // Where a value stands in CII (the PDF) and in UBL (the XRechnung): the path that is not in the XML finds nothing.
    const inXml = (cii: string[], ubl: string[]) => fragment(xml, ...cii) ?? fragment(xml, ...ubl);
    const rows: [label: string, value: string, written: string | undefined][] = [
      [t('f.number'), String(invoice.number), inXml(['rsm:ExchangedDocument', 'ram:ID'], ['cbc:ID'])],
      [
        t('f.issueDate'),
        date(invoice.issueDate),
        inXml(['rsm:ExchangedDocument', 'ram:IssueDateTime', 'udt:DateTimeString'], ['cbc:IssueDate']),
      ],
      [
        t('xml.seller'),
        String(invoice.seller?.name),
        inXml(['ram:SellerTradeParty', 'ram:Name'], ['cac:AccountingSupplierParty', 'cbc:RegistrationName']),
      ],
      [t('t.vat'), formatMoney(totals.vat), inXml(['ram:TaxTotalAmount'], ['cac:TaxTotal', 'cbc:TaxAmount'])],
      [t('t.gross'), formatMoney(totals.gross), inXml(['ram:GrandTotalAmount'], ['cbc:TaxInclusiveAmount'])],
    ];
    // In a narrow column the XML breaks where a tag ends, not in the middle of a name.
    const code = (written: string) =>
      el('code', {}, ...written.split(/(?<=>)(?!$)|(?=<\/)/).flatMap((part, i) => (i ? [el('wbr'), part] : [part])));
    pair
      .querySelector('tbody')!
      .replaceChildren(
        ...rows.flatMap(([label, value, written]) =>
          written
            ? [el('tr', {}, el('td', {}, `${label} `, el('strong', {}, value)), el('td', {}, code(written)))]
            : [],
        ),
      );
    $('#xml-code').textContent = xml;
    status.textContent = '';
    pair.hidden = whole.hidden = false;
  } catch (error) {
    if (run === xmlRun) instead(t('create.failed', { m: reasonOf(error) }));
  }
}

/** Creating the XML is work: it is done when the section is opened, and again a moment after the data last changed. */
export function refreshXml(): void {
  clearTimeout(xmlTimer);
  if (xmlSection.open) xmlTimer = window.setTimeout(renderXml, 400);
}
xmlSection.addEventListener('toggle', () => xmlSection.open && renderXml());

/** Copies the text of an element; the label of the button says so for a moment. */
export async function copyText(source: HTMLElement, label: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(source.textContent ?? '');
    setText(label, 'xml.copied');
    setTimeout(() => setText(label, 'xml.copy'), 2000);
  } catch {
    // The browser does not let the page write to the clipboard: the text is selected, ready for Ctrl+C.
    getSelection()?.selectAllChildren(source);
  }
}
$('#xml-copy').onclick = () => copyText($('#xml-code'), '#xml-copy');

/** Closes the XML section, when another file is opened. */
export function closeXml(): void {
  xmlSection.open = false;
}
