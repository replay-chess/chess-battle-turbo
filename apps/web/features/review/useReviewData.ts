"use client";

// The review's data flow (phase-03 plan §5.2): the payload from the seeded cache, live socket deltas, the A3 enqueue
// on mount, the per-query fallback poller, stall detection and the optimistic Retry.
//
// - Read: `useQuery(reviewQuery(ref))` reads the cache the RSC seeded (no fetch on mount).
// - Unanalysed (`none`): A3 once with an optimistic "queued"; on error back to `none` + "Couldn't start the
//   analysis. Try again." with Retry. Outdated grading (`done`, version < GRADING_VERSION): A3 `{reason: "regrade"}`
//   once, the old grades stay on screen.
// - Live: useAnalysisEvents (lib/realtime/handlers/analysis.ts) merges `analysis:*` into the cache.
// - Fallback: A2 polled [2, 4, 8, 15] s only while the status is queued/running AND the socket is not live (or did
//   not connect within 3 s) AND the tab is visible; it stops 180 s after its first poll. A different status or more
//   graded plies from A2 → one A1 refetch (or a patch for failed/queued).
// - Stall: queued/running with the socket live and no `analysis:*` for 45 s → one A2 fetch (A2 reports
//   `worker_stalled` when the job heartbeat is older than 90 s).
// - Retry (A4): optimistic "queued" keeping the graded plies; 409 already_running keeps it; 410 → terminal; other
//   errors restore + "Retry failed. Try again in a minute."; focus moves to the progress card.
// In the /dev/ui demo nothing is fetched and no socket is opened (the cache is seeded with a fixture).

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { withToast } from "@/lib/ui/lazy-toast";
import type { ReviewDTO, ReviewStatusDTO } from "@repo/contracts/http/review";
import { GRADING_VERSION } from "@repo/chess-analysis/version";
import { qk } from "@/lib/api/keys";
import { ApiError, reactToApiError } from "@/lib/api/errors";
import { analyseReviewRequest, retryReviewRequest } from "@/lib/api/mutations/review";
import { reviewQuery, reviewStatusQuery } from "@/lib/api/queries/review";
import { skeletonAnalysis, useAnalysisEvents, type AnalysisEventHandler } from "@/lib/realtime/handlers/analysis";
import { useConnection } from "@/lib/realtime/useConnection";
import { COPY } from "./copy";
import {
  afterAnalyseConflict,
  fallbackInterval,
  isLiveStatus,
  reconcileWithStatus,
  REVIEW_STALL_SILENCE_MS,
  SOCKET_GRACE_MS,
} from "./live";
import { trackReview } from "./telemetry";

function subscribeVisibility(fn: () => void) {
  document.addEventListener("visibilitychange", fn);
  return () => document.removeEventListener("visibilitychange", fn);
}

function useTabVisible(): boolean {
  return useSyncExternalStore(
    subscribeVisibility,
    () => document.visibilityState !== "hidden",
    () => true,
  );
}

/** True once the socket has had 3 s to connect (or went down after being live). */
function useSocketDown(enabled: boolean): boolean {
  const conn = useConnection();
  const [grace, setGrace] = useState(true);
  useEffect(() => {
    if (!enabled) return;
    const t = setTimeout(() => setGrace(false), SOCKET_GRACE_MS);
    return () => clearTimeout(t);
  }, [enabled]);
  if (conn === "live") return false;
  if (conn === "reconnecting" || conn === "offline" || conn === "unauthorized" || conn === "upgrade_required") return true;
  return !grace;
}

export interface ReviewData {
  dto: ReviewDTO;
  retry(): void;
  retrying: boolean;
  refreshFailed: boolean;
  refetch(): void;
}

