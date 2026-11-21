import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { codeOf } from '../../src/domain/finding.js';
import { message } from '../../src/domain/messages.js';
import { message as generateMessage } from '../../src/generate/messages.js';
import { allKeys, CATALOGS } from './catalogs.js';

const src = fileURLToPath(new URL('../../src', import.meta.url));

describe('the catalogs of messages', () => {
  it('fills a text in, and names the code before the variant', () => {
    expect(message('format.number')).toBe('Not a number.');
    expect(message('not-in-pdf', { value: 'RE-1' })).toBe('"RE-1" does not appear in the PDF. Please check it.');
    expect(codeOf('format.date')).toBe('format');
    expect(codeOf('xrechnung-address.postal-code')).toBe('xrechnung-address');
  });

  it('writes every key as a code in lower case, with at most one variant', () => {
    expect(allKeys().filter((key) => !/^[a-z]+(?:-[a-z]+)*(?:\.[a-z]+(?:-[a-z]+)*)?$/.test(key))).toEqual([]);
  });

  it('has each key in one catalog only', () => {
    expect(allKeys().filter((key, i, keys) => keys.indexOf(key) !== i)).toEqual([]);
  });

  it('lists the catalog of every layer that has one', () => {
    const layers = (readdirSync(src, { recursive: true }) as string[])
      .filter((file) => file.endsWith(join('/', 'messages.ts')))
      .map((file) => file.split('/')[0]);
    expect(layers.sort()).toEqual(Object.keys(CATALOGS).sort());
  });

  it('leaves what is said about a file to the layers that read and write files', () => {
    // The domain knows nothing of files: no text of its catalog is about a PDF/A, an embedded XML or the generator.
    const aboutFiles = /^(?:pdf-|xml-|no-xml|profile|generator|invalid-|already-|not-written)/;
    expect(Object.keys(CATALOGS.domain!).filter((key) => aboutFiles.test(key))).toEqual([]);
    expect(generateMessage('already-einvoice')).toBe('This PDF already carries an e-invoice.');
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
