import { MESSAGES as DOMAIN } from '../../src/domain/messages.js';
import { MESSAGES as GENERATE } from '../../src/generate/messages.js';
import { MESSAGES as INSPECT } from '../../src/inspect/messages.js';

/** The catalog of each layer that words findings, by the name of the layer. */
export const CATALOGS: Record<string, Record<string, unknown>> = {
  domain: DOMAIN,
  generate: GENERATE,
  inspect: INSPECT,
};

/** Every key of every catalog. */
export const allKeys = (): string[] => Object.values(CATALOGS).flatMap((texts) => Object.keys(texts));
