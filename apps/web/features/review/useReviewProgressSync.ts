"use client";

// Walkthrough progress sync (phase-03 plan §5.2 "Walkthrough progress", A5): the events the walkthrough queues in the
// view store go out as `PATCH /api/review/[ref]/progress {momentIndex, events[] ≤ 50}`:
// - debounced 1 s after the last queued event;
// - at once with `keepalive` on `pagehide`, on `visibilitychange: hidden` and when the screen unmounts (a route
//   change), so the last batch survives a tab close;
// - fire-and-forget: a failed batch is re-queued once and retried, then dropped (analytics carries the same signal).
// The cached payload's `review.progress` moves forward locally (optimistic: `momentIndex` never goes back,
// `startedAt` is set once), so a remount resumes at the same moment without a refetch.

import { useEffect } from "react";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import { PROGRESS_EVENTS_MAX } from "@repo/contracts/http/plain";
import type { ProgressEvent, ReviewDTO } from "@repo/contracts/http/review";
import { qk } from "@/lib/api/keys";
import { ApiError, reactToApiError } from "@/lib/api/errors";
import { sendReviewProgress } from "@/lib/api/mutations/review";
import type { ReviewViewStore } from "./view-store";

/** The A5 batch cap (the contract's, from the zod-free module). */
export const PROGRESS_BATCH_MAX = PROGRESS_EVENTS_MAX;
export const PROGRESS_DEBOUNCE_MS = 1_000;
/** A failed batch is retried once after this long. */
export const PROGRESS_RETRY_MS = 5_000;

/** Events already re-queued once: a second failure drops them. */
const requeued = new WeakSet<ProgressEvent>();

/** Splits events into A5 batches of at most PROGRESS_BATCH_MAX. */
export function progressBatches(events: readonly ProgressEvent[], max = PROGRESS_BATCH_MAX): ProgressEvent[][] {
  const out: ProgressEvent[][] = [];
  for (let i = 0; i < events.length; i += max) out.push(events.slice(i, i + max));
  return out;
}

/** The events of a failed batch to send again: those not yet retried (each event is retried at most once). */
export function retryable(events: readonly ProgressEvent[], seen: { has(e: ProgressEvent): boolean; add(e: ProgressEvent): unknown }): ProgressEvent[] {
  const again = events.filter((e) => !seen.has(e));
  again.forEach((e) => seen.add(e));
  return again;
}

/** A5 requests still on the wire, per review: Finish Review waits for them before A7 (see settleReviewProgress). */
const inflight = new Map<string, Set<Promise<void>>>();

function track(ref: string, p: Promise<void>): void {
  let set = inflight.get(ref);
  if (!set) inflight.set(ref, (set = new Set()));
  set.add(p);
  void p.finally(() => {
    set.delete(p);
    if (set.size === 0 && inflight.get(ref) === set) inflight.delete(ref);
  });
}

/**
 * Resolves when every A5 request of this review sent so far has settled (answered or failed). Finish Review awaits
 * it before A7, so the complete page never reads a walkthrough whose last results are still on the wire.
 */
export async function settleReviewProgress(ref: string): Promise<void> {
  const pending = [...(inflight.get(ref) ?? [])];
  if (pending.length) await Promise.allSettled(pending);
}

/** Sends everything queued now. Returns the number of events handed to the network. */
export function flushReviewProgress(
  ref: string,
  store: ReviewViewStore,
  options: { keepalive?: boolean; queryClient?: QueryClient; onFailed?: () => void } = {},
): number {
  const s = store.getState();
  const events = s.drainEvents();
  if (events.length === 0) return 0;
  for (const batch of progressBatches(events)) {
    const sent = sendReviewProgress(ref, { momentIndex: Math.min(3, Math.max(0, s.momentIndex)), events: batch }, { keepalive: options.keepalive }).then(
      () => undefined,
      (err: unknown) => {
        if (err instanceof ApiError && (err.status === 401 || err.status === 402)) {
          // The session or the membership is gone: the global reaction (sign-in modal, pricing) takes over.
          reactToApiError(err, { kind: "background", queryClient: options.queryClient });
          return;
        }
        if (err instanceof ApiError && (err.status === 404 || err.status === 409 || err.status === 400 || err.status === 413)) return;
        const again = retryable(batch, requeued);
        if (again.length) {
          store.getState().requeueEvents(again);
          options.onFailed?.();
        }
      },
    );
    track(ref, sent);
  }
  return events.length;
}

/** Moves the cached `review.progress` forward (never back). */
export function advanceProgress(d: ReviewDTO | undefined, momentIndex: number, at: string): ReviewDTO | undefined {
  if (!d?.review) return d;
  const p = d.review.progress;
  const idx = Math.max(p.momentIndex, Math.min(3, Math.max(0, momentIndex)));
  if (idx === p.momentIndex && p.startedAt) return d;
  return { ...d, review: { ...d.review, progress: { ...p, momentIndex: idx, startedAt: p.startedAt ?? at } } };
}

export function useReviewProgressSync(ref: string, store: ReviewViewStore, enabled: boolean): void {
  const qc = useQueryClient();

  // The cached progress follows the walkthrough (demo too: it only touches the local cache).
  useEffect(
    () =>
      store.subscribe((v, prev) => {
        if (v.mode !== "moment") return;
        if (v.mode === prev.mode && v.momentIndex === prev.momentIndex) return;
        qc.setQueryData<ReviewDTO>(qk.review.detail(ref), (d) => advanceProgress(d, v.momentIndex, new Date().toISOString()));
      }),
    [qc, ref, store],
  );

  useEffect(() => {
    if (!enabled) return;
    let debounce: ReturnType<typeof setTimeout> | undefined;
    let retry: ReturnType<typeof setTimeout> | undefined;
    const send = (keepalive: boolean) => {
      clearTimeout(debounce);
      flushReviewProgress(ref, store, {
        keepalive,
        queryClient: qc,
        onFailed: () => {
          clearTimeout(retry);
          retry = setTimeout(() => send(false), PROGRESS_RETRY_MS);
        },
      });
    };
    const unsubscribe = store.subscribe((v, prev) => {
      if (v.pending.length <= prev.pending.length) return;
      clearTimeout(debounce);
      debounce = setTimeout(() => send(false), PROGRESS_DEBOUNCE_MS);
    });
    const onHidden = () => {
      if (document.visibilityState === "hidden") send(true);
    };
    const onPageHide = () => send(true);
    document.addEventListener("visibilitychange", onHidden);
    window.addEventListener("pagehide", onPageHide);
    return () => {
      unsubscribe();
      document.removeEventListener("visibilitychange", onHidden);
      window.removeEventListener("pagehide", onPageHide);
      clearTimeout(retry);
      send(true);
    };
  }, [enabled, qc, ref, store]);
}
