// Review queries (phase-03 plan §5.1, §5.2, §5.7). Keys only from `qk.review`; responses through api() with the
// schema check written at the call site (`NODE_ENV === "production" ? undefined : Schema`), so zod stays out of the
// production chunks (AP-12). 304s are transparent (`private, no-cache` + a strong ETag; the browser revalidates).
//
// Freshness: the payload is immutable once `done` or `skipped` (and for a terminal failure), so `staleTime` is
// Infinity there and 0 while the analysis can still change. A2 is always 0 (the fallback poller, the game-over card).
// The legend comparison is Infinity once `ready`, 0 while the evals are pending.
import type { LegendCompareDTO } from "@repo/contracts/http/legend";
import { LegendCompareDTO as LegendCompareSchema } from "@repo/contracts/http/legend";
import type { ReviewDTO, ReviewStatusDTO } from "@repo/contracts/http/review";
import { ReviewDTO as ReviewSchema, ReviewStatusDTO as ReviewStatusSchema } from "@repo/contracts/http/review";
import { queryOptions } from "@tanstack/react-query";
import { api } from "../client";
import { endpoints } from "../endpoints";
import { qk } from "../keys";

/** `"/api/review/{ref}/…"` → the path for one game (refs are cuids; encoded anyway). */
export function reviewApiPath(path: string, ref: string, ply?: number): string {
  const filled = path.replace("{ref}", encodeURIComponent(ref));
  return ply === undefined ? filled : filled.replace("{ply}", String(ply));
}

/** The annotated PGN download link (`<a href download>`; `private, no-store`, attachment). */
export function reviewPgnHref(ref: string): string {
  return reviewApiPath(endpoints.reviewPgn, ref);
}

/** True once the payload cannot change any more: done, skipped, or a failure with no retry left. */
export function isSettledReview(d: Pick<ReviewDTO, "status" | "analysis"> | undefined): boolean {
  if (!d) return false;
  if (d.status === "done" || d.status === "skipped") return true;
  return d.status === "failed" && d.analysis?.failure?.retryable === false;
}

export async function fetchReview(ref: string, signal?: AbortSignal): Promise<ReviewDTO> {
  const schema = process.env.NODE_ENV === "production" ? undefined : ReviewSchema;
  const { data } = await api(reviewApiPath(endpoints.review, ref), { schema, signal });
  return data as ReviewDTO;
}

export async function fetchReviewStatus(ref: string, signal?: AbortSignal): Promise<ReviewStatusDTO> {
  const schema = process.env.NODE_ENV === "production" ? undefined : ReviewStatusSchema;
  const { data } = await api(reviewApiPath(endpoints.reviewStatus, ref), { schema, signal });
  return data as ReviewStatusDTO;
}

export async function fetchLegendCompare(
  ref: string,
  options: { includeExplanation?: boolean; signal?: AbortSignal } = {},
): Promise<LegendCompareDTO> {
  const schema = process.env.NODE_ENV === "production" ? undefined : LegendCompareSchema;
  const { data } = await api(reviewApiPath(endpoints.reviewLegend, ref), {
    schema,
    signal: options.signal,
    query: options.includeExplanation ? { include: "explanation" } : undefined,
  });
  return data as LegendCompareDTO;
}

/** A1, seeded by the review RSC (no fetch on mount). */
export function reviewQuery(ref: string) {
  return queryOptions({
    queryKey: qk.review.detail(ref),
    queryFn: ({ signal }): Promise<ReviewDTO> => fetchReview(ref, signal),
    staleTime: (query) => (isSettledReview(query.state.data as ReviewDTO | undefined) ? Infinity : 0),
    refetchOnWindowFocus: (query) => !isSettledReview(query.state.data as ReviewDTO | undefined),
    meta: { object: "the review" },
  });
}

/** A2: the fallback poller and the game-over card (seeded from `game:result.review` or the bot `complete` answer). */
export function reviewStatusQuery(ref: string) {
  return queryOptions({
    queryKey: qk.review.status(ref),
    queryFn: ({ signal }): Promise<ReviewStatusDTO> => fetchReviewStatus(ref, signal),
    staleTime: 0,
    refetchOnWindowFocus: false,
    meta: { object: "the analysis status" },
  });
}

/** A9 without the explanation (the compare RSC seeds it; hover prefetch is safe: A9 queues nothing). */
export function legendCompareQuery(ref: string) {
  return queryOptions({
    queryKey: qk.review.legend(ref),
    queryFn: ({ signal }): Promise<LegendCompareDTO> => fetchLegendCompare(ref, { signal }),
    staleTime: (query) => ((query.state.data as LegendCompareDTO | undefined)?.status === "ready" ? Infinity : 0),
    refetchOnWindowFocus: false,
    meta: { object: "the legend comparison" },
  });
}

/** A9 `?include=explanation`, fetched only while the Explanation tab is active (~20 KB of authored narration). */
export function legendExplanationQuery(ref: string) {
  return queryOptions({
    queryKey: [...qk.review.legend(ref), "explanation"] as const,
    queryFn: ({ signal }): Promise<LegendCompareDTO> => fetchLegendCompare(ref, { includeExplanation: true, signal }),
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    meta: { object: "the legend's explanation" },
  });
}
