// User-room analysis events → the query cache (phase-03 plan §5.1, §5.2, §5.11; client-data-layer 5.6).
//
// Consumers: the review screen (features/review), the game-over card (features/review/game-over, WP-E) and the
// archive (features/games, WP-G). Each mounts `useAnalysisEvents(gameRef)` (or `useGamesLive()`), which:
//   - holds the tab's socket with the "review" hold while mounted (lib/realtime/connection.ts acquire);
//   - listens to `analysis:*` for that game only (filtered by `gameRef`), notes each frame's `useq` for the reconnect
//     resync, validates the payload against its contract in dev builds (zod is never in production chunks);
//   - applies the cache updaters below to `qk.review.detail(ref)` and `qk.review.status(ref)`:
//       queued   → status "queued" + the queue info (a skeleton analysis when none was cached);
//       progress → `mergePlies` splices the ply delta (stale frames dropped; a gap refetches A1);
//       writing  → nothing in the cache (the payload has no writing phase): the consumer's `onEvent` sets its flag;
//       done     → one A1 refetch (invalidate), the status gets the coach line at once;
//       failed   → status "failed" + the failure fields, graded plies kept;
//   - and hands every event to `onEvent` (the review's writing flag and its 45 s stall timer);
//   - on a reconnect that may have missed user-room events (`session:hello` resync), marks a non-done review stale.
// The updaters are pure and exported for the tests.

import { useEffect, useRef } from "react";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import type { ReviewAnalysis, ReviewDTO, ReviewStatusDTO } from "@repo/contracts/http/review";
import type {
  AnalysisDoneEvent,
  AnalysisEventName,
  AnalysisEventPayload,
  AnalysisFailedEvent,
  AnalysisProgressEvent,
  AnalysisQueuedEvent,
} from "@repo/contracts/socket/analysis";
import { deltaFit, mergePlies } from "@repo/chess-analysis/codec";
import { nextCheckpointAfter } from "@repo/contracts/http/plain";
import { analysisBreadcrumb } from "@/lib/sentry/review";
import { GRADING_VERSION, ENGINE_PROFILE } from "@repo/chess-analysis/version";
import { qk } from "@/lib/api/keys";
import { getRealtime } from "../connection";

/** The events about one game (everything but the per-user `analysis:batch`). */
export const GAME_ANALYSIS_EVENTS = [
  "analysis:queued",
  "analysis:progress",
  "analysis:writing",
  "analysis:done",
  "analysis:failed",
] as const satisfies readonly AnalysisEventName[];
export type GameAnalysisEventName = (typeof GAME_ANALYSIS_EVENTS)[number];

export type AnalysisEventHandler = <N extends GameAnalysisEventName>(name: N, payload: AnalysisEventPayload<N>) => void;

/** The outcome of an updater: the next value (the same object when nothing changed) and whether A1 must be refetched. */
export interface Update<T> {
  next: T;
  refetch: boolean;
}

const ZERO_COUNTS = (): number[] => Array<number>(13).fill(0);

/** The analysis skeleton the server sends for a queued job with no checkpoint yet (CT ReviewDTO.analysis doc). */
export function skeletonAnalysis(totalPlies: number, queue: ReviewAnalysis["queue"]): ReviewAnalysis {
  return {
    version: GRADING_VERSION,
    engineLabel: ENGINE_PROFILE.engine,
    depthLabel: "",
    gradedPlies: 0,
    totalPlies,
    evals: [],
    best: "",
    j: "",
    accuracy: { w: null, b: null },
    phaseAccuracy: { w: [], b: [] },
    phases: { middlegamePly: null, endgamePly: null },
    counts: { w: ZERO_COUNTS(), b: ZERO_COUNTS() },
    failure: null,
    queue,
  };
}

function plyCount(moves: string): number {
  const t = moves.trim();
  return t === "" ? 0 : t.split(/\s+/).length;
}

/** `analysis:queued`. A done review ignores it (a regrade keeps the old, still valid grades on screen, §5.2). */
export function reviewOnQueued(d: ReviewDTO, ev: Pick<AnalysisQueuedEvent, "position" | "etaSec">): Update<ReviewDTO> {
  if (d.status === "done" || d.status === "skipped") return { next: d, refetch: false };
  const queue = { position: ev.position, etaSec: ev.etaSec };
  const analysis = d.analysis
    ? { ...d.analysis, failure: null, queue }
    : skeletonAnalysis(plyCount(d.moves), queue);
  return { next: { ...d, status: "queued", analysis }, refetch: false };
}

/**
 * `analysis:progress`: splice the ply delta. A frame that starts beyond the cached plies refetches A1, but only once
 * a checkpoint beyond them has been written (`nextCheckpointAfter`): before that A1 holds nothing newer, and on a
 * long game (checkpoints up to 40 plies apart) every frame of the gap would otherwise refetch.
 */
