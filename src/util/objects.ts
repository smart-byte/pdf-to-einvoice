/** The value at a path of keys and indices, such as `lines.0.unitPrice`; undefined where the path leads nowhere. */
export const valueAt = (data: unknown, path: string): unknown =>
  path
    .split('.')
    .reduce<unknown>((value, key) => (value == null ? undefined : (value as Record<string, unknown>)[key]), data);
