import { linkSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { checkFile, createXRechnungFile, outputExists } from '../../src/adapters/files.js';
import type { InvoiceDraft } from '../../src/domain/model.js';

/** The sample data with what XRechnung asks for on top. */
function xrechnungInvoice(): InvoiceDraft {
  const draft = JSON.parse(readFileSync(new URL('../../examples/sample-invoice.json', import.meta.url), 'utf8'));
  draft.buyerReference = '99000000-BEISPIEL-00';
  Object.assign(draft.seller, { contactName: 'Erika Muster', phone: '+49 30 1234567' });
  draft.buyer.email = 'einkauf@beispiel.example';
  return draft;
}

describe('createXRechnungFile', () => {
  it('never writes over the file the data was read from, also through a hard link and with overwrite', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'pdf-to-einvoice-files-'));
    const data = join(dir, 'data.json');
    const text = JSON.stringify(xrechnungInvoice());
    writeFileSync(data, text);
    const link = join(dir, 'link.json');
    linkSync(data, link);
    for (const outputPath of [data, link]) {
      await expect(
        createXRechnungFile(xrechnungInvoice(), outputPath, { overwrite: true, dataPath: data }),
      ).rejects.toThrow('the input is never overwritten');
    }
    expect(readFileSync(data, 'utf8')).toBe(text);
  });

  it('writes the XML where no data file is named', async () => {
    const out = join(mkdtempSync(join(tmpdir(), 'pdf-to-einvoice-files-')), 'out.xml');
    await createXRechnungFile(xrechnungInvoice(), out);
    expect(readFileSync(out, 'utf8')).toContain('<cbc:ID>RE-2026-0042</cbc:ID>');
  });
});

describe('outputExists', () => {
  it('tells an output that is there already, refused here or by the file system, from any other error', async () => {
    const out = join(mkdtempSync(join(tmpdir(), 'pdf-to-einvoice-files-')), 'out.xml');
    writeFileSync(out, 'there');
    const refused = await createXRechnungFile(xrechnungInvoice(), out).catch((e: unknown) => e);
    expect(outputExists(refused)).toBe(true);
    let raced: unknown;
    try {
      writeFileSync(out, 'again', { flag: 'wx' });
    } catch (e) {
      raced = e;
    }
    expect(outputExists(raced)).toBe(true);
    expect(outputExists(new Error('EEXIST'))).toBe(false);
    expect(outputExists('EEXIST')).toBe(false);
  });
});

describe('checkFile', () => {
  const samplePdf = new URL('../../examples/sample-invoice.pdf', import.meta.url).pathname;
  const sample = (): InvoiceDraft =>
    JSON.parse(readFileSync(new URL('../../examples/sample-invoice.json', import.meta.url), 'utf8'));

  it('checks the data alone, and with the rules that are named', async () => {
    expect((await checkFile(sample())).findings).toEqual([]);
    const strict = await checkFile(sample(), { rules: 'xrechnung' });
    expect(strict.findings.map((finding) => finding.code)).toContain('xrechnung-buyer-reference');
  });

  it('compares the data with the text of the PDF that is named', async () => {
    expect((await checkFile(sample(), { pdfPath: samplePdf })).findings).toEqual([]);
    const other = await checkFile({ ...sample(), number: 'RE-2026-9999' }, { pdfPath: samplePdf });
    expect(other.findings.map((finding) => `${finding.path}:${finding.code}`)).toEqual(['number:not-in-pdf']);
  });
});
