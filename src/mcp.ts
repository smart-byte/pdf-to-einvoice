import { readFile } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ErrorCode, ListToolsRequestSchema, McpError } from '@modelcontextprotocol/sdk/types.js';
import { check } from './check.js';
import { createFile, describePdf, packageVersion, validateFile } from './cli.js';
import { InvoiceError } from './create.js';
import { invoiceJsonSchema, type InvoiceDraft } from './model.js';
import { readEmbeddedXml } from './pdf.js';
import { extractText } from './text.js';

const INSTRUCTIONS = `pdf-to-einvoice turns an existing invoice PDF into an EN 16931 e-invoice (ZUGFeRD / Factur-X): the invoice data is attached to the PDF as XML, the pages stay as they are. Everything runs locally; no file is uploaded.

Workflow:
1. read_invoice_pdf: get the text of the PDF and a first guess of the labelled values.
2. Fill in the invoice data from that text (the fields are described in the input schema of check_invoice).
3. check_invoice with pdf_path: fix every error; look at every warning.
4. Show the user the data and the findings, and wait for their confirmation.
5. create_einvoice.

To check an e-invoice that already exists, issued or received, call validate_einvoice: it reads the embedded XML and reports what is missing, what does not add up and what the visible PDF does not show; it is a plausibility check, not a full EN 16931 validation, and you say so with the result.

Rules:
- You act for the invoice ISSUER (the seller). A recipient cannot make a received PDF a valid e-invoice; say so if that is what is asked.
- Copy values exactly as the PDF prints them. Never invent, guess or "correct" a value. If something is missing or unclear, ask the user.
- Always show the user the findings. A "not-in-pdf" warning means a value does not occur in the PDF text: check it.
- The XML is the legally binding part of the e-invoice and must not contradict the PDF. The user must confirm the data before create_einvoice.
- This is not tax advice. Which VAT category applies is the user's decision; ask when the PDF does not say.`;

const { $schema: _dialect, ...INVOICE_SCHEMA } = invoiceJsonSchema;
const pathSchema = (description: string) => ({ type: 'string', description: `${description} Absolute path.` });

const TOOLS = [
  {
    name: 'read_invoice_pdf',
    description:
      'Reads an invoice PDF from disk. Returns its text row by row, values guessed from labels (number, dates, bank details, tax IDs, totals; a starting point, not a result) and facts about the PDF: page count, fonts that are not embedded, and whether it already is an e-invoice.',
    annotations: { readOnlyHint: true },
    inputSchema: { type: 'object', properties: { pdf_path: pathSchema('The invoice PDF.') }, required: ['pdf_path'] },
  },
  {
    name: 'check_invoice',
    description:
      'Checks invoice data against the main EN 16931 rules (required fields, formats, arithmetic, VAT categories) and the particulars German VAT law asks for. It is not a full validator. Returns { ok, findings, totals }: errors block the e-invoice, warnings need a second look, totals are calculated from the lines. The data may be incomplete; what is missing is reported. With pdf_path, values that do not occur in the text of the PDF are reported too.',
    annotations: { readOnlyHint: true },
    inputSchema: {
      type: 'object',
      properties: { invoice: INVOICE_SCHEMA, pdf_path: pathSchema('The invoice PDF to compare the data with. Optional.') },
      required: ['invoice'],
    },
  },
  {
    name: 'create_einvoice',
    description:
      'Writes the e-invoice: a copy of the PDF as PDF/A-3 with the invoice attached as factur-x.xml (Factur-X / ZUGFeRD, profile EN 16931). The input PDF is never changed. Call it only after check_invoice reports no errors and the user has confirmed the data. Returns { output_path, findings, totals }; with errors in the data nothing is written and the findings say what to fix.',
    inputSchema: {
      type: 'object',
      properties: {
        pdf_path: pathSchema('The invoice PDF.'),
        invoice: INVOICE_SCHEMA,
        output_path: pathSchema('Where to write the e-invoice. Default: <name>.einvoice.pdf next to the input.'),
        overwrite: { type: 'boolean', description: 'Replace output_path if it exists. Default false.' },
      },
      required: ['pdf_path', 'invoice'],
    },
  },
  {
    name: 'read_einvoice_xml',
    description: 'Returns the invoice XML embedded in a ZUGFeRD / Factur-X PDF. Fails if the PDF carries none.',
    annotations: { readOnlyHint: true },
    inputSchema: { type: 'object', properties: { pdf_path: pathSchema('The e-invoice PDF.') }, required: ['pdf_path'] },
  },
  {
    name: 'validate_einvoice',
    description:
      'Checks an existing e-invoice PDF (ZUGFeRD / Factur-X), issued or received. Returns { isEInvoice, profile, invoice, totals, findings }: whether the PDF carries invoice XML in an EN 16931 profile, the data read from that XML, the totals calculated from its lines, and findings on missing data, arithmetic, PDF/A-3 and values of the XML that the text of the PDF does not show ("not-in-pdf"). A plausibility check, not a full EN 16931 Schematron or PDF/A validation.',
    annotations: { readOnlyHint: true },
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

const readPdf = async (path: string) => new Uint8Array(await readFile(path));

/** Each handler returns the result (an object, or text to pass on as it is) or throws what went wrong. */
const HANDLERS: Record<string, (args: Args) => Promise<object | string>> = {
  read_invoice_pdf: (args) => describePdf(pathArg(args, 'pdf_path')),

  async check_invoice(args) {
    const pdfText = args.pdf_path === undefined ? undefined : await extractText(await readPdf(pathArg(args, 'pdf_path')));
    const { findings, totals, invoice } = check(invoiceArg(args), { pdfText });
    return { ok: invoice !== undefined, findings, totals };
  },

  async create_einvoice(args) {
    const output = args.output_path === undefined ? undefined : pathArg(args, 'output_path');
    const result = await createFile(pathArg(args, 'pdf_path'), invoiceArg(args), output, args.overwrite === true);
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
