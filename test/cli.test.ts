import { copyFileSync, existsSync, linkSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { run } from '../src/cli.js';
import { readEmbeddedXml } from '../src/pdf.js';

const example = (name: string) => fileURLToPath(new URL(`../examples/${name}`, import.meta.url));
const SAMPLE_PDF = example('sample-invoice.pdf');
const SAMPLE_JSON = example('sample-invoice.json');
const tmp = () => mkdtempSync(join(tmpdir(), 'pdf-to-einvoice-cli-'));

/** Runs the CLI in-process and collects what it prints. */
async function cli(...argv: string[]) {
  let stdout = '';
  let stderr = '';
  const code = await run(argv, { stdout: (s) => (stdout += s), stderr: (s) => (stderr += s) });
  return { code, stdout, stderr };
}

/** Writes the sample data with one change applied and returns the path of the file. */
function dataWith(change: (draft: any) => void): string {
  const draft = JSON.parse(readFileSync(SAMPLE_JSON, 'utf8'));
  change(draft);
  const path = join(tmp(), 'data.json');
  writeFileSync(path, JSON.stringify(draft));
  return path;
}

const embeddedXml = (path: string) => readEmbeddedXml(new Uint8Array(readFileSync(path)));

describe('create', () => {
  it('writes a PDF that carries the invoice as XML and prints its path', async () => {
    const out = join(tmp(), 'out.pdf');
    const result = await cli('create', SAMPLE_PDF, SAMPLE_JSON, '-o', out);
    expect(result).toEqual({ code: 0, stdout: `${out}\n`, stderr: '' });
    expect(await embeddedXml(out)).toContain('<ram:ID>RE-2026-0042</ram:ID>');
  });

  it('writes next to the input as <name>.einvoice.pdf when no output is given', async () => {
    const input = join(tmp(), 'invoice.pdf');
    copyFileSync(SAMPLE_PDF, input);
    const result = await cli('create', input, SAMPLE_JSON);
    expect(result.stdout).toBe(`${input.replace(/\.pdf$/, '.einvoice.pdf')}\n`);
    expect(existsSync(input.replace(/\.pdf$/, '.einvoice.pdf'))).toBe(true);
  });

  it('refuses to overwrite an existing file', async () => {
    const out = join(tmp(), 'out.pdf');
    writeFileSync(out, 'keep me');
    const result = await cli('create', SAMPLE_PDF, SAMPLE_JSON, '-o', out);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain('--force');
    expect(readFileSync(out, 'utf8')).toBe('keep me');
  });

  it('overwrites an existing file with --force', async () => {
    const out = join(tmp(), 'out.pdf');
    writeFileSync(out, 'replace me');
    expect((await cli('create', SAMPLE_PDF, SAMPLE_JSON, '-o', out, '--force')).code).toBe(0);
    expect(await embeddedXml(out)).toContain('RE-2026-0042');
  });

  it('never writes over the input PDF through a hard link to it, even with --force', async () => {
    const dir = tmp();
    const input = join(dir, 'invoice.pdf');
    const link = join(dir, 'other-name.pdf');
    copyFileSync(SAMPLE_PDF, input);
    linkSync(input, link);
    const result = await cli('create', input, SAMPLE_JSON, '-o', link, '--force');
    expect(result.code).toBe(1);
    expect(readFileSync(input).equals(readFileSync(SAMPLE_PDF))).toBe(true);
  });

  it('never writes over the input PDF, even with --force', async () => {
    const input = join(tmp(), 'invoice.pdf');
    copyFileSync(SAMPLE_PDF, input);
    const result = await cli('create', input, SAMPLE_JSON, '-o', input, '--force');
    expect(result.code).toBe(1);
    expect(readFileSync(input).equals(readFileSync(SAMPLE_PDF))).toBe(true);
  });

  it('reports the errors in the data and writes nothing', async () => {
    const out = join(tmp(), 'out.pdf');
    const result = await cli(
      'create',
      SAMPLE_PDF,
      dataWith((d) => delete d.number),
      '-o',
      out,
    );
    expect(result.code).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('error number: The invoice number is missing.');
    expect(existsSync(out)).toBe(false);
  });

  it('warns about a value the PDF does not show, and still creates the file', async () => {
    const out = join(tmp(), 'out.pdf');
    const result = await cli(
      'create',
      SAMPLE_PDF,
      dataWith((d) => (d.dueDate = '2026-11-18')),
      '-o',
      out,
    );
    expect(result.code).toBe(0);
    expect(result.stderr).toContain('warning dueDate:');
    expect(existsSync(out)).toBe(true);
  });

  it('reports a file that is not a PDF', async () => {
    const result = await cli('create', SAMPLE_JSON, SAMPLE_JSON, '-o', join(tmp(), 'out.pdf'));
    expect(result.code).toBe(1);
    expect(result.stderr).toContain('could not be read as a PDF');
  });
});

describe('check', () => {
  it('prints the calculated totals of valid data and exits 0', async () => {
    const result = await cli('check', SAMPLE_JSON);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('gross 1783.81');
  });

  it('prints the path of each finding and exits 1 when there is an error', async () => {
    const result = await cli(
      'check',
      dataWith((d) => delete d.seller.name),
    );
    expect(result.code).toBe(1);
    expect(result.stdout).toContain('error seller.name:');
  });

  it('exits 0 when only warnings are open', async () => {
    const result = await cli(
      'check',
      dataWith((d) => delete d.buyer.street),
    );
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('warning buyer.street:');
  });

  it('compares the data with the PDF given by --pdf', async () => {
    const result = await cli(
      'check',
      dataWith((d) => (d.number = 'RE-2026-0043')),
      '--pdf',
      SAMPLE_PDF,
    );
    expect(result.stdout).toContain('warning number: "RE-2026-0043" does not appear in the PDF.');
  });

  it('prints findings and totals as JSON with --json', async () => {
    const result = await cli(
      'check',
      dataWith((d) => delete d.buyer.street),
      '--json',
    );
    const output = JSON.parse(result.stdout);
    expect(output.findings).toMatchObject([{ path: 'buyer.street', severity: 'warning' }]);
    expect(output.totals.gross).toBe(1783.81);
  });
});

describe('read', () => {
  it('prints the text of the PDF', async () => {
    const result = await cli('read', SAMPLE_PDF);
    expect(result.code).toBe(0);
    expect(result.stdout).toMatch(/Gesamtbetrag\s+1\.783,81 €/);
  });

  it('prints text, guessed values and PDF facts as JSON with --json', async () => {
    const output = JSON.parse((await cli('read', SAMPLE_PDF, '--json')).stdout);
    expect(output.text).toContain('RE-2026-0042');
    expect(output.guess.number).toBe('RE-2026-0042');
    expect(output.pdf).toEqual({ pages: 1, unembeddedFonts: [], isEInvoice: false });
  });
});

describe('xml', () => {
  it('prints the XML of an e-invoice', async () => {
    const out = join(tmp(), 'out.pdf');
    await cli('create', SAMPLE_PDF, SAMPLE_JSON, '-o', out);
    const result = await cli('xml', out);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('<rsm:CrossIndustryInvoice');
  });

  it('exits 1 for a PDF without an invoice', async () => {
    const result = await cli('xml', SAMPLE_PDF);
    expect(result.code).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('no e-invoice XML');
  });
});

describe('validate', () => {
  it('prints the profile and the totals of an e-invoice and exits 0', async () => {
    const out = join(tmp(), 'out.pdf');
    await cli('create', SAMPLE_PDF, SAMPLE_JSON, '-o', out);
    const result = await cli('validate', out);
    expect(result.code).toBe(0);
    expect(result.stdout).toBe('E-invoice, profile urn:cen.eu:en16931:2017\nNo findings.\nnet 1499.00\nvat 284.81\ngross 1783.81\ndue 1783.81\n');
    const output = JSON.parse((await cli('validate', out, '--json')).stdout);
    expect(output).toMatchObject({ isEInvoice: true, findings: [], invoice: { number: 'RE-2026-0042' }, totals: { gross: 1783.81 } });
    expect(output).not.toHaveProperty('xml');
  });

  it('compares the XML with the text of the PDF', async () => {
    const out = join(tmp(), 'out.pdf');
    await cli(
      'create',
      SAMPLE_PDF,
      dataWith((d) => (d.number = 'RE-2026-0043')),
      '-o',
      out,
    );
    const result = await cli('validate', out);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('warning number: "RE-2026-0043" does not appear in the PDF.');
  });

  it('exits 1 for a PDF that carries no invoice XML', async () => {
    const result = await cli('validate', SAMPLE_PDF);
    expect(result.code).toBe(1);
    expect(result.stdout).toMatch(/^Not an e-invoice\nerror: .*no invoice XML/);
  });
});

describe('schema', () => {
  it('prints the JSON Schema of the invoice data', async () => {
    const schema = JSON.parse((await cli('schema')).stdout);
    expect(schema.properties.number.type).toBe('string');
  });
});

describe('usage', () => {
  it('prints the usage and exits 0 for --help and for no arguments', async () => {
    for (const argv of [['--help'], []]) {
      const result = await cli(...argv);
      expect(result.code).toBe(0);
      expect(result.stdout).toContain('pdf-to-einvoice create');
    }
  });

  it('prints the package version for --version', async () => {
    const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
    expect((await cli('--version')).stdout).toBe(`${version}\n`);
  });

  it('exits 2 with the usage on stderr for an unknown command', async () => {
    const result = await cli('convert', SAMPLE_PDF);
    expect(result.code).toBe(2);
    expect(result.stderr).toContain('pdf-to-einvoice create');
  });

  it('exits 2 when an argument is missing', async () => {
    expect((await cli('create', SAMPLE_PDF)).code).toBe(2);
  });

  it('exits 2 for an option it does not know', async () => {
    expect((await cli('check', SAMPLE_JSON, '--nope')).code).toBe(2);
  });
});

describe('XRechnung', () => {
  const XRECHNUNG_3_0 = 'urn:cen.eu:en16931:2017#compliant#urn:xeinkauf.de:kosit:xrechnung_3.0';
  /** The sample data with what XRechnung asks for on top, as a file. */
  const xrechnungData = (change: (draft: any) => void = () => {}) =>
    dataWith((d) => {
      d.buyerReference = '99000000-BEISPIEL-00';
      Object.assign(d.seller, { contactName: 'Erika Muster', phone: '+49 30 1234567' });
      d.buyer.email = 'einkauf@beispiel.example';
      change(d);
    });

  describe('xrechnung', () => {
    it('prints the invoice as UBL that declares XRechnung 3.0', async () => {
      const result = await cli('xrechnung', xrechnungData());
      expect(result.code).toBe(0);
      expect(result.stderr).toBe('');
      expect(result.stdout).toMatch(/^<\?xml[^\n]*\n<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"/);
      expect(result.stdout).toContain(`<cbc:CustomizationID>${XRECHNUNG_3_0}</cbc:CustomizationID>`);
      expect(result.stdout.endsWith('</Invoice>\n')).toBe(true);
    });

    it('prints a Cross Industry Invoice with --syntax cii', async () => {
      const result = await cli('xrechnung', xrechnungData(), '--syntax', 'cii');
      expect(result.code).toBe(0);
      expect(result.stdout).toContain('<rsm:CrossIndustryInvoice');
      expect(result.stdout).toContain(`<ram:ID>${XRECHNUNG_3_0}</ram:ID>`);
    });

    it('writes the XML to the file named by -o and prints its path', async () => {
      const out = join(tmp(), 'out.xml');
      const result = await cli('xrechnung', xrechnungData(), '-o', out);
      expect(result).toEqual({ code: 0, stdout: `${out}\n`, stderr: '' });
      expect(readFileSync(out, 'utf8')).toContain('<cbc:ID>RE-2026-0042</cbc:ID>');
    });

    it('leaves an existing file alone unless --force is given', async () => {
      const out = join(tmp(), 'out.xml');
      writeFileSync(out, 'keep me');
      const refused = await cli('xrechnung', xrechnungData(), '-o', out);
      expect(refused.code).toBe(1);
      expect(refused.stderr).toContain('--force');
      expect(readFileSync(out, 'utf8')).toBe('keep me');
      expect((await cli('xrechnung', xrechnungData(), '-o', out, '--force')).code).toBe(0);
      expect(readFileSync(out, 'utf8')).toContain('<cbc:ID>RE-2026-0042</cbc:ID>');
    });

    it('never writes over the data it reads, even with --force', async () => {
      const data = xrechnungData();
      const before = readFileSync(data, 'utf8');
      const result = await cli('xrechnung', data, '-o', data, '--force');
      expect(result.code).toBe(1);
      expect(readFileSync(data, 'utf8')).toBe(before);
    });

    it('says what XRechnung lacks in the data and prints no XML', async () => {
      const result = await cli('xrechnung', SAMPLE_JSON);
      expect(result.code).toBe(1);
      expect(result.stdout).toBe('');
      expect(result.stderr).toContain('error buyerReference: XRechnung needs the buyer reference');
      expect(result.stderr).toContain('error seller.phone:');
    });

    it('prints warnings to standard error, next to the XML on standard output', async () => {
      const result = await cli(
        'xrechnung',
        xrechnungData((d) => delete d.buyer.street),
      );
      expect(result.code).toBe(0);
      expect(result.stderr).toContain('warning buyer.street:');
      expect(result.stdout).toContain('<Invoice ');
    });

    it('exits 2 for a syntax it does not know', async () => {
      const result = await cli('xrechnung', xrechnungData(), '--syntax', 'edifact');
      expect(result.code).toBe(2);
      expect(result.stderr).toContain('--syntax');
    });
  });

  describe('create --profile xrechnung', () => {
    it('writes a PDF whose XML declares XRechnung 3.0', async () => {
      const out = join(tmp(), 'out.pdf');
      const result = await cli('create', SAMPLE_PDF, xrechnungData(), '-o', out, '--profile', 'xrechnung');
      expect(result).toEqual({ code: 0, stdout: `${out}\n`, stderr: '' });
      expect(await embeddedXml(out)).toContain(`<ram:ID>${XRECHNUNG_3_0}</ram:ID>`);
    });

    it('applies the XRechnung rules and writes nothing while they are not met', async () => {
      const out = join(tmp(), 'out.pdf');
      const result = await cli('create', SAMPLE_PDF, SAMPLE_JSON, '-o', out, '--profile', 'xrechnung');
      expect(result.code).toBe(1);
      expect(result.stderr).toContain('error buyerReference:');
      expect(existsSync(out)).toBe(false);
    });

    it('writes the EN 16931 profile when asked for it by name', async () => {
      const out = join(tmp(), 'out.pdf');
      expect((await cli('create', SAMPLE_PDF, SAMPLE_JSON, '-o', out, '--profile', 'en16931')).code).toBe(0);
      expect(await embeddedXml(out)).toContain('<ram:ID>urn:cen.eu:en16931:2017</ram:ID>');
    });

    it('exits 2 for a profile it does not know', async () => {
      const out = join(tmp(), 'out.pdf');
      const result = await cli('create', SAMPLE_PDF, SAMPLE_JSON, '-o', out, '--profile', 'extended');
      expect(result.code).toBe(2);
      expect(result.stderr).toContain('--profile');
      expect(existsSync(out)).toBe(false);
    });
  });

  describe('check --rules xrechnung', () => {
    it('reports what XRechnung asks for on top and exits 1', async () => {
      const result = await cli('check', SAMPLE_JSON, '--rules', 'xrechnung');
      expect(result.code).toBe(1);
      expect(result.stdout).toContain('error buyerReference: XRechnung needs the buyer reference');
    });

    it('exits 0 for data that has it, also as JSON', async () => {
      expect((await cli('check', xrechnungData(), '--rules', 'xrechnung')).stdout).toMatch(/^No findings\./);
      const result = await cli('check', SAMPLE_JSON, '--rules', 'xrechnung', '--json');
      expect(JSON.parse(result.stdout).findings.map((f: { code: string }) => f.code)).toContain('xrechnung-buyer-email');
    });

    it('exits 2 for rules it does not know', async () => {
      const result = await cli('check', SAMPLE_JSON, '--rules', 'peppol');
      expect(result.code).toBe(2);
      expect(result.stderr).toContain('--rules');
    });
  });

  it('is part of the usage', async () => {
    const { stdout } = await cli('--help');
    expect(stdout).toContain('pdf-to-einvoice xrechnung <data.json> [--syntax ubl|cii] [-o out.xml]');
    expect(stdout).toContain('--profile en16931|xrechnung');
    expect(stdout).toContain('--rules xrechnung');
  });
});
