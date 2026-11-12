// The P3 part of `POST /api/games/[ref]/complete` (phase-03 plan §5.8, §5.11, §7.6; P3-D24, P3-D27, task E1).
//
// The finish statement itself enqueues (DB/src/live/finish.fragments.p3.ts: the ANALYZE_GAME job at GAME_ENDED, the
// QUEUED/SKIPPED status, P2's gamesVersion bump), so a finished bot game without a job is impossible. This file adds
// what the bot path owns on top:
//   - the response seed `analysis: {status, etaSec}` and `comparison` (always sent from P3 on);
//   - the legend facts of a legend-bot game (P3-D24: `complete` can read the legend continuation; the insert is
//     WP-D's idempotent `legend_facts` path through getReviewStatus, `ON CONFLICT DO NOTHING`);
//   - the follow-ups the route runs in `after()`, once the response is on its way: the worker kick (reason
//     bot_end, watching the game), `analysis:queued` and `games:changed` to the member's user room.
// A replayed complete answers the game's CURRENT analysis state (a pre-P3 game says `none`).
//
// The legend facts are derived data: if their statement fails, the complete still succeeds (the A2 read inserts
// them lazily on the game-over card's mount), so nothing here can turn a finished game into a 500.
import type { CompleteAnalysis, CompleteResponse } from "@repo/contracts/http/games";
import type { ReviewStatusDTO } from "@repo/contracts/http/review";
import { JOB_PRIORITY } from "@repo/contracts/internal/jobs";
import { GamesChangedEvent } from "@repo/contracts/socket/analysis";
import { finishAnalysisOf, type FinishGameResult } from "@repo/db/live";
import { getRouteDeps } from "@/lib/api/context";
import { InternalFetchConfigError, internalFetch } from "@/lib/internal/fetch";
import { emitAnalysisQueued, type QueuedEmit } from "@/lib/services/analysis/emit";
import { kickWorker } from "@/lib/services/analysis/kick";
import { captureReviewServerEvent } from "@/lib/services/analysis/telemetry";
import { getReviewStatus } from "@/lib/services/analysis/read";
import type { GamesDb } from "./snapshot.server";

/** What the route does after the response (all fire-and-forget, never thrown). */
export type CompleteFollowUps = {
  /** Wake the worker (a job is waiting). */
  kick: boolean;
  /** `analysis:queued` payload for the member, when a job is queued. */
  queued: QueuedEmit | null;
  /** The member's user ref (`games:changed` and `analysis:queued` go to them). */
  memberRef: string | null;
  gameRef: string;
  /**
   * `analysis_queued` (plan §10.1, once per dedupeKey): set only when THIS finish statement created the job, sent
   * with the member's ref as `distinct_id`.
   */
  queuedEvent?: { game_mode: "bot" | "legend_bot"; queue_position: number } | null;
};

export type CompleteAnalysisPart = Pick<CompleteResponse, "analysis" | "comparison">;

const SKIPPED: CompleteAnalysis = { status: "skipped", etaSec: null };

/** The A2 state of the member's side; null when it cannot be read (the caller then answers without it). */
async function statusOf(db: GamesDb, viewerId: bigint, ref: string, nowMs: number): Promise<ReviewStatusDTO | null> {
  try {
    return (await getReviewStatus(db, { id: viewerId, role: "user" }, ref, nowMs)).dto;
  } catch (err) {
    getRouteDeps().log("warn", "complete.analysis_status_failed", {
      ref,
      error: err instanceof Error ? err.name : "unknown",
    });
    return null;
  }
}

/**
 * A fresh finish (this call's statement finished the game). `isLegend`: the game was played from a legend position
 * (`chessPositionId` set), so the facts are inserted now and the block comes back in the response.
 */
