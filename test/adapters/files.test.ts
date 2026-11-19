import { linkSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createXRechnungFile, outputExists } from '../../src/adapters/files.js';
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
