/** The text of a caught error, or of whatever else was thrown. */
export const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));