export async function freshCompleteAnalysis(input: {
  db: GamesDb;
  viewerId: bigint;
  viewerRef: string | null;
  ref: string;
  finish: Pick<FinishGameResult, "finished" | "extra">;
  plies: number;
  isLegend: boolean;
  nowMs: number;
}): Promise<{ part: CompleteAnalysisPart; followUps: CompleteFollowUps }> {
  const analysis = finishAnalysisOf(input.finish, input.plies);
  const seed: CompleteAnalysis = analysis ? { status: analysis.review.status, etaSec: analysis.review.etaSec } : SKIPPED;
  let comparison: CompleteResponse["comparison"] = null;
  if (input.isLegend) {
    const status = await statusOf(input.db, input.viewerId, input.ref, input.nowMs);
    comparison = status?.comparison ?? null;
  }
  const queued =
    analysis && analysis.status === "QUEUED" && analysis.review.etaSec !== null
      ? { gameRef: input.ref, position: analysis.ahead, etaSec: analysis.review.etaSec }
      : null;
  return {
    part: { analysis: seed, comparison },
    followUps: {
      kick: analysis?.kick ?? false,
      queued,
      memberRef: input.viewerRef,
      gameRef: input.ref,
      queuedEvent: analysis?.created
        ? { game_mode: input.isLegend ? "legend_bot" : "bot", queue_position: Math.min(100_000, Math.max(0, analysis.ahead)) }
        : null,
    },
  };
}

/** A replayed complete (the game had already ended): the current state of its analysis and legend block. */
export async function storedCompleteAnalysis(input: {
  db: GamesDb;
  viewerId: bigint;
  ref: string;
  aborted: boolean;
  nowMs: number;
}): Promise<CompleteAnalysisPart> {
  if (input.aborted) return { analysis: SKIPPED, comparison: null };
  const status = await statusOf(input.db, input.viewerId, input.ref, input.nowMs);
  if (!status) return { analysis: { status: "none", etaSec: null }, comparison: null };
  return { analysis: { status: status.analysis.status, etaSec: status.analysis.etaSec }, comparison: status.comparison };
}

// ── after(): kick + user-room events ────────────────────────────────────────────────────────────────────────────
let emitFetch: typeof fetch | undefined;

/** Test seam for the `games:changed` emit transport; returns a restore function. */
export function setGamesChangedTransport(next: typeof fetch | undefined): () => void {
  const previous = emitFetch;
  emitFetch = next;
  return () => {
    emitFetch = previous;
  };
}

/** `games:changed` to the member's user room (one signed `/internal/emit`). Never throws. */
export async function emitGamesChanged(userRefs: readonly string[], gameRef: string): Promise<boolean> {
  const deps = getRouteDeps();
  const targets = Array.from(new Set(userRefs)).filter(Boolean).map((userRef) => ({ userRef }));
  if (targets.length === 0) return false;
  const data = GamesChangedEvent.safeParse({ v: 1, gameRef });
  if (!data.success) return false;
  try {
    const res = await internalFetch("/internal/emit", {
      body: { v: 1, targets, event: "games:changed", data: data.data },
      ...(emitFetch ? { fetchImpl: emitFetch } : {}),
    });
    await res.arrayBuffer().catch(() => undefined);
    if (!res.ok) deps.log("warn", "analysis.emit_refused", { event: "games:changed", status: res.status });
    return res.ok;
  } catch (err) {
    deps.log("warn", "analysis.emit_failed", {
      event: "games:changed",
      reason: err instanceof InternalFetchConfigError ? err.message : err instanceof Error ? err.name : "unknown",
    });
    return false;
  }
}

/** The route's `after()` task: kick, `analysis:queued`, `games:changed`, the `analysis_queued` event. Settles; never rejects. */
export async function runCompleteFollowUps(f: CompleteFollowUps): Promise<void> {
  const refs = f.memberRef ? [f.memberRef] : [];
  await Promise.allSettled([
    f.kick ? kickWorker({ v: 1, reason: "bot_end", watch: f.gameRef }) : Promise.resolve(null),
    f.queued ? emitAnalysisQueued(refs, f.queued) : Promise.resolve(false),
    emitGamesChanged(refs, f.gameRef),
    f.queuedEvent && f.memberRef
      ? captureReviewServerEvent(
          "analysis_queued",
          {
            game_mode: f.queuedEvent.game_mode,
            source: "replay",
            reason: "bot_end",
            priority: JOB_PRIORITY.GAME_ENDED,
            queue_position: f.queuedEvent.queue_position,
          },
          f.memberRef,
        )
      : Promise.resolve(),
  ]);
}
