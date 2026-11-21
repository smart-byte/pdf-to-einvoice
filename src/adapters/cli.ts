#!/usr/bin/env node
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import type { Totals } from '../domain/calculate.js';
import type { Finding } from '../domain/finding.js';
import { invoiceJsonSchema } from '../domain/model.js';
import { createXRechnung, InvoiceError } from '../generate/create.js';
import { readEmbeddedXml } from '../pdf/file.js';
import { messageOf } from '../util/errors.js';
import {
  checkFile,
  CHOICES,
  createFile,
  createXRechnungFile,
  describePdf,
  outputExists,
  packageVersion,
  readJson,
  readPdf,
  validateFile,
} from './files.js';

export interface Io {
  stdout: (text: string) => void;
  stderr: (text: string) => void;
}

/** Runs the command line and returns the exit code: 0 done, 1 failed, 2 used wrongly. */
export async function run(argv: string[], io: Io): Promise<number> {
  const parsed = parse(argv);
  if ('wrong' in parsed) return misuse(io, parsed.wrong);
  const { name, args, values } = parsed;
  if (values.version) {
    io.stdout(`${packageVersion()}\n`);
    return 0;
  }
  if (values.help || name === undefined) {
    io.stdout(`${USAGE}\n`);
    return 0;
  }
  if (!Object.hasOwn(COMMANDS, name)) return misuse(io, `Unknown command: ${name}`);
  const command = COMMANDS[name]!;
  if (args.length !== command.args) return misuse(io, `${name} takes ${command.args} argument(s), got ${args.length}.`);
  try {
    return await command.run(args, values, io);
  } catch (e) {
    reportFailure(e, io);
    return 1;
  }
}

/** The command line read: the command, its arguments and the options; or what is wrong with it. */
function parse(
  argv: string[],
): { name?: string; args: string[]; values: Values & { help?: boolean; version?: boolean } } | { wrong: string } {
  let parsed;
  try {
    parsed = parseArgs({ args: argv, allowPositionals: true, options: OPTIONS });
  } catch (e) {
    return { wrong: messageOf(e) };
  }
  for (const [option, choices] of Object.entries(CHOICES)) {
    const value = parsed.values[option as keyof typeof CHOICES];
    if (value !== undefined && !(choices as readonly string[]).includes(value))
      return { wrong: `--${option} takes ${choices.join(' or ')}, not ${value}.` };
  }
  const [name, ...args] = parsed.positionals;
  return { name, args, values: parsed.values as Values & { help?: boolean; version?: boolean } };
}

/** Says what is wrong with the command line, with the usage below it; exit code 2. */
function misuse(io: Io, message: string): number {
  io.stderr(`${message}\n\n${USAGE}\n`);
  return 2;
}

/** Says why a command failed: what is wrong with the data, an output that exists, or the reason. */
function reportFailure(e: unknown, io: Io): void {
  if (e instanceof InvoiceError) {
    for (const finding of e.findings) io.stderr(`${formatFinding(finding)}\n`);
    // For invalid data the findings say it all; every other code has its cause in the message.
    if (e.code !== 'invalid-invoice') io.stderr(`error: ${e.message}\n`);
  } else if (outputExists(e)) {
    io.stderr(`error: ${messageOf(e)} Use --force to overwrite it.\n`);
  } else {
    io.stderr(`error: ${messageOf(e)}\n`);
  }
}

type Values = { output?: string; force?: boolean; pdf?: string; json?: boolean } & {
  [K in keyof typeof CHOICES]?: (typeof CHOICES)[K][number];
};
type Command = { args: number; run: (args: string[], values: Values, io: Io) => Promise<number> };
type Args<N extends number> = N extends 2 ? [string, string] : N extends 1 ? [string] : [];

/** A command that takes `count` arguments. `run` checks the count before `execute` gets them, so each is there. */
function defineCommand<N extends 0 | 1 | 2>(
  count: N,
  execute: (args: Args<N>, values: Values, io: Io) => Promise<number>,
): Command {
  return { args: count, run: execute as Command['run'] };
}

function printFindings({ findings, totals }: { findings: Finding[]; totals?: Totals }, io: Io): void {
  io.stdout(findings.length ? `${findings.map(formatFinding).join('\n')}\n` : 'No findings.\n');
  if (totals)
    io.stdout(
      `${(['net', 'vat', 'gross', 'due'] as const).map((key) => `${key} ${totals[key].toFixed(2)}`).join('\n')}\n`,
    );
}

function formatFinding(finding: Finding): string {
  return `${finding.severity}${finding.path ? ` ${finding.path}` : ''}: ${finding.message}`;
}

// The commands, options and usage. `run` reads them; the program below runs it when the module loads, so they stand
// above it.

