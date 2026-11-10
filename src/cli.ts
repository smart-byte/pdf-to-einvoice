#!/usr/bin/env node
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import type { Totals } from './calculate.js';
import { check, type Finding } from './check.js';
import { createEInvoice, InvoiceError } from './create.js';
import { guessFromText } from './guess.js';
import { invoiceJsonSchema, type InvoiceDraft } from './model.js';
import { inspectPdf, readEmbeddedXml } from './pdf.js';
import { extractLayout, extractText } from './text.js';
import { validateEInvoice, type ValidationResult } from './validate.js';

export interface Io {
  stdout: (text: string) => void;
  stderr: (text: string) => void;
}

const USAGE = `Turn an invoice PDF into an EN 16931 e-invoice (ZUGFeRD / Factur-X).

Usage:
  pdf-to-einvoice create <invoice.pdf> <data.json> [-o out.pdf] [--force]
      Write the e-invoice. Default output: <invoice>.einvoice.pdf next to the input.
  pdf-to-einvoice check <data.json> [--pdf invoice.pdf] [--json]
      Check the invoice data; with --pdf also compare it with the text of the PDF.
  pdf-to-einvoice read <invoice.pdf> [--json]
      Print the text of the PDF; with --json also guessed values and facts about the PDF.
  pdf-to-einvoice xml <einvoice.pdf>
      Print the XML embedded in an e-invoice.
  pdf-to-einvoice validate <einvoice.pdf> [--json]
      Check an existing e-invoice: its profile, its data, and whether the XML says what the PDF shows.
      A plausibility check, not a full EN 16931 validation. Exit code 1 if it is no e-invoice or has errors.
  pdf-to-einvoice schema
      Print the JSON Schema of the invoice data.
  pdf-to-einvoice mcp
      Start the MCP server on stdio.

  -h, --help       Show this help.
  -v, --version    Show the version.`;

const reason = (e: unknown) => (e instanceof Error ? e.message : String(e));
const readPdf = async (path: string) => new Uint8Array(await readFile(path));
const formatFinding = (f: Finding) => `${f.severity}${f.path ? ` ${f.path}` : ''}: ${f.message}`;

export const packageVersion = (): string => JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;

async function readJson(path: string): Promise<InvoiceDraft> {
  const text = await readFile(path, 'utf8');
  try {
    return JSON.parse(text);
  } catch (e) {
    throw new Error(`${path} is not valid JSON: ${reason(e)}`, { cause: e });
  }
}

/** The text of an invoice PDF, the values guessed from it, and what matters about the file. */
export async function describePdf(pdfPath: string) {
  const pdf = await readPdf(pdfPath);
  const info = await inspectPdf(pdf);
  const { text, blocks } = await extractLayout(pdf);
  return {
    text,
    guess: guessFromText(text, { blocks }),
    pdf: { pages: info.pages, unembeddedFonts: info.unembeddedFonts, isEInvoice: info.embeddedXml !== null },
  };
}

/** Where the e-invoice goes when no output is named: invoice.pdf becomes invoice.einvoice.pdf. */
export const defaultOutput = (pdfPath: string) => pdfPath.replace(/(\.pdf)?$/i, '.einvoice.pdf');

/** True if both paths name one file, also through a symlink or different letter case. */
function sameFile(a: string, b: string): boolean {
  if (resolve(a) === resolve(b)) return true;
  return existsSync(a) && existsSync(b) && realpathSync.native(a) === realpathSync.native(b);
}

/**
 * Creates the e-invoice and writes it to disk. Never writes over the input,
 * and over another existing file only when `overwrite` is set (the error then
 * carries the code `EEXIST`). The findings include the comparison with the
 * text of the PDF.
 */
export async function createFile(
  pdfPath: string,
  invoice: InvoiceDraft,
  outputPath = defaultOutput(pdfPath),
  overwrite = false,
): Promise<{ outputPath: string; findings: Finding[]; totals: Totals }> {
  const output = resolve(outputPath);
  if (sameFile(output, pdfPath)) throw new Error('The output path is the input PDF. Choose another output path; the input is never overwritten.');
  if (!overwrite && existsSync(output)) throw Object.assign(new Error(`${output} already exists.`), { code: 'EEXIST' });

  const pdf = await readPdf(pdfPath);
  const result = await createEInvoice({ pdf, invoice });
  await writeFile(output, result.pdf, { flag: overwrite ? 'w' : 'wx' });

  // A PDF whose text cannot be read is reported as one, not as a failure: the file is written.
  const pdfText = await extractText(pdf).catch(() => '');
  const seen = new Set(result.findings.map((f) => `${f.path}|${f.code}`));
  const compared = check(invoice, { pdfText }).findings.filter((f) => !seen.has(`${f.path}|${f.code}`));
  return { outputPath: output, findings: [...result.findings, ...compared], totals: result.totals };
}

/**
 * Validates an e-invoice on disk, comparing its XML with the text of its own pages. The raw XML is left out of the
 * result; `readEmbeddedXml` returns it.
 */
export async function validateFile(pdfPath: string): Promise<Omit<ValidationResult, 'xml'>> {
  const pdf = await readPdf(pdfPath);
  // As in createFile: a PDF whose text cannot be read is reported as one, not as a failure.
  const pdfText = await extractText(pdf).catch(() => '');
  const { xml: _xml, ...result } = await validateEInvoice(pdf, { pdfText });
  return result;
}

