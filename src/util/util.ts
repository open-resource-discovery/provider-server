/**
 * Returns a shallow copy of `obj` with every key whose value is `undefined` removed.
 *
 * The return type uses `Exclude<T[K], undefined>` rather than `T[K] | undefined` so that
 * the result is compatible with targets compiled under `exactOptionalPropertyTypes: true`.
 */
export function omitUndefined<T extends Record<string, unknown>>(
  obj: T,
): { [K in keyof T]?: Exclude<T[K], undefined> } {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined)) as {
    [K in keyof T]?: Exclude<T[K], undefined>;
  };
}
