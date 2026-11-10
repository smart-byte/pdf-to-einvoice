import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { describe, expect, it } from 'vitest';
import { createServer } from '../src/mcp.js';
import { readEmbeddedXml } from '../src/pdf.js';

const example = (name: string) => fileURLToPath(new URL(`../examples/${name}`, import.meta.url));
const SAMPLE_PDF = example('sample-invoice.pdf');
const sample = (change: (draft: any) => void = () => {}) => {
  const draft = JSON.parse(readFileSync(example('sample-invoice.json'), 'utf8'));
  change(draft);
  return draft;
};
const tmp = () => mkdtempSync(join(tmpdir(), 'pdf-to-einvoice-mcp-'));

/** A client talking to a fresh server in the same process. */
async function connect(): Promise<Client> {
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test', version: '0.0.0' });
  await Promise.all([createServer().connect(serverSide), client.connect(clientSide)]);
  return client;
}

/** Calls a tool and returns its error flag and its single text item. */
async function call(name: string, args: Record<string, unknown>) {
  const client = await connect();
  const result = await client.callTool({ name, arguments: args });
  const content = result.content as { type: string; text: string }[];
  expect(content).toHaveLength(1);
  return { isError: result.isError === true, text: content[0]!.text };
}

describe('MCP server', () => {
  it('offers the five tools', async () => {
    const { tools } = await (await connect()).listTools();
    expect(tools.map((t) => t.name)).toEqual(['read_invoice_pdf', 'check_invoice', 'create_einvoice', 'read_einvoice_xml', 'validate_einvoice']);
  });

  it('shows the model every invoice field in the tool input', async () => {
    const { tools } = await (await connect()).listTools();
    const invoice = (tools.find((t) => t.name === 'create_einvoice')!.inputSchema.properties as any).invoice;
    expect(invoice.properties.seller.properties.vatId.type).toBe('string');
    expect(invoice.required).toContain('number');
  });

  it('tells the model to act for the issuer and not to invent values', async () => {
    const instructions = (await connect()).getInstructions();
    expect(instructions).toMatch(/issuer/i);
    expect(instructions).toMatch(/never invent/i);
  });

  it('rejects a tool it does not have', async () => {
    await expect((await connect()).callTool({ name: 'delete_everything', arguments: {} })).rejects.toThrow(/delete_everything/);
  });
});

describe('read_invoice_pdf', () => {
  it('returns the text, the guessed values and facts about the PDF', async () => {
    const result = await call('read_invoice_pdf', { pdf_path: SAMPLE_PDF });
    const output = JSON.parse(result.text);
    expect(result.isError).toBe(false);
    expect(output.text).toContain('RE-2026-0042');
    expect(output.guess.number).toBe('RE-2026-0042');
    expect(output.pdf).toEqual({ pages: 1, unembeddedFonts: [], isEInvoice: false });
  });

  it('refuses a relative path', async () => {
    const result = await call('read_invoice_pdf', { pdf_path: 'examples/sample-invoice.pdf' });
    expect(result.isError).toBe(true);
    expect(result.text).toContain('absolute');
  });

  it('reports a file that does not exist as a tool error', async () => {
    const result = await call('read_invoice_pdf', { pdf_path: join(tmp(), 'missing.pdf') });
    expect(result.isError).toBe(true);
  });
});

describe('check_invoice', () => {
  it('accepts complete data and returns the totals', async () => {
    const output = JSON.parse((await call('check_invoice', { invoice: sample() })).text);
    expect(output).toMatchObject({ ok: true, findings: [], totals: { gross: 1783.81 } });
  });

  it('reports a missing field', async () => {
    const result = await call('check_invoice', { invoice: sample((d) => delete d.number) });
    const output = JSON.parse(result.text);
    expect(result.isError).toBe(false);
    expect(output.ok).toBe(false);
    expect(output.findings).toMatchObject([{ path: 'number', severity: 'error', code: 'required' }]);
  });

  it('compares the data with the PDF when given its path', async () => {
    const output = JSON.parse((await call('check_invoice', { invoice: sample((d) => (d.number = 'RE-2026-0043')), pdf_path: SAMPLE_PDF })).text);
    expect(output.ok).toBe(true);
    expect(output.findings).toMatchObject([{ path: 'number', code: 'not-in-pdf' }]);
  });
});

