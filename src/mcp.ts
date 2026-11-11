import { readFile } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ErrorCode, ListToolsRequestSchema, McpError } from '@modelcontextprotocol/sdk/types.js';
import { check } from './check.js';
import { CHOICES, createFile, createXRechnungFile, describePdf, packageVersion, validateFile } from './cli.js';
import { InvoiceError } from './create.js';
import { invoiceJsonSchema, type InvoiceDraft } from './model.js';
import { readEmbeddedXml } from './pdf.js';
import { extractText } from './text.js';

const INSTRUCTIONS = `pdf-to-einvoice turns an existing invoice PDF into an EN 16931 e-invoice (ZUGFeRD / Factur-X): the invoice data is attached to the PDF as XML, the pages stay as they are. It also writes the data as an XRechnung, the XML German public bodies ask for. The tools run on the user's machine and send nothing. What you read through them is yours to handle: if your model runs elsewhere, the content of the invoice goes there, so do not tell the user that it stays on their machine unless that holds for you.

Workflow:
1. read_invoice_pdf: get the text of the PDF and a first guess of the values (parties, line items, totals and more).
2. Fill in the invoice data from that text (the fields are described in the input schema of check_invoice).
3. check_invoice with pdf_path: fix every error; look at every warning.
4. Show the user the data and the findings, and wait for their confirmation.
5. create_einvoice.

XRechnung (version 3.0) is for an invoice to a German public body, or for a user who asks for it by name; do not choose it on your own. It takes more data: the buyer reference (the Leitweg-ID, which the public body names), a contact at the seller with phone number and e-mail address, and an e-mail address of the buyer. In step 3 pass rules "xrechnung" to check_invoice. In step 5 call create_xrechnung for the XML alone (UBL, or CII if asked for), or create_einvoice with profile "xrechnung" for a PDF that carries that XML. Ask the user for what is missing; a Leitweg-ID is never made up.

To check an e-invoice that already exists, issued or received, call validate_einvoice: it reads the embedded XML and reports what is missing, what does not add up and what the visible PDF does not show; it is a plausibility check, not a full EN 16931 validation, and you say so with the result.

Rules:
- You act for the invoice ISSUER (the seller). A recipient cannot make a received PDF a valid e-invoice; say so if that is what is asked.
- Copy values exactly as the PDF prints them. Never invent, guess or "correct" a value. If something is missing or unclear, ask the user.
- Always show the user the findings. A "not-in-pdf" warning means a value does not occur in the PDF text: check it.
- The XML is the legally binding part of the e-invoice and must not contradict the PDF. The user must confirm the data before create_einvoice or create_xrechnung.
- This is not tax or legal advice. Which VAT category applies is the user's decision; ask when the PDF does not say.`;

const { $schema: _dialect, ...INVOICE_SCHEMA } = invoiceJsonSchema;
/** The same schema for a draft: nothing is required, so an incomplete invoice can be sent to learn what it lacks. */
const optional = (schema: any): any =>
  Array.isArray(schema)
    ? schema.map(optional)
    : schema && typeof schema === 'object'
      ? Object.fromEntries(
          Object.entries(schema)
            .filter(([key]) => key !== 'required' && key !== 'minItems')
            .map(([key, value]) => [key, optional(value)]),
        )
      : schema;
const DRAFT_SCHEMA = optional(INVOICE_SCHEMA);
// No tool reaches beyond this machine: files are read and written locally, nothing is sent anywhere.
const READS = { readOnlyHint: true, openWorldHint: false };
// A tool that creates writes one new file and replaces nothing unless `overwrite` is set.
const WRITES = { readOnlyHint: false, destructiveHint: false, openWorldHint: false };
const pathSchema = (description: string) => ({ type: 'string', description: `${description} Absolute path.` });
const choiceSchema = (key: keyof typeof CHOICES, description: string) => ({ type: 'string', enum: CHOICES[key], description });

