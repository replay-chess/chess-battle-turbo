// Filter normalisation for query keys (CDL §3.3 rule 3): one object at the end of the key, empty values
// dropped and keys sorted, so `{ theme: "fork" }` and `{ phase: undefined, theme: "fork" }` share a cache entry.

export type FilterValue = string | number | boolean | null | undefined;
export type Filters = Record<string, FilterValue>;

/** Drops `undefined`, `null` and `""`, sorts the keys. Never mutates its input. */
export function norm<F extends Filters>(f: F): Partial<F> {
  return Object.fromEntries(
    Object.entries(f)
      .filter(([, v]) => v !== undefined && v !== null && v !== "")
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
  ) as Partial<F>;
}
