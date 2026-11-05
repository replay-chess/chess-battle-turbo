// List responses (plan §7.2 step 9, CA AP-38). A handler returns paged(items, nextCursor, total?) and route() answers
// `{ data: items, meta: { nextCursor, total? } }`. `total` is computed only for the first page (no cursor) or a
// count-only request (limit=0), never for later pages: shouldCountTotal() is the one rule.

const PAGED = Symbol.for("rc.api.paged");

export type Paged<T> = {
  readonly [PAGED]: true;
  readonly items: T[];
  readonly nextCursor: string | null;
  readonly total?: number;
};

export function paged<T>(items: T[], nextCursor: string | null, total?: number): Paged<T> {
  const result: Paged<T> = { [PAGED]: true, items, nextCursor };
  return total === undefined ? result : { ...result, total };
}

export function isPaged(value: unknown): value is Paged<unknown> {
  return typeof value === "object" && value !== null && (value as Record<symbol, unknown>)[PAGED] === true;
}

/** Count the total only for the first page or a count-only request. */
export function shouldCountTotal(query: { cursor?: string | null; limit?: number | null }): boolean {
  return !query.cursor || query.limit === 0;
}

/** The envelope parts of a paged result. */
export function pagedEnvelope<T>(result: Paged<T>): { data: T[]; meta: { nextCursor: string | null; total?: number } } {
  const meta: { nextCursor: string | null; total?: number } = { nextCursor: result.nextCursor };
  if (result.total !== undefined) meta.total = result.total;
  return { data: result.items, meta };
}
