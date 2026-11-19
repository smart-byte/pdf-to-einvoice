/** `text` written so that a regular expression matches it literally: "1.5" matches "1.5" and not "105". */
export const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
