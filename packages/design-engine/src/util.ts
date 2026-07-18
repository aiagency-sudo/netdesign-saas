/** Looks up `key` in a Map or Record and throws with `context` if it's missing — for lookups that are logically guaranteed but not statically provable (e.g. noUncheckedIndexedAccess). */
export function mustGet<T>(source: Map<string, T> | Record<string, T>, key: string, context: string): T {
  const value = source instanceof Map ? source.get(key) : source[key];
  if (value === undefined) {
    throw new Error(`Internal error: missing ${context} for "${key}".`);
  }
  return value;
}
