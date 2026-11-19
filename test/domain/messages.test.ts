import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { codeOf, message, MESSAGES } from '../../src/domain/messages.js';

const src = fileURLToPath(new URL('../../src', import.meta.url));

describe('the catalog of messages', () => {
  it('fills a text in, and names the code before the variant', () => {
    expect(message('format.number')).toBe('Not a number.');
    expect(message('not-in-pdf', { value: 'RE-1' })).toBe('"RE-1" does not appear in the PDF. Please check it.');
    expect(codeOf('format.date')).toBe('format');
    expect(codeOf('xrechnung-address.postal-code')).toBe('xrechnung-address');
  });

  it('writes every key as a code in lower case, with at most one variant', () => {
    expect(Object.keys(MESSAGES).filter((key) => !/^[a-z]+(?:-[a-z]+)*(?:\.[a-z]+(?:-[a-z]+)*)?$/.test(key))).toEqual(
      [],
    );
  });

  it('is the only place a finding gets its text: nothing in src/ builds one by hand', () => {
    // A finding built by hand would carry a code and a text the catalog, and so the German texts, know nothing of.
    const files = (readdirSync(src, { recursive: true }) as string[]).filter((file) => file.endsWith('.ts'));
    const byHand = files
      .filter((file) => file !== join('domain', 'finding.ts'))
      .filter((file) => /severity:\s*'(?:error|warning)'/.test(readFileSync(join(src, file), 'utf8')))
      .map((file) => relative(src, join(src, file)));
    expect(byHand).toEqual([]);
  });
});
