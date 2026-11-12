import { defineEndpoint } from "../endpoint";
import {
  LegendCompareDTO,
  LegendCompareQuery,
  LegendComputeBody,
  LegendComputeResponse,
} from "../legend";
import {
  AnalyseBody,
  AnalyseResponse,
  AnnotatedPgnText,
  CompleteOut,
  MomentBankBody,
  MomentBankResponse,
  MomentParams,
  PROGRESS_BODY_MAX_BYTES,
  ProgressBody,
  RetryBody,
  RetryResponse,
  ReviewDTO,
  ReviewRefParams,
  ReviewStatusDTO,
} from "../review";

/** `review-analyse` (A3, A4, A9b) and `review-write` (A5, A6, A7) buckets (phase-03 plan §7.2). */
export const REVIEW_ANALYSE_LIMIT = { bucket: "review-analyse", limit: 10, windowSec: 60, by: "user" } as const;
export const REVIEW_WRITE_LIMIT = { bucket: "review-write", limit: 120, windowSec: 60, by: "user" } as const;

/**
 * `{}` bodies (A4, A7, A9b) and A3's body also accept an empty request body: Finish Review is a `keepalive` fetch
 * with no body (§5.2), and a client may POST without one. Unknown keys are still a 400 (strict).
 */
const EmptyBody = RetryBody.default({});
const AnalyseBodyOrEmpty = AnalyseBody.default({ reason: "opened" });
const LegendComputeBodyOrEmpty = LegendComputeBody.default({});

/**
 * Phase-03 plan §7.2 A1–A9b. Handlers: WEB/app/api/review/[ref]/** (WP-D).
 *
 * The reads (A1, A2, A8, A9) are `auth: "user"` and answer 402 from the handler (`requireReviewReader`), the
 * games.detail pattern: with the flag `review-lapsed-read` on, a lapsed member may still read (B26, P3-Q1). With the
 * flag off (the default) the answer is exactly `auth: "member"`'s. Every write is `auth: "member"`.
 * Non-players get 404 (masking); a non-player admin reads, and the writes are 204 no-ops for them.
 * GETs never enqueue engine work (P3-D23): their only writes are the declared `kick_cas` / `legend_facts`.
 */