export function useReviewData(
  ref: string,
  options: { demo: boolean; onEvent?: AnalysisEventHandler },
): ReviewData {
  const { demo } = options;
  const qc = useQueryClient();
  const detail = useQuery({ ...reviewQuery(ref), enabled: !demo });
  const dto = detail.data as ReviewDTO;
  const status = dto.status;
  const live = isLiveStatus(status);
  const lastEventAt = useRef(Date.now());
  const [retrying, setRetrying] = useState(false);
  const retryClicks = useRef(0);
  /** Bumped by the "Couldn't start the analysis" toast's Retry: runs the A3 effect again. */
  const [startAttempt, setStartAttempt] = useState(0);

  // ── live events (never in the demo) ──
  useAnalysisEvents(ref, {
    enabled: !demo,
    onEvent: (name, payload) => {
      lastEventAt.current = Date.now();
      options.onEvent?.(name, payload);
    },
  });

  // ── A3 on mount for an unanalysed game; a regrade for outdated grades. Once per mount. ──
  const analysed = useRef(false);
  useEffect(() => {
    if (demo || analysed.current) return;
    const current = qc.getQueryData<ReviewDTO>(qk.review.detail(ref));
    if (!current) return;
    const regrade = current.status === "done" && (current.analysis?.version ?? GRADING_VERSION) < GRADING_VERSION;
    if (current.status !== "none" && !regrade) return;
    analysed.current = true;
    if (!regrade) {
      qc.setQueryData<ReviewDTO>(qk.review.detail(ref), (d) =>
        d && d.status === "none"
          ? { ...d, status: "queued", analysis: d.analysis ?? skeletonAnalysis(d.moves.trim() ? d.moves.trim().split(/\s+/).length : 0, null) }
          : d,
      );
    }
    analyseReviewRequest(ref, { reason: regrade ? "regrade" : "opened" })
      .then((out) => {
        if (regrade) return;
        qc.setQueryData<ReviewDTO>(qk.review.detail(ref), (d) => {
          if (!d || d.status !== "queued" || !d.analysis) return d;
          if (out.status === "done") return d;
          return { ...d, analysis: { ...d.analysis, queue: { position: out.position, etaSec: out.etaSec } } };
        });
        if (out.status === "done") void qc.invalidateQueries({ queryKey: qk.review.detail(ref), exact: true });
      })
      .catch((err: unknown) => {
        if (regrade) return;
        if (err instanceof ApiError && err.code === "conflict") {
          // skipped (too short or aborted) is final at once; already running: the refetched payload tells.
          qc.setQueryData<ReviewDTO>(qk.review.detail(ref), (d) => afterAnalyseConflict(d, err.reason));
          void qc.invalidateQueries({ queryKey: qk.review.detail(ref), exact: true });
          return;
        }
        qc.setQueryData<ReviewDTO>(qk.review.detail(ref), (d) => (d && d.status === "queued" ? { ...d, status: "none", analysis: null } : d));
        if (err instanceof ApiError && (err.status === 401 || err.status === 402)) {
          // A plain request is not a TanStack mutation, so the global reaction (session modal, /pricing) runs here.
          reactToApiError(err, { kind: "mutation", queryClient: qc, meta: { errorUi: "inline" } });
          return;
        }
        void withToast((toast) =>
          toast.error(COPY.startFailed, {
            id: `review-start:${ref}`,
            action: {
              label: "Retry",
              onClick: () => {
                analysed.current = false;
                setStartAttempt((n) => n + 1);
              },
            },
          }),
        );
      });
  }, [demo, qc, ref, status, startAttempt]);

  // ── the fallback poller (socket down, tab visible, live status) ──
  const socketDown = useSocketDown(!demo && live);
  const visible = useTabVisible();
  const pollActive = !demo && live && socketDown && visible;
  const poll = useQuery({
    ...reviewStatusQuery(ref),
    enabled: pollActive,
    refetchInterval: (query) => fallbackInterval(query, pollActive, Date.now()),
    refetchIntervalInBackground: false,
  });

  // ── stall detection: socket live, no event for 45 s → one A2 fetch ──
  useEffect(() => {
    if (demo || !live || socketDown) return;
    lastEventAt.current = Date.now();
    const t = setInterval(() => {
      if (Date.now() - lastEventAt.current < REVIEW_STALL_SILENCE_MS) return;
      lastEventAt.current = Date.now();
      void qc.fetchQuery({ ...reviewStatusQuery(ref), staleTime: 0 }).then(
        (s) => reconcile(s),
        () => undefined,
      );
    }, 5_000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reconcile reads the cache at call time
  }, [demo, live, socketDown, qc, ref]);

  // A2 answers (poller or stall check) → patch or one A1 refetch.
  function reconcile(s: ReviewStatusDTO | undefined) {
    if (!s) return;
    const current = qc.getQueryData<ReviewDTO>(qk.review.detail(ref));
    if (!current) return;
    const r = reconcileWithStatus(current, s);
    if (r.next !== current) qc.setQueryData(qk.review.detail(ref), r.next);
    if (r.refetch) void qc.invalidateQueries({ queryKey: qk.review.detail(ref), exact: true });
  }
  const polled = poll.data as ReviewStatusDTO | undefined;
  const polledAt = poll.dataUpdatedAt;
  useEffect(() => {
    if (polledAt) reconcile(polled);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per A2 answer
  }, [polledAt]);

  // ── Retry (A4) ──
  const retry = () => {
    if (demo || retrying) return;
    const prev = qc.getQueryData<ReviewDTO>(qk.review.detail(ref));
    if (!prev) return;
    const failure = prev.analysis?.failure;
    retryClicks.current = Math.min(10, retryClicks.current + 1);
    trackReview("analysis_retry_clicked", { code: failure?.code ?? "internal", attempt: retryClicks.current });
    setRetrying(true);
    qc.setQueryData<ReviewDTO>(qk.review.detail(ref), (d) =>
      d && d.analysis ? { ...d, status: "queued", analysis: { ...d.analysis, failure: null, queue: d.analysis.queue } } : d,
    );
    requestAnimationFrame(() => document.getElementById("rv-progress")?.focus());
    retryReviewRequest(ref)
      .then((out) => {
        qc.setQueryData<ReviewDTO>(qk.review.detail(ref), (d) =>
          d && d.analysis && d.status === "queued" ? { ...d, analysis: { ...d.analysis, queue: { position: 0, etaSec: out.etaSec } } } : d,
        );
      })
      .catch((err: unknown) => {
        if (err instanceof ApiError && err.code === "conflict" && err.reason === "already_running") return;
        if (err instanceof ApiError && err.code === "gone") {
          qc.setQueryData<ReviewDTO>(qk.review.detail(ref), (d) =>
            d && d.analysis
              ? {
                  ...d,
                  status: "failed",
                  analysis: {
                    ...d.analysis,
                    queue: null,
                    failure: { failedAtPly: failure?.failedAtPly ?? d.analysis.gradedPlies, retryable: false, retryAt: null, code: failure?.code ?? "internal" },
                  },
                }
              : d,
          );
          return;
        }
        qc.setQueryData(qk.review.detail(ref), prev);
        if (err instanceof ApiError && (err.status === 401 || err.status === 402)) {
          reactToApiError(err, { kind: "mutation", queryClient: qc, meta: { errorUi: "inline" } });
          return;
        }
        void withToast((toast) => toast.error(COPY.retryFailed, { id: `review-retry:${ref}` }));
      })
      .finally(() => setRetrying(false));
  };

  return {
    dto,
    retry,
    retrying,
    refreshFailed: !demo && detail.isRefetchError,
    refetch: () => void detail.refetch(),
  };
}
