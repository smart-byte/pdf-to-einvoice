// The web app in a real browser: the built site, with its Content-Security-Policy, served the way the host serves it.
// `npm run test:browser` builds the site and runs this file; it needs Chrome. `npm test` leaves it out.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PDFDocument, PDFName, PDFString, StandardFonts } from '@cantoo/pdf-lib';
import { chromium, type Browser, type Download, type Page } from 'playwright-core';
import { preview, type PreviewServer } from 'vite';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createEInvoice } from '../src/create.js';
import type { InvoiceDraft } from '../src/model.js';
import { validateEInvoice } from '../src/validate.js';

// npm names the script it runs: only `npm run test:browser` runs these tests.
const asked = process.env.npm_lifecycle_event === 'test:browser';

const file = (name: string) => readFileSync(new URL(`../examples/${name}`, import.meta.url));
const samplePdf = () => new Uint8Array(file('sample-invoice.pdf'));
const sampleData = (): InvoiceDraft => JSON.parse(file('sample-invoice.json').toString());
const upload = (name: string, bytes: Uint8Array) => ({ name, mimeType: 'application/pdf', buffer: Buffer.from(bytes) });
const bytesOf = async (download: Download) => new Uint8Array(readFileSync(await download.path()));

describe.skipIf(!asked)('the web app in a browser', () => {
  let server: PreviewServer;
  let browser: Browser;
  let base: string;
  /** What must not happen on any page: an error in the console (a breach of the policy is one), a failed request, a request to another host, an upload. */
  let problems: string[];

  beforeAll(async () => {
    server = await preview({
      configFile: fileURLToPath(new URL('../site/vite.config.ts', import.meta.url)),
      logLevel: 'silent',
      preview: { host: '127.0.0.1' },
    });
    base = server.resolvedUrls!.local[0]!;
    browser = await chromium.launch({ channel: 'chrome', headless: true });
  }, 60_000);
  afterAll(async () => {
    await browser?.close();
    await server?.close();
  });
  afterEach(() => expect(problems).toEqual([]));

  const open = async (lang = 'de'): Promise<Page> => {
    problems = [];
    const page = await (await browser.newContext({ acceptDownloads: true })).newPage();
    page.on('console', (message) => message.type() === 'error' && problems.push(`console: ${message.text()}`));
    page.on('pageerror', (error) => problems.push(`error: ${error.message}`));
    page.on('response', (response) => response.status() >= 400 && problems.push(`${response.status()} ${response.url()}`));
    // Nothing is uploaded: the page fetches its own files and nothing else. A request that carries data, in its body or
    // in its address, would be an upload, also one to its own host.
    page.on('request', (request) => {
      const url = request.url();
      if (!/^https?:/.test(url)) return;
      if (!url.startsWith(base)) problems.push(`request to ${url}`);
      else if (request.method() !== 'GET' || request.postData() !== null) problems.push(`${request.method()} with data to ${url}`);
      else if (new URL(url).search && !request.isNavigationRequest()) problems.push(`data in the address ${url}`);
    });
    await page.goto(`${base}?lang=${lang}`);
    return page;
  };
  /** Opens a PDF, or the sample of the page, and waits until it is read. */
  const read = async (page: Page, pdf?: ReturnType<typeof upload>) => {
    if (pdf) await page.setInputFiles('#file', pdf);
    else await page.click('#sample');
    await page.waitForSelector('body[data-view="work"]');
    await page.waitForFunction(() => document.querySelector<HTMLElement>('#scan')!.hidden);
  };
  const create = async (page: Page) => {
    await page.click('#create');
    await page.waitForSelector('body[data-view="done"]', { timeout: 90_000 });
  };
  const download = async (page: Page, link: string) => (await Promise.all([page.waitForEvent('download'), page.click(link)]))[0];
  const said = (page: Page, selector = '#summary li') =>
    page.$$eval(selector, (items) => items.map((item) => (item as HTMLElement).innerText.replace(/\s+/g, ' ')));
  /** The sample as an intra-community supply to Austria. */
  const supplyToAustria = async (page: Page) => {
    await page.fill('[data-path="buyer.country"]', 'AT');
    await page.fill('[data-path="buyer.vatId"]', 'ATU12345678');
    for (const line of [0, 1]) {
      await page.selectOption(`[data-path="lines.${line}.vatCategory"]`, 'K');
      await page.fill(`[data-path="lines.${line}.vatRate"]`, '0');
    }
    await page.fill('[data-path="vatExemptionReason"]', 'Steuerfreie innergemeinschaftliche Lieferung');
  };

  it('would notice an upload, also one to its own host', async () => {
    const page = await open();
    await page.evaluate(() => fetch('./', { method: 'POST', body: 'RE-2026-0042' }).catch(() => {}));
    await page.evaluate(() => fetch('./llms.txt?number=RE-2026-0042').catch(() => {}));
    expect(problems).toEqual(expect.arrayContaining([expect.stringMatching(/^POST with data to /), expect.stringMatching(/^data in the address /)]));
    // These two were made on purpose.
    problems = [];
  }, 120_000);

  it('turns the sample into an e-invoice that holds what the page showed', async () => {
    const page = await open();
    await read(page);
    expect(await said(page)).toEqual([]);
    await page.waitForSelector('#marks .mark');
    expect(await page.$$eval('#marks .mark', (marks) => marks.length)).toBeGreaterThan(20);
    await page.click('#xml > summary');
    await page.waitForSelector('#xml-pair:not([hidden])');
    await page.click('#xml-whole > summary');
    const shown = await page.textContent('#xml-code');
    await create(page);
    expect(await page.$eval('#done .stamp', (stamp) => (stamp as HTMLElement).hidden)).toBe(false);
    const pdf = await download(page, '#download-pdf');
    expect(pdf.suggestedFilename()).toBe('sample-invoice.einvoice.pdf');
    const result = await validateEInvoice(await bytesOf(pdf));
    expect(result).toMatchObject({ isEInvoice: true, findings: [] });
    expect(result.xml).toBe(shown);
  }, 120_000);

  it('reports an address that is not on the PDF, before and after creating', async () => {
    const page = await open();
    await read(page);
    await page.fill('[data-path="buyer.city"]', 'Anderswo');
    expect(await said(page, '#summary li.warning')).toEqual([expect.stringMatching(/^Kunde, Ort: Diese Angabe steht so nicht im PDF/)]);
    await create(page);
    expect(await said(page, '#done-notes li')).toEqual([expect.stringMatching(/^Kunde, Ort: /)]);
    expect(await page.$eval('#done .stamp', (stamp) => (stamp as HTMLElement).hidden)).toBe(true);
  }, 120_000);

  it('makes payment terms it suggests wait for a yes', async () => {
    // An invoice that states neither a due date nor payment terms.
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const rows = [
      'Muster Software GmbH, Beispielweg 1, 12345 Musterstadt',
      'Beispiel AG, Hauptstrasse 5, 54321 Beispielstadt',
      'Rechnung Nr. RE-2026-0050   Rechnungsdatum 03.11.2026',
      'USt-IdNr. DE123456789',
    ];
    const sheet = doc.addPage();
    rows.forEach((row, i) => sheet.drawText(row, { x: 50, y: 760 - i * 24, size: 11, font }));
    const page = await open();
    await read(page, upload('no-terms.pdf', await doc.save()));
    const suggestion = () => page.$eval('[data-hint="paymentTerms"]', (hint) => ({ text: hint.textContent, error: hint.classList.contains('hint--error') }));
    expect(await page.inputValue('[data-path="paymentTerms"]')).toBe('Zahlbar innerhalb von 14 Tagen ab Rechnungsdatum.');
    expect(await suggestion()).toMatchObject({ text: expect.stringContaining('Vorschlag, der nicht auf Ihrem PDF steht'), error: true });
    expect(await page.isDisabled('#create')).toBe(true);
    await page.click('[data-hint="paymentTerms"] .ok');
    expect(await suggestion()).toEqual({ text: '', error: false });
    expect(await page.inputValue('[data-path="paymentTerms"]')).toBe('Zahlbar innerhalb von 14 Tagen ab Rechnungsdatum.');
  }, 120_000);

  it('leaves a script of the PDF out of the e-invoice and says so', async () => {
    const doc = await PDFDocument.load(samplePdf(), { updateMetadata: false });
    doc.catalog.set(PDFName.of('OpenAction'), doc.context.obj({ Type: 'Action', S: 'JavaScript', JS: PDFString.of("app.alert('x')") }));
    const page = await open();
    await read(page, upload('script.pdf', await doc.save()));
    await create(page);
    expect(await said(page, '#done-notes li')).toEqual([expect.stringMatching(/^Ihr PDF enthielt Skripte oder automatische Aktionen/)]);
    const created = await PDFDocument.load(await bytesOf(await download(page, '#download-pdf')), { updateMetadata: false });
    expect(created.catalog.get(PDFName.of('OpenAction'))).toBeUndefined();
  }, 120_000);

  it('creates an XRechnung and the PDF that carries it', async () => {
    const page = await open();
    await read(page);
    await page.click('label:has(input[name="format"][value="xrechnung"])');
    expect(await page.isDisabled('#create')).toBe(true);
    expect(await said(page, '#summary li.error')).toHaveLength(5);
    await page.fill('[data-path="buyerReference"]', '12345678-0001-14');
    await page.fill('[data-path="seller.contactName"]', 'Erika Beispiel');
    await page.fill('[data-path="seller.phone"]', '+49 30 1234567');
    await page.fill('[data-path="seller.email"]', 'rechnung@muster-software.example');
    await page.fill('[data-path="buyer.email"]', 'einkauf@beispiel.example');
    expect(await said(page, '#summary li.error')).toEqual([]);
    await create(page);
    const xml = Buffer.from(await bytesOf(await download(page, '#download-xml'))).toString('utf8');
    expect(xml).toContain('urn:xeinkauf.de:kosit:xrechnung_3.0');
    expect(xml).toContain('<cbc:BuyerReference>12345678-0001-14</cbc:BuyerReference>');
    expect(await validateEInvoice(await bytesOf(await download(page, '#download-pdf')))).toMatchObject({ isEInvoice: true, findings: [] });
  }, 120_000);

  it('asks where an intra-community supply went, and refuses a country of delivery for an XRechnung', async () => {
    const page = await open();
    await read(page);
    await supplyToAustria(page);
    const question = (await said(page, '#summary li.warning')).find((text) => text.includes('innergemeinschaftlichen Lieferung'));
    expect(question).toContain('Land Ihres Kunden');
    await page.click('#summary li.warning button:has-text("innergemeinschaftlichen")');
    expect(await page.evaluate(() => (document.activeElement as HTMLElement).dataset.path)).toBe('deliveryCountry');
    await page.fill('[data-path="deliveryCountry"]', 'IT');
    expect((await said(page)).some((text) => text.includes('innergemeinschaftlichen Lieferung'))).toBe(false);
    await page.click('label:has(input[name="format"][value="xrechnung"])');
    expect((await said(page, '#summary li.error')).find((text) => text.startsWith('Land der Lieferung'))).toContain('nur mit Postleitzahl und Ort');
  }, 120_000);

  it('shows an existing e-invoice with its verdict and lets nothing be changed', async () => {
    const { pdf } = await createEInvoice({ pdf: samplePdf(), invoice: sampleData() });
    const page = await open();
    await read(page, upload('sample.einvoice.pdf', pdf));
    expect(await page.evaluate(() => document.body.dataset.mode)).toBe('validate');
    expect(await page.textContent('#summary')).toContain('Geprüft, nichts gefunden');
    await page.click('[data-path="number"]');
    await page.keyboard.type('X');
    expect(await page.inputValue('[data-path="number"]')).toBe('RE-2026-0042');
    expect(await page.isVisible('#create')).toBe(false);
  }, 120_000);

  it('offers the next invoice after the download, in the language of the page', async () => {
    const page = await open('en');
    await read(page);
    await create(page);
    expect(await page.textContent('#another')).toBe('Convert another invoice');
    await page.click('#another');
    expect(await page.evaluate(() => document.body.dataset.view)).toBe('start');
    await page.click('[data-lang="de"]');
    expect(await page.textContent('h1')).toContain('E-Rechnung');
  }, 120_000);
});
