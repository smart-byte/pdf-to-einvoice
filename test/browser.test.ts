// The web app in a real browser: the built site, with its Content-Security-Policy, served the way the host serves it.
// `npm run test:browser` builds the site and runs this file; it needs Chrome. `npm test` leaves it out.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PDFDocument, PDFName, PDFString, StandardFonts } from '@cantoo/pdf-lib';
import { chromium, type Browser, type Download, type Page } from 'playwright-core';
import { preview, type PreviewServer } from 'vite';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { extractionSchema } from '../site/answer.js';
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
    // Data in the path of an address asks for a file the site does not have: that request fails, which is noticed.
    await page.evaluate(() => fetch('./RE-2026-0042').catch(() => {}));
    expect(problems).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/^POST with data to /),
        expect.stringMatching(/^data in the address /),
        expect.stringMatching(/^404 .*\/RE-2026-0042$/),
      ]),
    );
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
    // The sample prints the e-mail address of the seller, which is read; the other four the buyer or the user names.
    expect(await page.inputValue('[data-path="seller.email"]')).toBe('rechnung@muster-software.example');
    expect(await said(page, '#summary li.error')).toHaveLength(4);
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

  it('fills in the contact data and the Leitweg-ID a page states, and shows them for the hybrid PDF too', async () => {
    const doc = await PDFDocument.load(samplePdf(), { updateMetadata: false });
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const added = doc.addPage();
    ['Leitweg-ID: 04011000-12345-34', 'Ihr Ansprechpartner: Erika Beispiel', 'Tel.: 030 1234567'].forEach((line, i) =>
      added.drawText(line, { x: 56, y: 760 - 16 * i, size: 10, font }),
    );
    const page = await open();
    await read(page, upload('contact.pdf', await doc.save()));
    // The hybrid PDF does not ask for these fields. What was read is shown all the same: nothing goes into the file unseen.
    for (const [path, value] of [
      ['seller.contactName', 'Erika Beispiel'],
      ['seller.phone', '030 1234567'],
      ['buyerReference', '04011000-12345-34'],
    ]) {
      expect(await page.isVisible(`[data-path="${path}"]`)).toBe(true);
      expect(await page.inputValue(`[data-path="${path}"]`)).toBe(value);
    }
    expect(await page.locator('[data-path="buyer.email"]').count()).toBe(0);
    await page.click('label:has(input[name="format"][value="xrechnung"])');
    expect(await page.locator('[data-path="buyerReference"]').count()).toBe(1);
    expect(await said(page, '#summary li.error')).toEqual([expect.stringContaining('E-Mail')]);
  }, 120_000);

  it('shows the buyer contact read from an address before writing it into the XML', async () => {
    const doc = await PDFDocument.load(samplePdf(), { updateMetadata: false });
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const added = doc.addPage();
    ['Käufer:', 'Beispiel AG', 'Erika Muster', 'Hauptstraße 5', '54321 Beispielstadt'].forEach((line, i) =>
      added.drawText(line, { x: 56, y: 760 - 18 * i, size: 11, font }),
    );
    const page = await open();
    await read(page, upload('buyer-contact.pdf', await doc.save()));
    const field = page.locator('[data-path="buyer.contactName"]');
    expect(await field.isVisible()).toBe(true);
    expect(await field.inputValue()).toBe('Erika Muster');
    await page.click('label:has(input[name="format"][value="xrechnung"])');
    expect(await field.isVisible()).toBe(true);
    await page.click('label:has(input[name="format"][value="pdf"])');
    await field.fill('Erika Beispiel');
    await page.click('#create');
    await page.waitForSelector('body[data-view="done"]', { timeout: 90_000 });
    const xml = Buffer.from(await bytesOf(await download(page, '#download-xml'))).toString('utf8');
    expect(xml).toContain('Erika Beispiel');
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

  it('takes a discount on a line item into the check, and shows the discount of an existing e-invoice', async () => {
    const page = await open();
    await read(page);
    await page.fill('[data-path="lines.1.discount.percent"]', '10');
    // The page does not show the percentage. `said` turns the no-break space of the label into a plain one.
    expect(await said(page)).toEqual(expect.arrayContaining([expect.stringMatching(/^Position 2, Rabatt %: Diese Angabe steht so nicht im PDF/)]));
    // The hint below one field moves no field beside it. Both are measured at once: the page may still be scrolling.
    const [percent, amount] = await page.$$eval('[data-path^="lines.1.discount."]', (inputs) =>
      inputs.map((input) => Math.round(input.getBoundingClientRect().top)),
    );
    expect(amount).toBe(percent);
    const invoice = sampleData() as any;
    delete invoice.totals;
    invoice.lines[1].discount = { percent: 10 };
    const existing = await open();
    await read(existing, upload('discount.einvoice.pdf', (await createEInvoice({ pdf: samplePdf(), invoice })).pdf));
    expect(await existing.inputValue('[data-path="lines.1.discount.percent"]')).toBe('10');
    expect(await existing.inputValue('[data-path="lines.1.discount.amount"]')).toBe('49.9');
  }, 120_000);

  it('reports a discount of an existing e-invoice whose XML contradicts its own base', async () => {
    // Base 50, 10 %, amount 10, on a line of 1 x 100: only the base the XML states shows the contradiction.
    const invoice = sampleData() as any;
    delete invoice.totals;
    Object.assign(invoice.lines[0], { quantity: 1, discount: { percent: 10 } });
    const xml = (await createEInvoice({ pdf: samplePdf(), invoice })).xml.replace(
      '<ram:BasisAmount>100.00</ram:BasisAmount>',
      '<ram:BasisAmount>50.00</ram:BasisAmount>',
    );
    const doc = await PDFDocument.load(samplePdf());
    await doc.attach(new TextEncoder().encode(xml), 'factur-x.xml', { mimeType: 'text/xml' });
    const page = await open();
    await read(page, upload('contradiction.pdf', await doc.save()));
    expect(await said(page)).toEqual(
      expect.arrayContaining([expect.stringMatching(/Im XML passen Prozentsatz, Grundbetrag und Betrag dieses Rabatts nicht zusammen/)]),
    );
  }, 120_000);

  it('gives a long text the room it needs: the field grows with it and can be drawn larger', async () => {
    const page = await open();
    await read(page);
    const box = (path: string) =>
      page.$eval(`[data-path="${path}"]`, (field) => ({
        tag: field.tagName,
        height: field.clientHeight,
        cut: field.scrollHeight > field.clientHeight + 1,
        resize: getComputedStyle(field).resize,
      }));
    const short = await box('lines.0.name');
    expect(short).toMatchObject({ tag: 'TEXTAREA', cut: false, resize: 'vertical' });
    // One line high while the text is short, like the fields beside it.
    expect(short.height).toBeLessThanOrEqual((await page.$eval('[data-path="lines.0.quantity"]', (field) => field.clientHeight)) + 2);
    await page.fill(
      '[data-path="lines.0.name"]',
      'Beratung E-Rechnung: Analyse der bestehenden Rechnungsstellung, Einrichtung der Schnittstelle und Schulung der Mitarbeitenden vor Ort',
    );
    const long = await box('lines.0.name');
    expect(long.cut).toBe(false);
    expect(long.height).toBeGreaterThan(short.height);
    for (const path of ['paymentTerms', 'vatExemptionReason']) expect(await box(path)).toMatchObject({ tag: 'TEXTAREA', resize: 'vertical' });
    // The description is still one value: it goes into the XML as it was typed.
    await page.click('#xml > summary');
    await page.waitForSelector('#xml-pair:not([hidden])');
    await page.click('#xml-whole > summary');
    expect(await page.textContent('#xml-code')).toContain('Schulung der Mitarbeitenden vor Ort</ram:Name>');
  }, 120_000);

  it('shows how far a language model has come with its answer', async () => {
    // What a model answers for the sample: every key of the schema in its order, with the one value the patterns do not read.
    const filled = (schema: any, key = ''): unknown =>
      schema.type === 'object'
        ? Object.fromEntries(Object.entries(schema.properties).map(([name, value]) => [name, filled(value, name)]))
        : schema.type === 'array'
          ? [filled(schema.items), filled(schema.items)]
          : key === 'email'
            ? 'rechnung@muster-software.example'
            : null;
    // Stands in for the library that runs the model: no model is loaded, and the answer comes piece by piece.
    const library = `
      const answer = ${JSON.stringify(JSON.stringify(filled(extractionSchema())))};
      export async function CreateWebWorkerMLCEngine(worker, id, { initProgressCallback }) {
        initProgressCallback({ progress: 1 });
        const pieces = async function* () {
          for (const piece of answer.match(/[\\s\\S]{1,24}/g)) {
            await new Promise((done) => setTimeout(done, 15));
            yield { choices: [{ delta: { content: piece } }] };
          }
        };
        return { unload: async () => {}, chat: { completions: { create: async () => pieces() } } };
      }`;
    const page = await open();
    await page.route(/\/assets\/lib-[^/]+\.js$/, (route) => route.fulfill({ contentType: 'text/javascript', body: library }));
    await read(page);
    if (!(await page.isVisible('#ai-run'))) await page.click('.reader summary');
    await page.evaluate(() => {
      const seen: [string, number][] = ((window as any).seen = []);
      const note = () => seen.push([document.querySelector('#ai-status')!.textContent!, document.querySelector<HTMLProgressElement>('#ai-progress')!.value]);
      new MutationObserver(note).observe(document.querySelector('#ai-status')!, { childList: true, characterData: true, subtree: true });
    });
    await page.click('#ai-run');
    await page.waitForFunction(() => document.querySelector('#ai-status')!.textContent!.startsWith('Fertig'), null, { timeout: 60_000 });
    const seen: [string, number][] = await page.evaluate(() => (window as any).seen);
    const writing = seen.filter(([status]) => status.startsWith('Das Modell schreibt'));
    expect(writing.some(([status]) => /^Das Modell schreibt die Angaben\s… \d+\s%$/.test(status))).toBe(true);
    expect(writing.some(([status]) => /^Das Modell schreibt Position 2\s…$/.test(status))).toBe(true);
    expect(writing.every(([, value], i) => i === 0 || value >= writing[i - 1]![1])).toBe(true);
    expect(writing.at(-1)![1]).toBeGreaterThan(0.9);
    expect(await page.textContent('#ai-status')).toBe('Fertig. Die KI hat 1 Angabe ergänzt: Bitte prüfen Sie sie.');
    expect(await page.isVisible('#ai-loading')).toBe(false);
  }, 120_000);

  it('has no page counter in a build that is not given one, and says so', async () => {
    const page = await open('en');
    for (const address of ['', 'privacy.html', 'legal-notice.html']) {
      await page.goto(`${base}${address}?lang=en`);
      const origins = await page.$$eval('script[src]', (scripts) => scripts.map((script) => new URL((script as HTMLScriptElement).src).origin));
      expect(new Set(origins)).toEqual(new Set([new URL(base).origin]));
    }
    await page.goto(`${base}privacy.html?lang=en`);
    const policy = await page.textContent('main');
    expect(policy).toContain('No cookies, accounts, contact forms, analytics or advertising.');
    expect(policy).not.toMatch(/Umami|with-counter/);
    expect(await page.$('[data-optout]')).toBeNull();
  }, 120_000);

  it('never gets wider than a phone while the stamp lands on the finished page', async () => {
    problems = [];
    const page = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
    await page.goto(`${base}?lang=de`);
    await read(page);
    // Looks at every frame from now on: the stamp is larger than it ends up for a moment.
    await page.evaluate(() => {
      const widest = ((window as any).widest = { value: 0 });
      const look = () => {
        if (document.body.dataset.view === 'done') widest.value = Math.max(widest.value, document.documentElement.scrollWidth - innerWidth);
        requestAnimationFrame(look);
      };
      look();
    });
    await create(page);
    await page.waitForTimeout(1500);
    expect(await page.evaluate(() => (window as any).widest.value)).toBe(0);
  }, 120_000);

  // Search engines and link previews (LinkedIn, messengers) read the HTML: each language has an address whose page
  // says everything in that language before any script runs, and starts in it, whatever was chosen before.
  it('has an address per language whose page is in that language before any script runs', async () => {
    const page = await open();
    const head = () =>
      page.$$eval('meta[property^="og:"], meta[name="description"], meta[name^="twitter:"], link[rel="canonical"]', (tags) =>
        Object.fromEntries(
          tags.map((tag) => [tag.getAttribute('property') ?? tag.getAttribute('name') ?? 'canonical', tag.getAttribute('content') ?? tag.getAttribute('href')]),
        ),
      );
    const heads: Record<string, Record<string, string | null>> = {};
    for (const [lang, chosenBefore, headline] of [
      ['en', 'de', 'e-invoice'],
      ['de', 'en', 'E-Rechnung'],
    ] as const) {
      await page.evaluate((chosen) => localStorage.setItem('lang', chosen), chosenBefore);
      const response = await page.goto(`${base}${lang}`);
      expect(response?.status()).toBe(200);
      const html = await response!.text();
      expect(/<html lang="([a-z]+)"/.exec(html)?.[1]).toBe(lang);
      heads[lang] = await head();
      expect(heads[lang]).toMatchObject({ canonical: `https://pdf-to-einvoice.app/${lang}`, 'og:url': `https://pdf-to-einvoice.app/${lang}` });
      expect(await page.textContent('h1')).toContain(headline);
      // The title a search engine or a preview shows is the one the page shows.
      expect(/<title[^>]*>([^<]*)</.exec(html)?.[1]).toBe(await page.title());
    }
    for (const key of ['description', 'og:title', 'og:description', 'og:image', 'og:image:alt', 'twitter:title', 'twitter:image']) {
      expect(heads.de![key]).not.toBe(heads.en![key]);
    }
    const image = await page.request.get(heads.de!['og:image']!.replace('https://pdf-to-einvoice.app/', base));
    expect(image.headers()['content-type']).toBe('image/png');
    // The switch takes the address along, so that a copied link opens what was shown.
    await page.click('[data-lang="en"]');
    expect(new URL(page.url()).pathname).toBe('/en');
    // The sitemap names the addresses every start page names as its alternates.
    const alternates = await page.$$eval('link[rel="alternate"][hreflang]', (links) => links.map((link) => (link as HTMLLinkElement).href));
    const sitemap = await (await page.request.get(`${base}sitemap.xml`)).text();
    expect([...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1]).sort()).toEqual(alternates.sort());
    expect(await (await page.request.get(`${base}robots.txt`)).text()).toContain('Sitemap: https://pdf-to-einvoice.app/sitemap.xml');
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
