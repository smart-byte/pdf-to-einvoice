/** The value at a path of keys and indices, such as `lines.0.unitPrice`; undefined where the path leads nowhere. */
export const valueAt = (data: unknown, path: string): unknown =>
  path
    .split('.')
    .reduce<unknown>((value, key) => (value == null ? undefined : (value as Record<string, unknown>)[key]), data);

/** Whether a value is an object, a list as well, and not null. */
export function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