const COMMANDS: Record<string, Command> = {
  create: defineCommand(2, async ([pdfPath, dataPath], values, io) => {
    const result = await createFile(pdfPath, await readJson(dataPath), {
      outputPath: values.output,
      overwrite: values.force,
      profile: values.profile,
    });
    for (const finding of result.findings) io.stderr(`${formatFinding(finding)}\n`);
    io.stdout(`${result.outputPath}\n`);
    return 0;
  }),
  xrechnung: defineCommand(1, async ([dataPath], values, io) => {
    const invoice = await readJson(dataPath);
    const result =
      values.output === undefined
        ? await createXRechnung({ invoice, syntax: values.syntax })
        : await createXRechnungFile(invoice, values.output, {
            dataPath,
            overwrite: values.force,
            syntax: values.syntax,
          });
    for (const finding of result.findings) io.stderr(`${formatFinding(finding)}\n`);
    io.stdout(`${'xml' in result ? result.xml.replace(/\n$/, '') : result.outputPath}\n`);
    return 0;
  }),
  check: defineCommand(1, async ([dataPath], values, io) => {
    const data = await readJson(dataPath);
    const { findings, totals } = await checkFile(data, { pdfPath: values.pdf, rules: values.rules });
    if (values.json) io.stdout(`${JSON.stringify({ findings, totals }, null, 2)}\n`);
    else printFindings({ findings, totals }, io);
    return findings.some((finding) => finding.severity === 'error') ? 1 : 0;
  }),
  read: defineCommand(1, async ([pdfPath], values, io) => {
    const description = await describePdf(pdfPath);
    io.stdout(`${values.json ? JSON.stringify(description, null, 2) : description.text}\n`);
    return 0;
  }),
  xml: defineCommand(1, async ([pdfPath], _values, io) => {
    const xml = await readEmbeddedXml(await readPdf(pdfPath));
    if (xml === null) throw new Error(`${pdfPath} carries no e-invoice XML.`);
    io.stdout(xml.endsWith('\n') ? xml : `${xml}\n`);
    return 0;
  }),
  validate: defineCommand(1, async ([pdfPath], values, io) => {
    const result = await validateFile(pdfPath);
    if (values.json) {
      io.stdout(`${JSON.stringify(result, null, 2)}\n`);
    } else {
      io.stdout(
        `${result.isEInvoice ? 'E-invoice' : 'Not an e-invoice'}${result.profile ? `, profile ${result.profile}` : ''}\n`,
      );
      printFindings(result, io);
    }
    return result.isEInvoice && !result.findings.some((finding) => finding.severity === 'error') ? 0 : 1;
  }),
  schema: defineCommand(0, async (_args, _values, io) => {
    io.stdout(`${JSON.stringify(invoiceJsonSchema, null, 2)}\n`);
    return 0;
  }),
  mcp: defineCommand(0, async () => {
    // Loaded on demand so the other commands do not pay for the MCP SDK.
    await (await import('./mcp.js')).startStdio();
    return 0;
  }),
};

const OPTIONS = {
  output: { type: 'string', short: 'o' },
  force: { type: 'boolean' },
  pdf: { type: 'string' },
  json: { type: 'boolean' },
  profile: { type: 'string' },
  syntax: { type: 'string' },
  rules: { type: 'string' },
  help: { type: 'boolean', short: 'h' },
  version: { type: 'boolean', short: 'v' },
} as const;

const USAGE = `Turn an invoice PDF into an EN 16931 e-invoice (ZUGFeRD / Factur-X), or invoice data into an XRechnung.

Usage:
  pdf-to-einvoice create <invoice.pdf> <data.json> [-o out.pdf] [--profile en16931|xrechnung] [--force]
      Write the e-invoice. Default output: <invoice>.einvoice.pdf next to the input.
      With --profile xrechnung the data has to meet the XRechnung rules, and the XML in the PDF declares XRechnung 3.0.
  pdf-to-einvoice xrechnung <data.json> [--syntax ubl|cii] [-o out.xml] [--force]
      Write the invoice data as an XRechnung 3.0: XML without a PDF, in UBL (default) or CII.
      Without -o the XML goes to standard output.
  pdf-to-einvoice check <data.json> [--pdf invoice.pdf] [--rules xrechnung] [--json]
      Check the invoice data; with --pdf also compare it with the text of the PDF, with --rules xrechnung also
      with what XRechnung asks for.
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
  -v, --version    Show the version.

Results go to standard output. check and validate print their findings there too (with --json as JSON);
create and xrechnung print findings to standard error, where errors go.
Exit codes: 0 done, 1 failed or the data has errors, 2 used wrongly.`;

// Run only as the program, not when imported. Both sides go through realpath because npm starts the bin via a symlink.
if (process.argv[1] && realpathSync.native(process.argv[1]) === realpathSync.native(fileURLToPath(import.meta.url))) {
  process.exitCode = await run(process.argv.slice(2), {
    stdout: (text) => process.stdout.write(text),
    stderr: (text) => process.stderr.write(text),
  });
}