function printFindings({ findings, totals }: { findings: Finding[]; totals?: Totals }, io: Io): void {
  io.stdout(findings.length ? `${findings.map(formatFinding).join('\n')}\n` : 'No findings.\n');
  if (totals) io.stdout(`${(['net', 'vat', 'gross', 'due'] as const).map((key) => `${key} ${totals[key].toFixed(2)}`).join('\n')}\n`);
}

const OPTIONS = {
  output: { type: 'string', short: 'o' },
  force: { type: 'boolean' },
  pdf: { type: 'string' },
  json: { type: 'boolean' },
  help: { type: 'boolean', short: 'h' },
  version: { type: 'boolean', short: 'v' },
} as const;

type Values = { output?: string; force?: boolean; pdf?: string; json?: boolean };
type Command = { args: number; run: (args: string[], values: Values, io: Io) => Promise<number> };

const COMMANDS: Record<string, Command> = {
  create: {
    args: 2,
    async run([pdfPath, dataPath], values, io) {
      const result = await createFile(pdfPath!, await readJson(dataPath!), values.output, values.force);
      for (const finding of result.findings) io.stderr(`${formatFinding(finding)}\n`);
      io.stdout(`${result.outputPath}\n`);
      return 0;
    },
  },
  check: {
    args: 1,
    async run([dataPath], values, io) {
      const data = await readJson(dataPath!);
      const pdfText = values.pdf === undefined ? undefined : await extractText(await readPdf(values.pdf));
      const { findings, totals } = check(data, { pdfText });
      if (values.json) io.stdout(`${JSON.stringify({ findings, totals }, null, 2)}\n`);
      else printFindings({ findings, totals }, io);
      return findings.some((f) => f.severity === 'error') ? 1 : 0;
    },
  },
  read: {
    args: 1,
    async run([pdfPath], values, io) {
      const description = await describePdf(pdfPath!);
      io.stdout(`${values.json ? JSON.stringify(description, null, 2) : description.text}\n`);
      return 0;
    },
  },
  xml: {
    args: 1,
    async run([pdfPath], _values, io) {
      const xml = await readEmbeddedXml(await readPdf(pdfPath!));
      if (xml === null) throw new Error(`${pdfPath} carries no e-invoice XML.`);
      io.stdout(xml.endsWith('\n') ? xml : `${xml}\n`);
      return 0;
    },
  },
  validate: {
    args: 1,
    async run([pdfPath], values, io) {
      const result = await validateFile(pdfPath!);
      if (values.json) {
        io.stdout(`${JSON.stringify(result, null, 2)}\n`);
      } else {
        io.stdout(`${result.isEInvoice ? 'E-invoice' : 'Not an e-invoice'}${result.profile ? `, profile ${result.profile}` : ''}\n`);
        printFindings(result, io);
      }
      return result.isEInvoice && !result.findings.some((f) => f.severity === 'error') ? 0 : 1;
    },
  },
  schema: {
    args: 0,
    async run(_args, _values, io) {
      io.stdout(`${JSON.stringify(invoiceJsonSchema, null, 2)}\n`);
      return 0;
    },
  },
  mcp: {
    args: 0,
    async run() {
      // Loaded on demand so the other commands do not pay for the MCP SDK.
      await (await import('./mcp.js')).startStdio();
      return 0;
    },
  },
};

/** Runs the command line and returns the exit code: 0 done, 1 failed, 2 used wrongly. */
export async function run(argv: string[], io: Io): Promise<number> {
  const misuse = (message: string) => {
    io.stderr(`${message}\n\n${USAGE}\n`);
    return 2;
  };

  let parsed;
  try {
    parsed = parseArgs({ args: argv, allowPositionals: true, options: OPTIONS });
  } catch (e) {
    return misuse(reason(e));
  }
  const { values, positionals } = parsed;
  const [name, ...args] = positionals;
  if (values.version) {
    io.stdout(`${packageVersion()}\n`);
    return 0;
  }
  if (values.help || name === undefined) {
    io.stdout(`${USAGE}\n`);
    return 0;
  }
  if (!Object.hasOwn(COMMANDS, name)) return misuse(`Unknown command: ${name}`);
  const command = COMMANDS[name]!;
  if (args.length !== command.args) return misuse(`${name} takes ${command.args} argument(s), got ${args.length}.`);

  try {
    return await command.run(args, values, io);
  } catch (e) {
    if (e instanceof InvoiceError) {
      for (const finding of e.findings) io.stderr(`${formatFinding(finding)}\n`);
      // For invalid data the findings say it all; every other code has its cause in the message.
      if (e.code !== 'invalid-invoice') io.stderr(`error: ${e.message}\n`);
    } else if ((e as NodeJS.ErrnoException).code === 'EEXIST') {
      io.stderr(`error: ${reason(e)} Use --force to overwrite it.\n`);
    } else {
      io.stderr(`error: ${reason(e)}\n`);
    }
    return 1;
  }
}

// Run only as the program, not when imported. Both sides go through realpath because npm starts the bin via a symlink.
if (process.argv[1] && realpathSync.native(process.argv[1]) === realpathSync.native(fileURLToPath(import.meta.url))) {
  // No top-level await: `mcp` imports a module that imports this one, which must have finished loading by then.
  void run(process.argv.slice(2), { stdout: (text) => process.stdout.write(text), stderr: (text) => process.stderr.write(text) }).then((code) => {
    process.exitCode = code;
  });
}
