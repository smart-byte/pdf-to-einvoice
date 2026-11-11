import { describe, expect, it } from 'vitest';
import { extractionSchema, progressOf } from '../site/answer.js';

/** An answer as the grammar makes a model write it: every key of the schema, in its order, here with two line items. */
function answerOf(schema: any = extractionSchema()): unknown {
  if (schema.type === 'object') return Object.fromEntries(Object.entries(schema.properties).map(([key, value]) => [key, answerOf(value)]));
  if (schema.type === 'array') return [answerOf(schema.items), answerOf(schema.items)];
  return null;
}

describe('progressOf: how far an answer that is still being written has come', () => {
  const answer = JSON.stringify(answerOf());
  const cuts = Array.from({ length: answer.length + 1 }, (_, length) => progressOf(answer.slice(0, length)));

  it('starts at nothing and ends at everything', () => {
    expect(cuts[0]).toEqual({ fraction: 0, line: 0 });
    expect(cuts.at(-1)).toEqual({ fraction: 1, line: 0 });
  });

  it('never goes back', () => {
    for (let i = 1; i < cuts.length; i++) expect(cuts[i]!.fraction).toBeGreaterThanOrEqual(cuts[i - 1]!.fraction);
  });

  it('counts the line items while they are written, and only then', () => {
    const lines = cuts.map((cut) => cut.line);
    expect(lines.filter((line, i) => line !== lines[i - 1])).toEqual([0, 1, 2, 0]);
    const first = answer.indexOf('"lines"');
    expect(progressOf(answer.slice(0, first)).line).toBe(0);
    expect(progressOf(answer.slice(0, answer.indexOf('"totals"') + 9)).line).toBe(0);
  });

  it('leaves most of the way to the head of the invoice and the parties, which every answer has', () => {
    const beforeLines = progressOf(answer.slice(0, answer.indexOf('"lines"'))).fraction;
    expect(beforeLines).toBeGreaterThan(0.5);
    expect(beforeLines).toBeLessThan(0.7);
  });

  it('does not ask the model for the country of delivery, which no PDF states as such', () => {
    expect(Object.keys(extractionSchema().properties)).not.toContain('deliveryCountry');
  });
});
