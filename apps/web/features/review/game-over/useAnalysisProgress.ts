"use client";

// useAnalysisProgress(ref, {target: "status"}) (phase-03 plan §5.8): the game-over card's view of a game's analysis,
// kept in `qk.review.status(ref)` (the A2 shape), so the card, the fallback poller and the review screen agree.
//
// One component per card DRIVES it (`drive: true`, the review primary); the slots only read the cache. The driver:
//   - reads A2 once on mount (a fresh finish may answer `none` until the finish commits);
//   - seeds the cache from `game:result.review` (live games; the bot `complete` answer is seeded by
//     seed.ts seedReviewStatusFromComplete), never regressing a state an A2 answer or an event already brought;
//   - follows `analysis:*` through useAnalysisEvents (lib/realtime/handlers/analysis.ts: progress → graded plies, done →
//     accuracy, moments and the coach line; the card is a watched view: the finish enqueues at GAME_ENDED, so progress
//     frames are sent);
//   - polls A2 on the review fallback schedule ([2, 4, 8, 15] s, stopping after 180 s) only while it must: the status
//     is queued/running and the socket is down (tab visible), or a fresh finish still reads `none`;
//   - with the socket live but no `analysis:*` event for 45 s while queued/running, reads A2 once (stall rule);
//   - for a game from a legend position, refetches A2 once when the analysis state is known but the legend block is
//     not (A2 inserts the facts lazily: a read before the finish committed had nothing to compare).
// In the demo controller nothing is fetched or subscribed (the /dev/ui route seeds the cache).

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { ReviewStatusDTO } from "@repo/contracts/http/review";
import { qk } from "@/lib/api/keys";
import { reviewStatusQuery } from "@/lib/api/queries/review";
import { useAnalysisEvents } from "@/lib/realtime/handlers/analysis";
import { getRealtime } from "@/lib/realtime/connection";
import { useConnection } from "@/lib/realtime/useConnection";
import { fallbackInterval, isLiveStatus, REVIEW_STALL_SILENCE_MS, SOCKET_GRACE_MS } from "../live";
import { GAME_OVER_MIN_PLIES } from "./model";
import { seedReviewStatus } from "./seed";

function subscribeVisibility(fn: () => void) {
  document.addEventListener("visibilitychange", fn);
  return () => document.removeEventListener("visibilitychange", fn);
}

function useTabVisible(): boolean {
  return useSyncExternalStore(subscribeVisibility, () => document.visibilityState !== "hidden", () => true);
}

/** True once the socket had SOCKET_GRACE_MS to connect, or went down after being live. */
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

type GameResultFrame = { ref?: unknown; review?: { status?: unknown; etaSec?: unknown } };

/** How often the stall rule looks at the silence (it fires once 45 s have passed). */
const STALL_CHECK_EVERY_MS = 5_000;

export interface AnalysisProgressOptions {
  target: "status";
  /** This component fetches, polls and subscribes (one per card). */
  drive?: boolean;
  /** Plies of the game (the seed's totalPlies). */
  plies: number;
  /** The finish may not have reached the database yet (≤ 60 s after the end). */
  fresh: boolean;
  /** Played from a legend position: the legend block is expected. */
  legend: boolean;
  /** The /dev/ui demo: no fetch, no socket. */
  demo?: boolean;
}

export function useAnalysisProgress(ref: string, options: AnalysisProgressOptions): ReviewStatusDTO | undefined {
  const qc = useQueryClient();
  const drive = (options.drive ?? false) && !options.demo;
  // Every caller observes the cache; only the driver's second observer fetches (once on mount) and polls.
  const cached = useQuery({ ...reviewStatusQuery(ref), enabled: false });
  const data = cached.data as ReviewStatusDTO | undefined;
  const status = data?.analysis.status;
  const live = status !== undefined && isLiveStatus(status);
  const pendingFinish = status === "none" && options.fresh && options.plies >= GAME_OVER_MIN_PLIES;

  const socketDown = useSocketDown(drive && live);
  const visible = useTabVisible();
  const pollActive = drive && visible && ((live && socketDown) || pendingFinish);
  useQuery({
    ...reviewStatusQuery(ref),
    enabled: drive,
    refetchInterval: (query) => fallbackInterval(query, pollActive, Date.now()),
    refetchIntervalInBackground: false,
  });

  const lastEventAt = useRef(0);
  useAnalysisEvents(ref, {
    enabled: drive,
    onEvent: () => {
      lastEventAt.current = Date.now();
    },
  });

  // Stall: queued/running with the socket live and no `analysis:*` for 45 s → one A2 read (A2 reports
  // `worker_stalled` once the job heartbeat is older than 90 s), as on the review screen.
  useEffect(() => {
    if (!drive || !live || socketDown) return;
    lastEventAt.current = Date.now();
    const t = setInterval(() => {
      if (Date.now() - lastEventAt.current < REVIEW_STALL_SILENCE_MS) return;
      lastEventAt.current = Date.now();
      void qc.invalidateQueries({ queryKey: qk.review.status(ref), exact: true });
    }, STALL_CHECK_EVERY_MS);
    return () => clearInterval(t);
  }, [drive, live, socketDown, qc, ref]);

  // `game:result.review` (live games): the seed arrives in the game room right after the finish commits.
  const plies = options.plies;
  useEffect(() => {
    if (!drive) return;
    const rt = getRealtime();
    if (!rt) return;
    return rt.on<GameResultFrame>("game:result", (frame) => {
      if (!frame || frame.ref !== ref || !frame.review) return;
      const s = frame.review.status;
      if (s !== "queued" && s !== "skipped") return;
      const etaSec = typeof frame.review.etaSec === "number" ? frame.review.etaSec : null;
      seedReviewStatus(qc, ref, { status: s, etaSec }, plies);
    });
  }, [drive, qc, ref, plies]);

  // A legend game whose block is still missing once the analysis state is known: one more A2 read.
  const legendRefetched = useRef(false);
  const needsLegend = drive && options.legend && data !== undefined && status !== "none" && data.comparison === null;
  useEffect(() => {
    if (!needsLegend || legendRefetched.current) return;
    legendRefetched.current = true;
    void qc.invalidateQueries({ queryKey: qk.review.status(ref), exact: true });
  }, [needsLegend, qc, ref]);

  return data;
}