export function reviewOnProgress(d: ReviewDTO, ev: AnalysisProgressEvent): Update<ReviewDTO> {
  const fit = deltaFit(d, ev);
  if (fit === "apply") return { next: mergePlies(d, ev), refetch: false };
  if (fit === "gap") {
    const next = nextCheckpointAfter(d.analysis?.gradedPlies ?? 0, ev.totalPlies);
    return { next: d, refetch: next !== null && ev.gradedPlies >= next };
  }
  // closed: done/skipped ignore it (a regrade); a payload with no analysis yet (status none) needs the A1 skeleton.
  return { next: d, refetch: d.status !== "done" && d.status !== "skipped" && d.analysis === null };
}

/** `analysis:failed`: the failure card, graded plies kept. Newer graded plies than the cache holds → refetch A1. */
export function reviewOnFailed(d: ReviewDTO, ev: AnalysisFailedEvent): Update<ReviewDTO> {
  if (d.status === "done" || d.status === "skipped") return { next: d, refetch: false };
  if (!d.analysis) return { next: d, refetch: true };
  const failure = { failedAtPly: ev.failedAtPly, retryable: ev.retryable, retryAt: ev.retryAt, code: ev.code };
  return {
    next: { ...d, status: "failed", analysis: { ...d.analysis, failure, queue: null } },
    refetch: ev.gradedPlies > d.analysis.gradedPlies,
  };
}

/** The status DTO (A2's shape) after an event, so the poller and the game-over card agree with the socket. */
export function statusOnEvent<N extends GameAnalysisEventName>(
  s: ReviewStatusDTO,
  name: N,
  payload: AnalysisEventPayload<N>,
): ReviewStatusDTO {
  const a = s.analysis;
  switch (name) {
    case "analysis:queued": {
      if (a.status === "done" || a.status === "skipped") return s;
      const ev = payload as AnalysisQueuedEvent;
      return { ...s, analysis: { ...a, status: "queued", etaSec: ev.etaSec, failedAtPly: null, code: null, retryAt: null } };
    }
    case "analysis:progress": {
      const ev = payload as AnalysisProgressEvent;
      if (a.status === "done" || a.status === "skipped" || ev.gradedPlies <= a.gradedPlies) return s;
      return {
        ...s,
        analysis: { ...a, status: "running", gradedPlies: ev.gradedPlies, totalPlies: ev.totalPlies, failedAtPly: null, code: null, retryAt: null },
      };
    }
    case "analysis:failed": {
      const ev = payload as AnalysisFailedEvent;
      if (a.status === "done" || a.status === "skipped") return s;
      return {
        ...s,
        analysis: {
          ...a,
          status: "failed",
          gradedPlies: Math.max(a.gradedPlies, ev.gradedPlies),
          totalPlies: ev.totalPlies,
          failedAtPly: ev.failedAtPly,
          retryable: ev.retryable,
          retryAt: ev.retryAt,
          code: ev.code,
          etaSec: null,
        },
      };
    }
    case "analysis:done": {
      const ev = payload as AnalysisDoneEvent;
      return {
        ...s,
        analysis: { ...a, status: "done", gradedPlies: a.totalPlies, failedAtPly: null, code: null, retryAt: null, etaSec: null },
        review: { ready: true, accuracy: ev.accuracy, momentsCount: ev.momentsCount, isClean: ev.isClean, coachLine: ev.coachLine },
      };
    }
    default:
      return s;
  }
}

/** Applies one event to the review caches of its game. Returns true when A1 was invalidated (refetch). */
export function applyAnalysisEvent<N extends GameAnalysisEventName>(
  qc: QueryClient,
  ref: string,
  name: N,
  payload: AnalysisEventPayload<N>,
): boolean {
  let refetch = false;
  const detailKey = qk.review.detail(ref);
  const statusKey = qk.review.status(ref);
  const detail = qc.getQueryData<ReviewDTO>(detailKey);
  if (detail) {
    let u: Update<ReviewDTO> | null = null;
    if (name === "analysis:queued") u = reviewOnQueued(detail, payload as AnalysisQueuedEvent);
    else if (name === "analysis:progress") u = reviewOnProgress(detail, payload as AnalysisProgressEvent);
    else if (name === "analysis:failed") u = reviewOnFailed(detail, payload as AnalysisFailedEvent);
    else if (name === "analysis:done") u = { next: detail, refetch: true };
    if (u) {
      if (u.next !== detail) qc.setQueryData(detailKey, u.next);
      refetch = u.refetch;
    }
  }
  const status = qc.getQueryData<ReviewStatusDTO>(statusKey);
  if (status) {
    const next = statusOnEvent(status, name, payload);
    if (next !== status) qc.setQueryData(statusKey, next);
  }
  if (refetch) void qc.invalidateQueries({ queryKey: detailKey, exact: true });
  return refetch;
}

