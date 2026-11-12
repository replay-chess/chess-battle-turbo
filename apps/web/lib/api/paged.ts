// List responses (plan §7.2 step 9, CA AP-38). A handler returns paged(items, nextCursor, total?) and route() answers
// `{ data: items, meta: { nextCursor, total? } }`. `total` is computed only for the first page (no cursor) or a
// count-only request (limit=0), never for later pages: shouldCountTotal() is the one rule.
// A list whose contract names its own page-1 meta (P3 G1: `filteredTotal`, `counts`, phase-03 §5.10) passes it as
// `extra`; the extra keys sit after `nextCursor` and can never replace `nextCursor` or `total`.

const PAGED = Symbol.for("rc.api.paged");

export type Paged<T> = {
  readonly [PAGED]: true;
  readonly items: T[];
  readonly nextCursor: string | null;
  readonly total?: number;
  /** Contract-specific page meta (page 1 / count-only only, like `total`). */
  readonly extra?: Readonly<Record<string, unknown>>;
};

export function paged<T>(
  items: T[],
  nextCursor: string | null,
  total?: number,
  extra?: Readonly<Record<string, unknown>>,
): Paged<T> {
  const result: Paged<T> = { [PAGED]: true, items, nextCursor };
  return {
    ...result,
    ...(total === undefined ? {} : { total }),
    ...(extra === undefined ? {} : { extra }),
  };
}

export function isPaged(value: unknown): value is Paged<unknown> {
  return typeof value === "object" && value !== null && (value as Record<symbol, unknown>)[PAGED] === true;
}

/** Count the total only for the first page or a count-only request. */
export function shouldCountTotal(query: { cursor?: string | null; limit?: number | null }): boolean {
  return !query.cursor || query.limit === 0;
}

export type PagedMeta = { nextCursor: string | null; total?: number; [key: string]: unknown };

/** The envelope parts of a paged result. */
export function pagedEnvelope<T>(result: Paged<T>): { data: T[]; meta: PagedMeta } {
  const meta: PagedMeta = { nextCursor: result.nextCursor };
  if (result.total !== undefined) meta.total = result.total;
  for (const [key, value] of Object.entries(result.extra ?? {})) {
    if (key !== "nextCursor" && key !== "total" && value !== undefined) meta[key] = value;
  }
  return { data: result.items, meta };
}
