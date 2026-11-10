import { invoiceJsonSchema, type InvoiceDraft } from '../src/model.js';

/** In-browser models offered by default: permissively licensed (Apache-2.0 / MIT) and small enough to download. */
export const MODELS = [
  { id: 'Qwen2.5-1.5B-Instruct-q4f16_1-MLC', note: { de: 'schnell, ca. 1 GB', en: 'fast, about 1 GB' } },
  { id: 'Qwen3-4B-q4f16_1-MLC', note: { de: 'genauer, ca. 2,5 GB', en: 'more accurate, about 2.5 GB' } },
  { id: 'Phi-3.5-mini-instruct-q4f16_1-MLC', note: { de: 'Alternative, ca. 2,2 GB', en: 'alternative, about 2.2 GB' } },
] as const;
export const DEFAULT_MODEL = MODELS[0].id;

export interface Endpoint {
  url: string;
  model: string;
  key?: string;
}

// Known limit: the invoice text is cut to fit the 4096-token context the prebuilt models ship with. Long invoices
// lose their tail; raise `context_window_size` (more graphics memory) or read page by page if that matters.
const MAX_TEXT = 7000;

const RULES = `You read invoices. Extract the data of the invoice below as JSON.
Rules:
- Copy values exactly as printed. Use null for anything the invoice does not state. Never invent a value.
- The seller issued the invoice (their name is usually in the letterhead or footer, next to bank details and tax IDs). The buyer is the recipient in the address field.
- Dates as YYYY-MM-DD. Numbers as plain JSON numbers with a dot as decimal separator.
- country: two-letter ISO code (Germany = DE, Austria = AT, USA = US). currency: ISO code (EUR, USD).
- unitPrice is the net price of one unit. vatRate is the percentage, e.g. 19.
- vatCategory: S when VAT is charged; AE reverse charge; K intra-community supply; G export of goods; O not subject to VAT (e.g. services for customers outside the EU); E exempt (e.g. small business). For anything but S, vatRate is 0 and vatExemptionReason is the printed sentence that explains it.
- unit: C62 piece, HUR hour, DAY day, MON month, KGM kilogram, LS lump sum.
- totals are the sums printed on the invoice.`;

// Fields a model is not asked for: nothing on the page lets the answer be verified, so a person fills them in.
const NOT_ASKED = new Set([
  'typeCode',
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
function extractionSchema(schema: any = invoiceJsonSchema): any {
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

const prompt = (text: string) => `${RULES}\n\nInvoice text:\n"""\n${text.slice(0, MAX_TEXT)}\n"""`;

function parse(json: string | null | undefined): InvoiceDraft {
  const start = json?.indexOf('{') ?? -1;
  if (!json || start < 0) throw new Error('The model returned no data.');
  return JSON.parse(json.slice(start, json.lastIndexOf('}') + 1));
}

let engine: { id: string; instance: any } | undefined;

/** Reads the invoice with a model running in this browser (WebGPU). The model is downloaded once and cached. */
export async function readWithBrowserModel(text: string, modelId: string, onProgress: (fraction: number) => void): Promise<InvoiceDraft> {
  const { CreateWebWorkerMLCEngine } = await import('@mlc-ai/web-llm');
  if (engine?.id !== modelId) {
    await engine?.instance.unload();
    const worker = new Worker(new URL('./llm-worker.ts', import.meta.url), { type: 'module' });
    engine = { id: modelId, instance: await CreateWebWorkerMLCEngine(worker, modelId, { initProgressCallback: (report) => onProgress(report.progress) }) };
  }
  onProgress(1);
  const reply = await engine.instance.chat.completions.create({
    messages: [{ role: 'user', content: prompt(text) }],
    temperature: 0,
    max_tokens: 1500,
    response_format: { type: 'json_object', schema: JSON.stringify(extractionSchema()) },
  });
  return parse(reply.choices[0]?.message.content);
}

/** Reads the invoice with any OpenAI-compatible chat endpoint the user runs or trusts, e.g. Ollama on localhost. */
export async function readWithEndpoint(text: string, endpoint: Endpoint): Promise<InvoiceDraft> {
  const response = await fetch(`${endpoint.url.replace(/\/+$/, '')}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(endpoint.key ? { Authorization: `Bearer ${endpoint.key}` } : {}) },
    body: JSON.stringify({
      model: endpoint.model,
      temperature: 0,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: `${RULES}\nAnswer with one JSON object that follows this JSON Schema:\n${JSON.stringify(extractionSchema())}` },
        { role: 'user', content: `Invoice text:\n"""\n${text}\n"""` },
      ],
    }),
  });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  return parse((await response.json()).choices?.[0]?.message?.content);
}

export const hasWebGpu = () => 'gpu' in navigator;
