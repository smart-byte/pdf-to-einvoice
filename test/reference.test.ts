// Validates generated e-invoices with Mustang, the reference validator of the ZUGFeRD community: veraPDF for
// PDF/A-3 plus the official EN 16931 / Factur-X Schematron rules. Opt-in, because it needs Java and a download:
//
//   curl -LO https://github.com/ZUGFeRD/mustangproject/releases/download/core-2.26.0/Mustang-CLI-2.26.0.jar
//   MUSTANG_JAR=$PWD/Mustang-CLI-2.26.0.jar npm run test:reference
import { execFile } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import { createEInvoice } from '../src/create.js';
import type { InvoiceDraft } from '../src/model.js';

const jar = process.env.MUSTANG_JAR;
const file = (name: string) => readFileSync(new URL(`../examples/${name}`, import.meta.url));
const sample = (change: (draft: any) => void = () => {}): InvoiceDraft => {
  const draft = JSON.parse(file('sample-invoice.json').toString());
  change(draft);
  return draft;
};
/** Every line in the given VAT category at 0 %, with a reason and no printed totals. */
const withoutVat = (category: string, reason: string, change: (draft: any) => void = () => {}) =>
  sample((d) => {
    for (const line of d.lines) Object.assign(line, { vatCategory: category, vatRate: 0 });
    d.vatExemptionReason = reason;
    delete d.totals;
    change(d);
  });

const US_BUYER = { name: 'Example Inc.', street: '1 Market Street', postalCode: '94105', city: 'San Francisco', country: 'US' };
const AT_BUYER = { name: 'Beispiel GmbH', street: 'Ringstraße 1', postalCode: '1010', city: 'Wien', country: 'AT', vatId: 'ATU12345678' };

const CASES: Record<string, InvoiceDraft> = {
  'domestic invoice with VAT': sample(),
  'seller with a tax number instead of a VAT ID': sample((d) => {
    delete d.seller.vatId;
    d.seller.taxNumber = '123/456/78901';
  }),
  'two VAT rates': sample((d) => {
    d.lines[1].vatRate = 7;
    delete d.totals;
  }),
  'service period instead of a delivery date': sample((d) => {
    delete d.deliveryDate;
    Object.assign(d, { periodStart: '2026-10-01', periodEnd: '2026-10-31' });
  }),
  'partly paid in advance': sample((d) => {
    d.prepaidAmount = 500;
    delete d.totals;
  }),
  'reverse charge to a business in another EU country': withoutVat('AE', 'Reverse charge: VAT is owed by the recipient.', (d) => (d.buyer = AT_BUYER)),
  'intra-community supply of goods': withoutVat('K', 'Tax-free intra-community supply.', (d) => (d.buyer = AT_BUYER)),
  'export of goods to the USA': withoutVat('G', 'Tax-free export.', (d) => (d.buyer = US_BUYER)),
  'service for a business in the USA, not subject to VAT, in US dollars': withoutVat('O', 'Not taxable in Germany (§ 3a (2) UStG).', (d) => {
    d.buyer = US_BUYER;
    d.currency = 'USD';
  }),
  'small business without VAT (§ 19 UStG)': withoutVat('E', 'No VAT charged: small business under § 19 UStG.', (d) => {
    delete d.seller.vatId;
    d.seller.taxNumber = '123/456/78901';
  }),
  'every optional field filled in': sample((d) => {
    Object.assign(d, { orderReference: 'PO-77', buyerReference: 'REF-1', note: 'Thank you.' });
    Object.assign(d.seller, { phone: '+49 30 1234567', contactName: 'Erika Muster' });
    Object.assign(d.buyer, { vatId: 'DE987654321', email: 'einkauf@beispiel.example' });
    Object.assign(d.lines[1], { description: 'Twelve months', unitPrice: 249.505 });
    delete d.totals;
  }),
  'credit note': sample((d) => Object.assign(d, { typeCode: '381', precedingInvoiceNumber: 'RE-2026-0041', precedingInvoiceDate: '2026-10-20' })),
  'corrected invoice replacing an earlier plain PDF': sample((d) =>
    Object.assign(d, { typeCode: '384', precedingInvoiceNumber: 'RE-2026-0042', precedingInvoiceDate: '2026-11-03', number: 'RE-2026-0042-K' }),
  ),
};

const status = (report: string, part: 'pdf' | 'xml') => new RegExp(`<${part}>[\\s\\S]*?<summary status="(\\w+)"`).exec(report)?.[1];
const problems = (report: string) => [...report.matchAll(/<(?:error|warning)[^>]*>([^<]+)/g)].map((m) => m[1]!.trim());

describe.skipIf(!jar)('reference validation with Mustang', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pdf-to-einvoice-'));

  it.concurrent.each(Object.entries(CASES))(
    '%s',
    async (name, invoice) => {
      const { pdf } = await createEInvoice({ pdf: new Uint8Array(file('sample-invoice.pdf')), invoice });
      const path = join(dir, `${name.replace(/\W+/g, '-')}.pdf`);
      writeFileSync(path, pdf);
      const { stdout } = await promisify(execFile)('java', ['-jar', jar!, '--no-notices', '--action', 'validate', '--source', path], {
        maxBuffer: 64 * 1024 * 1024,
      }).catch((e) => e as { stdout: string });
      expect({ pdf: status(stdout, 'pdf'), xml: status(stdout, 'xml'), problems: problems(stdout) }).toEqual({ pdf: 'valid', xml: 'valid', problems: [] });
    },
    120_000,
  );
});