const TOOLS = [
  {
    name: 'read_invoice_pdf',
    title: 'Read an invoice PDF',
    description:
      'Reads an invoice PDF from disk. Returns its text row by row, values found by pattern (number, dates, parties, line items, totals, payment terms, bank details, tax IDs; a starting point, not a result) and facts about the PDF: page count, fonts that are not embedded, and whether it is already an e-invoice.',
    annotations: READS,
    inputSchema: { type: 'object', properties: { pdf_path: pathSchema('The invoice PDF.') }, required: ['pdf_path'] },
  },
  {
    name: 'check_invoice',
    title: 'Check invoice data',
    description:
      'Checks invoice data against the main EN 16931 rules (required fields, formats, arithmetic, VAT categories) and the particulars German VAT law asks for. It is not a full validator. Returns { ok, findings, totals }: errors block the e-invoice, warnings need a second look, totals are calculated from the lines. The data may be incomplete; what is missing is reported. With pdf_path, values that do not occur in the text of the PDF are reported too. With rules "xrechnung", what XRechnung 3.0 asks for beyond EN 16931 is reported too, under codes that start with "xrechnung-".',
    annotations: READS,
    inputSchema: {
      type: 'object',
      properties: {
        invoice: DRAFT_SCHEMA,
        pdf_path: pathSchema('The invoice PDF to compare the data with. Optional.'),
        rules: choiceSchema('rules', 'Further rules to check the data against. Optional.'),
      },
      required: ['invoice'],
    },
  },
  {
    name: 'create_einvoice',
    title: 'Create the e-invoice',
    description:
      'Writes the e-invoice: a copy of the PDF as PDF/A-3 with the invoice attached as factur-x.xml (Factur-X / ZUGFeRD, profile EN 16931). The input PDF is never changed. Call it only after check_invoice reports no errors and the user has confirmed the data. Returns { output_path, findings, totals }; with errors in the data nothing is written and the findings say what to fix. With profile "xrechnung" the data has to meet the XRechnung rules as well (check_invoice with rules "xrechnung"), and the attached XML is xrechnung.xml, which declares XRechnung 3.0.',
    annotations: WRITES,
    inputSchema: {
      type: 'object',
      properties: {
        pdf_path: pathSchema('The invoice PDF.'),
        invoice: INVOICE_SCHEMA,
        output_path: pathSchema('Where to write the e-invoice. Default: <name>.einvoice.pdf next to the input.'),
        overwrite: { type: 'boolean', description: 'Replace output_path if it exists. Default false.' },
        profile: choiceSchema('profile', 'The profile of the XML. Default en16931.'),
      },
      required: ['pdf_path', 'invoice'],
    },
  },
  {
    name: 'create_xrechnung',
    title: 'Create an XRechnung',
    description:
      'Writes the invoice data as an XRechnung 3.0, the XML German public bodies ask for: one XML file, without a PDF. Call it only after check_invoice with rules "xrechnung" reports no errors and the user has confirmed the data. Returns { output_path, findings, totals }; with errors in the data nothing is written and the findings say what to fix.',
    annotations: WRITES,
    inputSchema: {
      type: 'object',
      properties: {
        invoice: INVOICE_SCHEMA,
        output_path: pathSchema('Where to write the XML file.'),
        syntax: choiceSchema('syntax', 'The XML syntax: ubl (default) or cii, UN/CEFACT Cross Industry Invoice. XRechnung allows both.'),
        overwrite: { type: 'boolean', description: 'Replace output_path if it exists. Default false.' },
      },
      required: ['invoice', 'output_path'],
    },
  },
  {
    name: 'read_einvoice_xml',
    title: 'Read the XML of an e-invoice',
    description: 'Returns the invoice XML embedded in a ZUGFeRD / Factur-X PDF. Fails if the PDF carries none.',
    annotations: READS,
    inputSchema: { type: 'object', properties: { pdf_path: pathSchema('The e-invoice PDF.') }, required: ['pdf_path'] },
  },
  {
    name: 'validate_einvoice',
    title: 'Check an existing e-invoice',
    description:
      'Checks an existing e-invoice PDF (ZUGFeRD / Factur-X), issued or received. Returns { isEInvoice, profile, invoice, totals, findings }: whether the PDF carries invoice XML in an EN 16931 profile, the data read from that XML, the totals calculated from its lines, and findings on missing data, arithmetic, PDF/A-3 and values of the XML that the text of the PDF does not show ("not-in-pdf"). A plausibility check, not a full EN 16931 Schematron or PDF/A validation.',
    annotations: READS,
    inputSchema: { type: 'object', properties: { pdf_path: pathSchema('The e-invoice PDF.') }, required: ['pdf_path'] },
  },
];