export const reviewEndpoints = {
  /** A1. The review payload; ETag from the one-statement probe, so a 304 runs one statement. */
  get: defineEndpoint({
    id: "review.get",
    method: "GET",
    path: "/api/review/{ref}",
    auth: "user",
    class: "R2",
    cache: "private-etag",
    sideEffects: ["kick_cas"],
    params: ReviewRefParams,
    response: ReviewDTO,
    errors: ["subscription_required"],
    summary: "The game review of one of the viewer's games",
  }),
  /** A2. The small status shape (fallback poller, game-over card, legend block). */
  status: defineEndpoint({
    id: "review.status",
    method: "GET",
    path: "/api/review/{ref}/status",
    auth: "user",
    class: "R1",
    cache: "private-etag",
    sideEffects: ["kick_cas", "legend_facts"],
    params: ReviewRefParams,
    response: ReviewStatusDTO,
    errors: ["subscription_required"],
    summary: "The analysis status of one of the viewer's games",
  }),
  /** A3. Enqueues an unanalysed game (or a regrade) at USER_OPENED and kicks the worker with `watch`. */
  analyse: defineEndpoint({
    id: "review.analyse",
    method: "POST",
    path: "/api/review/{ref}/analyse",
    auth: "member",
    class: "W2",
    cache: "no-store",
    rateLimit: REVIEW_ANALYSE_LIMIT,
    params: ReviewRefParams,
    body: AnalyseBodyOrEmpty,
    response: AnalyseResponse,
    status: 202,
    errors: ["conflict", "gone"],
    maxBodyBytes: 1_024,
    summary: "Starts the analysis of a game",
  }),
  /** A4. Pulls a failed (retryable) job forward; attempts are not reset. */
  retry: defineEndpoint({
    id: "review.retry",
    method: "POST",
    path: "/api/review/{ref}/retry",
    auth: "member",
    class: "W2",
    cache: "no-store",
    rateLimit: REVIEW_ANALYSE_LIMIT,
    params: ReviewRefParams,
    body: EmptyBody,
    response: RetryResponse,
    status: 202,
    errors: ["conflict", "gone"],
    maxBodyBytes: 1_024,
    summary: "Retries a failed analysis",
  }),
  /** A5. Walkthrough progress (JSON, or text/plain JSON from keepalive/beacon). Monotonic merge, 204. */
  progress: defineEndpoint({
    id: "review.progress",
    method: "PATCH",
    path: "/api/review/{ref}/progress",
    auth: "member",
    class: "W1",
    cache: "no-store",
    rateLimit: REVIEW_WRITE_LIMIT,
    params: ReviewRefParams,
    body: ProgressBody,
    status: 204,
    errors: ["conflict"],
    maxBodyBytes: PROGRESS_BODY_MAX_BYTES,
    summary: "Records walkthrough progress",
  }),
  /** A6. Mistake Bank opt-out per moment (UI hidden until P5). Set semantics. */
  moment: defineEndpoint({
    id: "review.moment",
    method: "PATCH",
    path: "/api/review/{ref}/moments/{ply}",
    auth: "member",
    class: "W1",
    cache: "no-store",
    rateLimit: REVIEW_WRITE_LIMIT,
    params: MomentParams,
    body: MomentBankBody,
    response: MomentBankResponse,
    errors: ["conflict"],
    maxBodyBytes: 1_024,
    summary: "Keeps a key moment in or out of the Mistake Bank",
  }),
  /** A7. Finish Review: completedAt once; a replay answers the same body. */
  complete: defineEndpoint({
    id: "review.complete",
    method: "POST",
    path: "/api/review/{ref}/complete",
    auth: "member",
    class: "W1",
    cache: "no-store",
    rateLimit: REVIEW_WRITE_LIMIT,
    params: ReviewRefParams,
    body: EmptyBody,
    response: CompleteOut,
    errors: ["conflict"],
    maxBodyBytes: 1_024,
    summary: "Marks the review walkthrough complete",
  }),
  /** A8. The annotated PGN as a download (`private, no-store`, attachment). */
  pgn: defineEndpoint({
    id: "review.pgn",
    method: "GET",
    path: "/api/review/{ref}/pgn",
    auth: "user",
    class: "R1",
    cache: "no-store",
    params: ReviewRefParams,
    response: AnnotatedPgnText,
    responseFormat: "text",
    errors: ["subscription_required", "conflict"],
    summary: "Downloads the annotated PGN of a reviewed game",
  }),
  /** A9. Compare with the legend; inserts the derived facts row lazily, never enqueues. */
  legend: defineEndpoint({
    id: "review.legend",
    method: "GET",
    path: "/api/review/{ref}/legend",
    auth: "user",
    class: "R2",
    cache: "private-etag",
    sideEffects: ["legend_facts"],
    params: ReviewRefParams,
    query: LegendCompareQuery,
    response: LegendCompareDTO,
    errors: ["subscription_required"],
    summary: "The legend comparison of a game from a legend position",
  }),
  /** A9b. Queues LEGEND_COMPARE (≤ 3 attempts per comparison, then 410). */
  legendCompute: defineEndpoint({
    id: "review.legend.compute",
    method: "POST",
    path: "/api/review/{ref}/legend/compute",
    auth: "member",
    class: "W2",
    cache: "no-store",
    rateLimit: REVIEW_ANALYSE_LIMIT,
    params: ReviewRefParams,
    body: LegendComputeBodyOrEmpty,
    response: LegendComputeResponse,
    status: 202,
    errors: ["conflict", "gone"],
    maxBodyBytes: 1_024,
    summary: "Computes the engine evals of a legend comparison",
  }),
} as const;
