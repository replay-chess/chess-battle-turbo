"use client";

// Realtime for /games (plan §5.1, §5.10, P3-D26), over the user room the socket joins at connect:
// - `games:changed` and `analysis:batch` → invalidate ["games"] with refetchType "active", throttled to one per 10 s
//   per tab with a trailing edge; while the tab is hidden they only mark the data stale (refetchType "none").
// - `analysis:queued` / `progress` / `done` / `failed` → patch the matching row in every cached list in place
//   (status, accuracy, headline, moments), so an "Analysing" row turns into its headline without a refetch.
// No socket (RealtimeBoot absent, offline): nothing happens; the 60 s staleTime and focus refetch cover it.
import { useEffect } from "react";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import type {
  AnalysisDoneEvent,
  AnalysisFailedEvent,
  AnalysisProgressEvent,
  AnalysisQueuedEvent,
} from "@repo/contracts/socket/analysis";
import { qk } from "@/lib/api/keys";
import { getRealtime } from "@/lib/realtime/connection";
import { patchRow, type RowPatch } from "../model/rows";
import { patchArchivePages, type ArchiveData } from "./archive";

/** At most one archive refetch per tab per this window (plan §5.1). */
export const ARCHIVE_INVALIDATE_THROTTLE_MS = 10_000;

/** A throttle with a trailing call: the first event runs now, later ones in the window run once at its end. */
export function trailingThrottle(fn: () => void, windowMs: number, now: () => number = Date.now) {
  let last = -Infinity;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const run = () => {
    timer = null;
    last = now();
    fn();
  };
  return {
    call() {
      const wait = last + windowMs - now();
      if (wait <= 0 && !timer) run();
      else if (!timer) timer = setTimeout(run, Math.max(0, wait));
    },
    cancel() {
      if (timer) clearTimeout(timer);
      timer = null;
    },
  };
}

export function patchArchiveRow(qc: QueryClient, ref: string, patch: RowPatch): void {
  qc.setQueriesData<ArchiveData>({ queryKey: [...qk.games.all(), "list"] }, (data) =>
    patchArchivePages(data, ref, (row) => patchRow(row, patch)),
  );
}

export function useArchiveLive(): void {
  const qc = useQueryClient();
  useEffect(() => {
    const rt = getRealtime();
    if (!rt) return;
    const release = rt.acquire("review");
    const refetch = trailingThrottle(
      () => void qc.invalidateQueries({ queryKey: qk.games.all(), refetchType: "active" }),
      ARCHIVE_INVALIDATE_THROTTLE_MS,
    );
    const changed = () => {
      if (typeof document !== "undefined" && document.visibilityState === "hidden") {
        void qc.invalidateQueries({ queryKey: qk.games.all(), refetchType: "none" });
        return;
      }
      refetch.call();
    };
    const offs = [
      rt.on("games:changed", changed),
      rt.on("analysis:batch", changed),
      rt.on<AnalysisQueuedEvent>("analysis:queued", (e) => patchArchiveRow(qc, e.gameRef, { analysisStatus: "queued" })),
      rt.on<AnalysisProgressEvent>("analysis:progress", (e) =>
        patchArchiveRow(qc, e.gameRef, { analysisStatus: "running" }),
      ),
      rt.on<AnalysisDoneEvent>("analysis:done", (e) =>
        patchArchiveRow(qc, e.gameRef, {
          analysisStatus: "done",
          accuracy: e.accuracy,
          headline: e.headline,
          momentsCount: e.momentsCount,
        }),
      ),
      rt.on<AnalysisFailedEvent>("analysis:failed", (e) => patchArchiveRow(qc, e.gameRef, { analysisStatus: "failed" })),
    ];
    return () => {
      for (const off of offs) off();
      refetch.cancel();
      release();
    };
  }, [qc]);
}
