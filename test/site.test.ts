import { existsSync, readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

// The library that writes the XML looks for a catalogue of translations in the language it is called with, in a
// browser by a request to the site. It ships none, so the site answers with an empty one: without it, creating an
// e-invoice ends in a failed request and an error in the console.
it('the site ships the catalogue the XML library asks for', () => {
  const language = /\blang = '([a-z]+)'/.exec(readFileSync(new URL('../src/create.ts', import.meta.url), 'utf8'))?.[1];
  expect(language).toBe('en');
  const file = new URL(`../site/public/assets/locale/${language}/LC_MESSAGES/e-invoice-eu.mo.json`, import.meta.url);
  expect(existsSync(file)).toBe(true);
  expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({ major: 0, minor: 0, entries: {} });
});