type Frame = { gameRef?: unknown; useq?: unknown };

let validator: Promise<((name: AnalysisEventName, payload: unknown) => void) | null> | null = null;

/** Dev-only contract check of every frame (the dynamic import keeps zod out of production chunks). */
function validateDev(name: AnalysisEventName, payload: unknown): void {
  if (process.env.NODE_ENV !== "production") {
    validator ??= import("@repo/contracts/socket/analysis")
      .then(({ ANALYSIS_EVENTS }) => (n: AnalysisEventName, p: unknown) => {
        const r = ANALYSIS_EVENTS[n].safeParse(p);
        if (!r.success) console.error(`[realtime] "${n}" does not match its contract`, r.error.issues);
      })
      .catch(() => null);
    void validator.then((v) => v?.(name, payload));
  }
}

/**
 * Listens to the analysis events of one game while mounted (and `enabled`), keeping the review caches current and
 * calling `onEvent` for each one. Holds the socket ("review"). The handler reads `onEvent` through a ref, so a new
 * callback per render never re-subscribes.
 */
export function useAnalysisEvents(
  gameRef: string,
  options: { enabled?: boolean; onEvent?: AnalysisEventHandler } = {},
): void {
  const qc = useQueryClient();
  const enabled = options.enabled ?? true;
  const onEvent = useRef(options.onEvent);
  useEffect(() => {
    onEvent.current = options.onEvent;
  });

  useEffect(() => {
    const rt = getRealtime();
    if (!rt || !enabled) return;
    const release = rt.acquire("review");
    const offs = GAME_ANALYSIS_EVENTS.map((name) =>
      rt.on<Frame>(name, (frame) => {
        if (!frame || frame.gameRef !== gameRef) return;
        if (typeof frame.useq === "number") rt.noteUseq(frame.useq);
        validateDev(name, frame);
        const payload = frame as unknown as AnalysisEventPayload<typeof name>;
        analysisBreadcrumb(name, payload);
        applyAnalysisEvent(qc, gameRef, name, payload);
        onEvent.current?.(name, payload);
      }),
    );
    // Reconnect resync (CDL 5.3, AP-25): when `session:hello` says user-room events may have been missed, a review
    // that is not done is marked stale (one A1 GET, 304 when nothing changed). A done review cannot have changed.
    const offHello = rt.onHello((_hello, resync) => {
      if (!resync) return;
      const d = qc.getQueryData<ReviewDTO>(qk.review.detail(gameRef));
      if (d && d.status !== "done" && d.status !== "skipped") {
        void qc.invalidateQueries({ queryKey: qk.review.detail(gameRef), exact: true, refetchType: "active" });
      }
      void qc.invalidateQueries({ queryKey: qk.review.status(gameRef), exact: true, refetchType: "active" });
    });
    return () => {
      for (const off of offs) off();
      offHello();
      release();
    };
  }, [qc, gameRef, enabled]);
}

/** The archive's throttle: at most one `games.*` refresh per tab every 10 s (plan §5.1). */
export const GAMES_REFRESH_MIN_MS = 10_000;

/**
 * The archive's live hook (`/games`, WP-G): `games:changed`, `analysis:batch` and `analysis:done` mark `games.*`
 * stale, throttled to one refresh per 10 s per tab, refetching only the active queries.
 */
export function useGamesLive(options: { enabled?: boolean } = {}): void {
  const qc = useQueryClient();
  const enabled = options.enabled ?? true;
  useEffect(() => {
    const rt = getRealtime();
    if (!rt || !enabled) return;
    const release = rt.acquire("review");
    let last = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const refresh = () => {
      const now = Date.now();
      const wait = last + GAMES_REFRESH_MIN_MS - now;
      if (wait > 0) {
        timer ??= setTimeout(() => {
          timer = null;
          refresh();
        }, wait);
        return;
      }
      last = now;
      void qc.invalidateQueries({ queryKey: qk.games.all(), refetchType: "active" });
    };
    const names = ["games:changed", "analysis:batch", "analysis:done"] as const;
    const offs = names.map((name) =>
      rt.on<Frame>(name, (frame) => {
        if (typeof frame?.useq === "number") rt.noteUseq(frame.useq);
        validateDev(name, frame);
        refresh();
      }),
    );
    const offHello = rt.onHello((_hello, resync) => {
      if (resync) refresh();
    });
    return () => {
      for (const off of offs) off();
      offHello();
      if (timer) clearTimeout(timer);
      release();
    };
  }, [qc, enabled]);
}
