/** The value at a path of keys and indices, such as `lines.0.unitPrice`; undefined where the path leads nowhere. */
export const valueAt = (data: unknown, path: string): unknown =>
  path
    .split('.')
    .reduce<unknown>((value, key) => (value == null ? undefined : (value as Record<string, unknown>)[key]), data);

/** Whether a value is an object, a list as well, and not null. */
export function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** An object as it is; anything else as an empty one, which holds none of the fields asked for. */
export function recordOf(value: unknown): Record<string, unknown> {
  return isObject(value) ? value : {};
}

/** Whether a value is an object without a single key. A list is none, also an empty one. */
export function isEmptyObject(value: unknown): boolean {
  return isObject(value) && !Array.isArray(value) && Object.keys(value).length === 0;
}
