"use client";
// Review mutations (phase-03 plan §5.2, §5.7, §7.2 A3–A7, A9b). The request functions are plain async functions so
// the review screen can drive its own optimistic cache updates (features/review/useReviewData.ts); the hooks below
// wrap the ones that need nothing but the standard invalidation. Every write is `no-store` and member-only (402 goes
// to /pricing through the QueryProvider).
//
// - A5 progress is fire-and-forget: `keepalive` on pagehide / visibilitychange so the last batch survives a tab close.
// - A7 Finish Review is a `keepalive` POST with no body, then the complete page; it marks the archive stale.
import type { LegendComputeResponse } from "@repo/contracts/http/legend";
import { LegendComputeResponse as LegendComputeSchema } from "@repo/contracts/http/legend";
import type {
  AnalyseBodyInput,
  AnalyseResponse,
  CompleteOut,
  MomentBankResponse,
  ProgressBody,
  RetryResponse,
} from "@repo/contracts/http/review";
import {
  AnalyseResponse as AnalyseSchema,
  CompleteOut as CompleteOutSchema,
  MomentBankResponse as MomentBankSchema,
  RetryResponse as RetrySchema,
} from "@repo/contracts/http/review";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../client";
import { endpoints } from "../endpoints";
import { qk } from "../keys";
import { reviewApiPath } from "../queries/review";

/** A3: queue the analysis (reason `opened`) or an engine-free regrade. 202 queued|running, 200 done. */
export async function analyseReviewRequest(ref: string, body: AnalyseBodyInput = {}): Promise<AnalyseResponse> {
  const { data } = await api(reviewApiPath(endpoints.reviewAnalyse, ref), {
    method: "POST",
    body,
    schema: process.env.NODE_ENV === "production" ? undefined : AnalyseSchema,
  });
  return data as AnalyseResponse;
}

/** A4: retry a failed analysis (resumes from its last checkpoint). */
export async function retryReviewRequest(ref: string): Promise<RetryResponse> {
  const { data } = await api(reviewApiPath(endpoints.reviewRetry, ref), {
    method: "POST",
    body: {},
    schema: process.env.NODE_ENV === "production" ? undefined : RetrySchema,
  });
  return data as RetryResponse;
}

/** A5: one batch of walkthrough events (≤ 50); `keepalive` for the pagehide flush. 204. */
export async function sendReviewProgress(ref: string, body: ProgressBody, options: { keepalive?: boolean } = {}): Promise<void> {
  await api(reviewApiPath(endpoints.reviewProgress, ref), { method: "PATCH", body, keepalive: options.keepalive });
}

/** A6: keep a key moment in (or out of) the Mistake Bank. */
export async function setMomentBankRequest(ref: string, ply: number, inBank: boolean): Promise<MomentBankResponse> {
  const { data } = await api(reviewApiPath(endpoints.reviewMoment, ref, ply), {
    method: "PATCH",
    body: { inBank },
    schema: process.env.NODE_ENV === "production" ? undefined : MomentBankSchema,
  });
  return data as MomentBankResponse;
}

/** A7: Finish Review (idempotent: a replay answers the same body). */
export async function completeReviewRequest(ref: string, options: { keepalive?: boolean } = {}): Promise<CompleteOut> {
  const { data } = await api(reviewApiPath(endpoints.reviewComplete, ref), {
    method: "POST",
    body: {},
    keepalive: options.keepalive,
    schema: process.env.NODE_ENV === "production" ? undefined : CompleteOutSchema,
  });
  return data as CompleteOut;
}

/** A9b: queue the legend comparison's evals (≤ 3 attempts, then 410). */
export async function computeLegendRequest(ref: string): Promise<LegendComputeResponse> {
  const { data } = await api(reviewApiPath(endpoints.reviewLegendCompute, ref), {
    method: "POST",
    body: {},
    schema: process.env.NODE_ENV === "production" ? undefined : LegendComputeSchema,
  });
  return data as LegendComputeResponse;
}

/** Finish Review: A7, then the archive rows are stale (no refetch here; the next /games visit revalidates). */
export function useCompleteReview(ref: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => completeReviewRequest(ref, { keepalive: true }),
    onSettled: () => qc.invalidateQueries({ queryKey: qk.games.all(), refetchType: "none" }),
  });
}

/** The compare page's A9b (optimistic `computing` is the caller's); `compare:ready` invalidates the legend query. */
export function useComputeLegend(ref: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => computeLegendRequest(ref),
    onError: () => qc.invalidateQueries({ queryKey: qk.review.legend(ref), exact: true }),
  });
}

/** A6 behind P5's `train` flag (CDL §3.6.1): set semantics, the review payload refetches after. */
export function useToggleMomentInBank(ref: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { ply: number; inBank: boolean }) => setMomentBankRequest(ref, input.ply, input.inBank),
    onSettled: () => qc.invalidateQueries({ queryKey: qk.review.detail(ref), exact: true }),
  });
}