type Args = Record<string, unknown>;

function pathArg(args: Args, key: string): string {
  const value = args[key];
  if (typeof value !== 'string' || !isAbsolute(value)) throw new Error(`${key} must be an absolute file path.`);
  return value;
}

function invoiceArg(args: Args): InvoiceDraft {
  const value = args.invoice;
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('invoice must be an object holding the invoice data.');
  return value as InvoiceDraft;
}

/** An optional argument that takes one of a few words. */
function choiceArg<K extends keyof typeof CHOICES>(args: Args, key: K): (typeof CHOICES)[K][number] | undefined {
  const value = args[key];
  if (value !== undefined && !(CHOICES[key] as readonly unknown[]).includes(value)) throw new Error(`${key} must be ${CHOICES[key].join(' or ')}.`);
  return value as (typeof CHOICES)[K][number] | undefined;
}

const readPdf = async (path: string) => new Uint8Array(await readFile(path));

/** Each handler returns the result (an object, or text to pass on as it is) or throws what went wrong. */
const HANDLERS: Record<string, (args: Args) => Promise<object | string>> = {
  read_invoice_pdf: (args) => describePdf(pathArg(args, 'pdf_path')),

  async check_invoice(args) {
    const rules = choiceArg(args, 'rules');
    const pdfText = args.pdf_path === undefined ? undefined : await extractText(await readPdf(pathArg(args, 'pdf_path')));
    const { findings, totals, invoice } = check(invoiceArg(args), { pdfText, rules });
    return { ok: invoice !== undefined, findings, totals };
  },

  async create_einvoice(args) {
    const output = args.output_path === undefined ? undefined : pathArg(args, 'output_path');
    const result = await createFile(pathArg(args, 'pdf_path'), invoiceArg(args), output, args.overwrite === true, choiceArg(args, 'profile'));
    return { output_path: result.outputPath, findings: result.findings, totals: result.totals };
  },

  async create_xrechnung(args) {
    const result = await createXRechnungFile(invoiceArg(args), pathArg(args, 'output_path'), choiceArg(args, 'syntax'), args.overwrite === true);
    return { output_path: result.outputPath, findings: result.findings, totals: result.totals };
  },

  async read_einvoice_xml(args) {
    const xml = await readEmbeddedXml(await readPdf(pathArg(args, 'pdf_path')));
    if (xml === null) throw new Error('This PDF carries no e-invoice XML.');
    return xml;
  },

  validate_einvoice: (args) => validateFile(pathArg(args, 'pdf_path')),
};

/** What the model gets to read when a tool fails: enough to fix the call. */
function describeError(e: unknown): object {
  if (e instanceof InvoiceError) return { error: e.code, message: e.message, findings: e.findings };
  const message = e instanceof Error ? e.message : String(e);
  if ((e as NodeJS.ErrnoException).code === 'EEXIST') return { error: `${message} Pass "overwrite": true to replace it, or choose another output_path.` };
  return { error: message };
}

const asText = (result: object | string) => ({
  content: [{ type: 'text' as const, text: typeof result === 'string' ? result : JSON.stringify(result, null, 2) }],
});

/** The MCP server, not yet connected to a transport. */
export function createServer(): Server {
  const server = new Server({ name: 'pdf-to-einvoice', version: packageVersion() }, { capabilities: { tools: {} }, instructions: INSTRUCTIONS });

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

  server.setRequestHandler(CallToolRequestSchema, async ({ params }) => {
    if (!Object.hasOwn(HANDLERS, params.name)) throw new McpError(ErrorCode.InvalidParams, `Unknown tool: ${params.name}`);
    try {
      return asText(await HANDLERS[params.name]!(params.arguments ?? {}));
    } catch (e) {
      return { ...asText(describeError(e)), isError: true };
    }
  });

  return server;
}

/** Serves on stdin/stdout until the client closes the connection. */
export async function startStdio(): Promise<void> {
  await createServer().connect(new StdioServerTransport());
}
