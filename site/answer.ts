// What a language model is asked for and how far its answer has come. Nothing here touches the browser.
import { invoiceJsonSchema } from '../src/model.js';

const NOT_ASKED = new Set([
  'typeCode',
  // No PDF states a country of delivery as such, and nothing is assumed about the delivery.
  'deliveryCountry',
  'buyerReference',
  'orderReference',
  'precedingInvoiceNumber',
  'precedingInvoiceDate',
  'note',
  'prepaidAmount',
  'periodStart',
  'periodEnd',
  'contactName',
  'phone',
  'description',
  'netAmount',
]);

/** The invoice schema as a grammar for the model: every key present, every value nullable, nothing a small grammar engine may not know. */
export function extractionSchema(schema: any = invoiceJsonSchema): any {
  if (schema.type === 'object') {
    const properties = Object.fromEntries(
      Object.entries(schema.properties)
        .filter(([key]) => !NOT_ASKED.has(key))
        .map(([key, value]) => [key, extractionSchema(value)]),
    );
    return { type: 'object', properties, required: Object.keys(properties), additionalProperties: false };
  }
  if (schema.type === 'array') return { type: 'array', items: extractionSchema(schema.items) };
  return schema.enum ? { enum: [...schema.enum, null] } : { type: [schema.type, 'null'] };
}

/** The keys of the answer: those before the line items (with `lines` itself), those of one line item, and those after. */
const KEYS = (() => {
  const count = (schema: any): number =>
    schema.type === 'object' ? Object.values(schema.properties).reduce((n: number, value) => n + 1 + count(value), 0) : 0;
  const { lines, ...rest } = extractionSchema().properties;
  const names = Object.keys(rest);
  const split = Object.keys(extractionSchema().properties).indexOf('lines');
  const part = (keys: string[]) => keys.reduce((n, key) => n + 1 + count(rest[key]), 0);
  return { before: part(names.slice(0, split)) + 1, line: count(lines.items), after: part(names.slice(split)) };
})();
const KEY = /"[A-Za-z]+"\s*:/g;

/**
 * How far an answer that is still being written has come. The grammar makes the model name every key of the schema
 * in its order: first the head of the invoice and the parties, then the line items, last the totals. The head counts
 * for six tenths of the way, key by key. How many line items follow nobody knows, so each one takes a share of what
 * is left of the next three tenths, and `line` says which one is being written (0 outside of them). The totals are
 * the last tenth.
 */
export function progressOf(answer: string): { fraction: number; line: number } {
  const written = (text: string) => text.match(KEY)?.length ?? 0;
  const totals = answer.lastIndexOf('"totals"');
  if (totals >= 0)
    return { fraction: answer.trimEnd().endsWith('}}') ? 1 : 0.9 + 0.1 * Math.min(1, written(answer.slice(totals)) / (KEYS.after + 1)), line: 0 };
  const keys = written(answer);
  if (keys <= KEYS.before) return { fraction: (0.6 * keys) / KEYS.before, line: 0 };
  const line = Math.ceil((keys - KEYS.before) / KEYS.line);
  return { fraction: 0.6 + 0.3 * (1 - 0.7 ** line), line };
}
