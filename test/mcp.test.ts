import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { Ajv } from 'ajv';
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
  it('offers the six tools', async () => {
    const { tools } = await (await connect()).listTools();
    expect(tools.map((t) => t.name)).toEqual([
      'read_invoice_pdf',
      'check_invoice',
      'create_einvoice',
      'create_xrechnung',
      'read_einvoice_xml',
      'validate_einvoice',
    ]);
  });

  it('shows the model every invoice field in the tool input', async () => {
    const { tools } = await (await connect()).listTools();
    const invoice = (tools.find((t) => t.name === 'create_einvoice')!.inputSchema.properties as any).invoice;
    expect(invoice.properties.seller.properties.vatId.type).toBe('string');
    expect(invoice.required).toContain('number');
  });

  it('lets a client send an incomplete invoice to check_invoice, which is there to say what is missing', async () => {
    const { tools } = await (await connect()).listTools();
    const accepts = (tool: string, input: unknown) => new Ajv({ strict: false }).validate(tools.find((t) => t.name === tool)!.inputSchema, input);
    expect(accepts('check_invoice', { invoice: { number: 'RE-1', lines: [] } })).toBe(true);
    expect(accepts('create_einvoice', { pdf_path: '/tmp/a.pdf', invoice: { number: 'RE-1', lines: [] } })).toBe(false);
  });

  it('tells clients what each tool is called and that none of them reaches beyond this machine', async () => {
    const { tools } = await (await connect()).listTools();
    for (const tool of tools) {
      expect(tool.title, tool.name).toBeTruthy();
      expect(tool.annotations?.openWorldHint, tool.name).toBe(false);
    }
    const create = tools.find((t) => t.name === 'create_einvoice')!;
    expect(create.annotations).toMatchObject({ readOnlyHint: false, destructiveHint: false });
  });

  it('is described for the MCP Registry under the name and version of the package', () => {
    const read = (name: string) => JSON.parse(readFileSync(new URL(`../${name}`, import.meta.url), 'utf8'));
    const [manifest, entry] = [read('package.json'), read('server.json')];
    expect(entry.name).toBe(manifest.mcpName);
    expect(entry.version).toBe(manifest.version);
    expect(entry.packages).toEqual([expect.objectContaining({ registryType: 'npm', identifier: manifest.name, version: manifest.version })]);
    expect(entry.description.length).toBeLessThanOrEqual(100);
  });

  it('tells the model to act for the issuer and not to invent values', async () => {
    const instructions = (await connect()).getInstructions();
    expect(instructions).toMatch(/issuer/i);
    expect(instructions).toMatch(/never invent/i);
    // The tools send nothing, but the assistant that reads through them may: it must not promise more than holds for it.
    expect(instructions).not.toMatch(/everything runs locally/i);
    expect(instructions).toMatch(/if your model runs elsewhere, the content of the invoice goes there/i);
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

describe('XRechnung', () => {
  const XRECHNUNG_3_0 = 'urn:cen.eu:en16931:2017#compliant#urn:xeinkauf.de:kosit:xrechnung_3.0';
  /** The sample with what XRechnung asks for on top. */
  const xrechnung = () =>
    sample((d) => {
      d.buyerReference = '99000000-BEISPIEL-00';
      Object.assign(d.seller, { contactName: 'Erika Muster', phone: '+49 30 1234567' });
      d.buyer.email = 'einkauf@beispiel.example';
    });

  it('tells the model when XRechnung is asked for and what it takes', async () => {
    const instructions = (await connect()).getInstructions();
    expect(instructions).toContain('create_xrechnung');
    expect(instructions).toMatch(/Leitweg-ID/);
  });

  it('names the choices of the new options in the tool inputs', async () => {
    const { tools } = await (await connect()).listTools();
    const properties = (name: string) => tools.find((t) => t.name === name)!.inputSchema.properties as any;
    expect(properties('check_invoice').rules.enum).toEqual(['xrechnung']);
    expect(properties('create_einvoice').profile.enum).toEqual(['en16931', 'xrechnung']);
    expect(properties('create_xrechnung').syntax.enum).toEqual(['ubl', 'cii']);
    const create = tools.find((t) => t.name === 'create_xrechnung')!;
    expect(create.inputSchema.required).toEqual(['invoice', 'output_path']);
    expect(create.annotations).toMatchObject({ readOnlyHint: false, destructiveHint: false, openWorldHint: false });
  });

  describe('check_invoice with rules', () => {
    it('reports what XRechnung asks for on top', async () => {
      const output = JSON.parse((await call('check_invoice', { invoice: sample(), rules: 'xrechnung' })).text);
      expect(output.ok).toBe(false);
      expect(output.findings.map((f: { code: string }) => f.code)).toEqual([
        'xrechnung-buyer-reference',
        'xrechnung-seller-contact',
        'xrechnung-seller-phone',
        'xrechnung-buyer-email',
      ]);
    });

    it('accepts data that has it', async () => {
      const output = JSON.parse((await call('check_invoice', { invoice: xrechnung(), rules: 'xrechnung' })).text);
      expect(output).toMatchObject({ ok: true, findings: [] });
    });

    it('refuses rules it does not know', async () => {
      const result = await call('check_invoice', { invoice: sample(), rules: 'peppol' });
      expect(result.isError).toBe(true);
      expect(result.text).toContain('rules');
    });
  });

  describe('create_einvoice with profile', () => {
    it('writes a PDF whose XML declares XRechnung 3.0', async () => {
      const out = join(tmp(), 'out.pdf');
      const result = await call('create_einvoice', { pdf_path: SAMPLE_PDF, invoice: xrechnung(), output_path: out, profile: 'xrechnung' });
      expect(result.isError).toBe(false);
      expect(await readEmbeddedXml(new Uint8Array(readFileSync(out)))).toContain(`<ram:ID>${XRECHNUNG_3_0}</ram:ID>`);
    });

    it('returns what XRechnung lacks as a tool error and writes nothing', async () => {
      const out = join(tmp(), 'out.pdf');
      const result = await call('create_einvoice', { pdf_path: SAMPLE_PDF, invoice: sample(), output_path: out, profile: 'xrechnung' });
      expect(result.isError).toBe(true);
      expect(JSON.parse(result.text)).toMatchObject({
        error: 'invalid-invoice',
        findings: [{ path: 'buyerReference', code: 'xrechnung-buyer-reference' }, {}, {}, {}],
      });
      expect(existsSync(out)).toBe(false);
    });

    it('refuses a profile it does not know', async () => {
      const out = join(tmp(), 'out.pdf');
      const result = await call('create_einvoice', { pdf_path: SAMPLE_PDF, invoice: sample(), output_path: out, profile: 'extended' });
      expect(result.isError).toBe(true);
      expect(result.text).toContain('profile');
      expect(existsSync(out)).toBe(false);
    });
  });

  describe('create_xrechnung', () => {
    it('writes the XML file and returns where', async () => {
      const out = join(tmp(), 'out.xml');
      const result = await call('create_xrechnung', { invoice: xrechnung(), output_path: out });
      expect(result.isError).toBe(false);
      expect(JSON.parse(result.text)).toEqual({ output_path: out, findings: [], totals: expect.objectContaining({ due: 1783.81 }) });
      const xml = readFileSync(out, 'utf8');
      expect(xml).toContain('<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"');
      expect(xml).toContain(`<cbc:CustomizationID>${XRECHNUNG_3_0}</cbc:CustomizationID>`);
    });

    it('writes a Cross Industry Invoice when asked for the syntax cii', async () => {
      const out = join(tmp(), 'out.xml');
      await call('create_xrechnung', { invoice: xrechnung(), output_path: out, syntax: 'cii' });
      expect(readFileSync(out, 'utf8')).toContain('<rsm:CrossIndustryInvoice');
    });

    it('returns the findings as a tool error for data XRechnung does not accept and writes nothing', async () => {
      const out = join(tmp(), 'out.xml');
      const result = await call('create_xrechnung', { invoice: sample(), output_path: out });
      expect(result.isError).toBe(true);
      expect(JSON.parse(result.text)).toMatchObject({ error: 'invalid-invoice', findings: [{ path: 'buyerReference', severity: 'error' }, {}, {}, {}] });
      expect(existsSync(out)).toBe(false);
    });

    it('leaves an existing file alone unless asked to overwrite it', async () => {
      const out = join(tmp(), 'out.xml');
      writeFileSync(out, 'keep me');
      const refused = await call('create_xrechnung', { invoice: xrechnung(), output_path: out });
      expect(refused.isError).toBe(true);
      expect(refused.text).toContain('overwrite');
      expect(readFileSync(out, 'utf8')).toBe('keep me');
      const forced = await call('create_xrechnung', { invoice: xrechnung(), output_path: out, overwrite: true });
      expect(forced.isError).toBe(false);
      expect(readFileSync(out, 'utf8')).toContain('<cbc:ID>RE-2026-0042</cbc:ID>');
    });

    it('refuses a relative output path, a missing one and a syntax it does not know', async () => {
      expect((await call('create_xrechnung', { invoice: xrechnung(), output_path: 'out.xml' })).text).toContain('absolute');
      expect((await call('create_xrechnung', { invoice: xrechnung() })).isError).toBe(true);
      const out = join(tmp(), 'out.xml');
      const result = await call('create_xrechnung', { invoice: xrechnung(), output_path: out, syntax: 'edifact' });
      expect(result.isError).toBe(true);
      expect(result.text).toContain('syntax');
      expect(existsSync(out)).toBe(false);
    });
  });
});
