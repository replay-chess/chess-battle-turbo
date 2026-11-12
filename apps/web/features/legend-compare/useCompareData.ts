"use client";

// The compare page's data flow (phase-03 plan §5.7, P3-D23):
//   - A9 from the seeded cache (`qk.review.legend(ref)`; the RSC prefetched it, so no fetch on mount);
//   - the one A9b `POST …/legend/compute` on mount, only when the evals are what is missing (model.ts needsCompute),
//     with an optimistic "computing" flag; Try Again after `status = failed` sends it again while attempts are left;
//   - `compare:ready` for this game (the user room) → one A9 refetch; `analysis:done` → one A9 refetch (the analysis
//     must be done before the evals can be computed);
//   - the fallback while the socket is down (or never connected within 3 s) and the tab is visible: A2 on the review's
//     poller schedule [2, 4, 8, 15] s, stopping after 180 s; a changed `comparison.status` refetches A9.
// Never on hover or prefetch: this hook runs only on the mounted page.
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { LegendCompareDTO } from "@repo/contracts/http/legend";
import { legendCompareQuery, reviewStatusQuery } from "@/lib/api/queries/review";
import { useComputeLegend } from "@/lib/api/mutations/review";
import { qk } from "@/lib/api/keys";
import { getRealtime } from "@/lib/realtime/connection";
import { useAnalysisEvents } from "@/lib/realtime/handlers/analysis";
import { useConnection } from "@/lib/realtime/useConnection";
import { fallbackInterval, SOCKET_GRACE_MS } from "@/features/review/live";
import { canRetryCompute, COMPUTE_MAX_ATTEMPTS, needsCompute } from "./model";

function subscribeVisibility(cb: () => void) {
  document.addEventListener("visibilitychange", cb);
  return () => document.removeEventListener("visibilitychange", cb);
}

function useTabVisible(): boolean {
  return useSyncExternalStore(
    subscribeVisibility,
    () => document.visibilityState === "visible",
    () => true,
  );
}

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

export interface CompareDemo {
  /** Replaces A9b in the demo (no server): the demo flips the cached payload to `ready` itself. */
  compute(): void;
}

export interface CompareData {
  dto: LegendCompareDTO;
  /** A9b sent and `compare:ready` not here yet. */
  computing: boolean;
  /** The A9 refetch failed (the cached payload stays on screen). */
  loadFailed: boolean;
  /** Try Again: A9b after a failed compute (attempts left), else an A9 refetch. */
  tryAgain(): void;
  canTryAgain: boolean;
}

export function useCompareData(refId: string, demo?: CompareDemo): CompareData {
  const qc = useQueryClient();
  // Seeded by the RSC (or the demo): no refetch on mount, even while `staleTime` is 0 for a pending comparison; the
  // realtime events, the fallback poller and Try Again refetch it.
  const query = useQuery({ ...legendCompareQuery(refId), refetchOnMount: false });
  const dto = query.data as LegendCompareDTO;
  const mutation = useComputeLegend(refId);
  const [computing, setComputing] = useState(false);
  const sent = useRef(false);

  const compute = () => {
    setComputing(true);
    if (demo) {
      demo.compute();
      return;
    }
    mutation.mutate(undefined, {
      onError: () => setComputing(false),
    });
  };

  // ── the one A9b on mount ──
  useEffect(() => {
    if (sent.current || !dto || !needsCompute(dto, COMPUTE_MAX_ATTEMPTS)) return;
    sent.current = true;
    compute();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per mount, when the payload first asks for it
  }, [dto]);

  // The evals landed (or the compute failed): the optimistic flag ends.
  useEffect(() => {
    if (dto && (dto.status === "ready" || dto.status === "failed")) setComputing(false);
  }, [dto]);

  // ── realtime: compare:ready → A9 refetch; analysis:done → A9 refetch (the analysis status gates A9b) ──
  useEffect(() => {
    if (demo) return;
    const rt = getRealtime();
    if (!rt) return;
    const release = rt.acquire("review");
    const off = rt.on<{ gameRef?: unknown; useq?: unknown }>("compare:ready", (frame) => {
      if (!frame || frame.gameRef !== refId) return;
      if (typeof frame.useq === "number") rt.noteUseq(frame.useq);
      void qc.invalidateQueries({ queryKey: qk.review.legend(refId), exact: true });
    });
    return () => {
      off();
      release();
    };
  }, [demo, qc, refId]);

  const analysisPending = !!dto && dto.analysisStatus !== "done";
  useAnalysisEvents(refId, {
    enabled: !demo && analysisPending,
    onEvent: (name) => {
      if (name === "analysis:done") void qc.invalidateQueries({ queryKey: qk.review.legend(refId), exact: true });
    },
  });

  // ── the fallback poller on A2 while the socket is down ──
  const waiting = !!dto && dto.status === "facts_ready" && (computing || analysisPending);
  const socketDown = useSocketDown(!demo && waiting);
  const visible = useTabVisible();
  const pollActive = !demo && waiting && socketDown && visible;
  const poll = useQuery({
    ...reviewStatusQuery(refId),
    enabled: pollActive,
    refetchInterval: (q) => fallbackInterval(q, pollActive, Date.now()),
    refetchIntervalInBackground: false,
  });
  const polled = poll.data;
  useEffect(() => {
    if (!polled || !dto) return;
    const changed =
      (polled.comparison && polled.comparison.status !== dto.status) || (polled.analysis.status === "done" && dto.analysisStatus !== "done");
    if (changed) void qc.invalidateQueries({ queryKey: qk.review.legend(refId), exact: true });
  }, [polled, dto, qc, refId]);

  const retryCompute = !!dto && canRetryCompute(dto, COMPUTE_MAX_ATTEMPTS);
  return {
    dto,
    computing: computing && dto?.status === "facts_ready",
    loadFailed: query.isError,
    tryAgain: () => {
      if (retryCompute) compute();
      else void query.refetch();
    },
    canTryAgain: retryCompute || query.isError,
  };
}