describe('create_einvoice', () => {
  it('writes the e-invoice and returns where', async () => {
    const out = join(tmp(), 'out.pdf');
    const result = await call('create_einvoice', { pdf_path: SAMPLE_PDF, invoice: sample(), output_path: out });
    expect(result.isError).toBe(false);
    expect(JSON.parse(result.text)).toMatchObject({ output_path: out, findings: [], totals: { due: 1783.81 } });
    expect(await readEmbeddedXml(new Uint8Array(readFileSync(out)))).toContain('<ram:ID>RE-2026-0042</ram:ID>');
  });

  it('returns the findings as a tool error for bad data and writes nothing', async () => {
    const out = join(tmp(), 'out.pdf');
    const result = await call('create_einvoice', { pdf_path: SAMPLE_PDF, invoice: sample((d) => delete d.number), output_path: out });
    expect(result.isError).toBe(true);
    expect(JSON.parse(result.text)).toMatchObject({ error: 'invalid-invoice', findings: [{ path: 'number', severity: 'error' }] });
    expect(existsSync(out)).toBe(false);
  });

  it('leaves an existing file alone unless asked to overwrite it', async () => {
    const out = join(tmp(), 'out.pdf');
    writeFileSync(out, 'keep me');
    const refused = await call('create_einvoice', { pdf_path: SAMPLE_PDF, invoice: sample(), output_path: out });
    expect(refused.isError).toBe(true);
    expect(readFileSync(out, 'utf8')).toBe('keep me');
    const forced = await call('create_einvoice', { pdf_path: SAMPLE_PDF, invoice: sample(), output_path: out, overwrite: true });
    expect(forced.isError).toBe(false);
  });

  it('asks for the invoice data when it is missing', async () => {
    const result = await call('create_einvoice', { pdf_path: SAMPLE_PDF });
    expect(result.isError).toBe(true);
    expect(result.text).toContain('invoice');
  });
});

describe('read_einvoice_xml', () => {
  it('returns the XML of an e-invoice', async () => {
    const out = join(tmp(), 'out.pdf');
    await call('create_einvoice', { pdf_path: SAMPLE_PDF, invoice: sample(), output_path: out });
    const result = await call('read_einvoice_xml', { pdf_path: out });
    expect(result.isError).toBe(false);
    expect(result.text).toContain('<rsm:CrossIndustryInvoice');
  });

  it('returns a tool error for a PDF without an invoice', async () => {
    const result = await call('read_einvoice_xml', { pdf_path: SAMPLE_PDF });
    expect(result.isError).toBe(true);
  });
});

describe('validate_einvoice', () => {
  it('returns profile, data, totals and what the PDF does not show, without the raw XML', async () => {
    const out = join(tmp(), 'out.pdf');
    await call('create_einvoice', { pdf_path: SAMPLE_PDF, invoice: sample((d) => (d.number = 'RE-2026-0043')), output_path: out });
    const result = await call('validate_einvoice', { pdf_path: out });
    const output = JSON.parse(result.text);
    expect(result.isError).toBe(false);
    expect(output).toMatchObject({
      isEInvoice: true,
      profile: 'urn:cen.eu:en16931:2017',
      invoice: { number: 'RE-2026-0043' },
      totals: { gross: 1783.81 },
      findings: [{ path: 'number', code: 'not-in-pdf' }],
    });
    expect(output).not.toHaveProperty('xml');
  });

  it('says that a plain PDF is not an e-invoice', async () => {
    const result = await call('validate_einvoice', { pdf_path: SAMPLE_PDF });
    expect(result.isError).toBe(false);
    expect(JSON.parse(result.text)).toMatchObject({ isEInvoice: false, findings: [{ severity: 'error', code: 'no-xml' }] });
  });
});
