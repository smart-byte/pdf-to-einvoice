// What the command line and the MCP server both do with files on disk: read them, create e-invoices from them and
// write the results, never over the input.
import { existsSync, readFileSync, statSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { Totals } from '../domain/calculate.js';
import type { Finding } from '../domain/finding.js';
import type { InvoiceDraft } from '../domain/model.js';
import { guessFromText } from '../extract/guess.js';
import { createEInvoice, createXRechnung, type CreateOptions, type XRechnungOptions } from '../generate/create.js';
import { validateEInvoice, type ValidationResult } from '../inspect/validate.js';
import { inspectPdf } from '../pdf/file.js';
import { extractLayout, extractText } from '../pdf/text.js';
export const reason = (e: unknown) => (e instanceof Error ? e.message : String(e));
export const readPdf = async (path: string) => new Uint8Array(await readFile(path));

export const packageVersion = (): string =>
  JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')).version;

export async function readJson(path: string): Promise<InvoiceDraft> {
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

/** True if both paths name one file, also through a symlink, a hard link or different letter case. */
export function sameFile(a: string, b: string): boolean {
  if (resolve(a) === resolve(b)) return true;
  if (!existsSync(a) || !existsSync(b)) return false;
  const [one, other] = [statSync(a, { bigint: true }), statSync(b, { bigint: true })];
  return one.dev === other.dev && one.ino === other.ino;
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
  profile?: CreateOptions['profile'],
): Promise<{ outputPath: string; findings: Finding[]; totals: Totals }> {
  const output = resolve(outputPath);
  if (sameFile(output, pdfPath))
    throw new Error('The output path is the input PDF. Choose another output path; the input is never overwritten.');
  if (!overwrite && existsSync(output)) throw Object.assign(new Error(`${output} already exists.`), { code: 'EEXIST' });

  const result = await createEInvoice({ pdf: await readPdf(pdfPath), invoice, profile });
  await writeFile(output, result.pdf, { flag: overwrite ? 'w' : 'wx' });
  return { outputPath: output, findings: result.findings, totals: result.totals };
}

/**
 * Writes the invoice as an XRechnung XML file, over an existing file only when `overwrite` is set (the error then
 * carries the code `EEXIST`).
 */
export async function createXRechnungFile(
  invoice: InvoiceDraft,
  outputPath: string,
  syntax?: XRechnungOptions['syntax'],
  overwrite = false,
): Promise<{ outputPath: string; findings: Finding[]; totals: Totals }> {
  const output = resolve(outputPath);
  if (!overwrite && existsSync(output)) throw Object.assign(new Error(`${output} already exists.`), { code: 'EEXIST' });
  const result = await createXRechnung({ invoice, syntax });
  await writeFile(output, result.xml, { flag: overwrite ? 'w' : 'wx' });
  return { outputPath: output, findings: result.findings, totals: result.totals };
}

/**
 * Validates an e-invoice on disk, comparing its XML with the text of its own pages. The raw XML is left out of the
 * result; `readEmbeddedXml` returns it.
 */
export async function validateFile(pdfPath: string): Promise<Omit<ValidationResult, 'xml'>> {
  const pdf = await readPdf(pdfPath);
  // As in createEInvoice: a PDF whose text cannot be read is reported as one, not as a failure.
  const pdfText = await extractText(pdf).catch(() => '');
  const { xml: _xml, ...result } = await validateEInvoice(pdf, { pdfText });
  return result;
}

/** The options that take one of a few words, here and as arguments of the MCP tools. */
export const CHOICES = { profile: ['en16931', 'xrechnung'], syntax: ['ubl', 'cii'], rules: ['xrechnung'] } as const;
