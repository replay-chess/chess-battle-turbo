// The page status (phase-06 plan §8.14), decided on the server from the latest snapshot and the live probe. Total over
// its inputs (the property test enumerates the product). Snapshots store READY / INSUFFICIENT / FAILED; COMPUTING is
// only ever derived here. Browser-safe.
import type { WeaknessStatus } from "@repo/contracts/http/weakness";
import { GAMES_REQUIRED, PRELIMINARY_FROM } from "./constants";
import type { SnapshotStatus } from "./types";

export type RecomputeState = "none" | "queued" | "running";
/** The wire status (CT `WeaknessStatus`). */
export type PageStatus = WeaknessStatus;

export interface StatusInput {
  snapshot: { status: SnapshotStatus; gamesAnalysed: number } | null;
  /** The member's RECOMPUTE_WEAKNESS row: none (DONE, FAILED or absent), QUEUED or RUNNING. */
  recompute: RecomputeState;
  /** The last recompute exhausted its attempts. */
  lastJobFailed: boolean;
  /** A linked account's import is running. */
  importRunning: boolean;
  /**
   * QUEUED + RUNNING ANALYZE_GAME jobs of the member (FIX-1). Without one, no import and no recompute, nothing will
   * analyse more games, so "computing" would never end: the page is insufficient instead. Absent = unknown (treated as
   * work still pending, the plan's rule).
   */
  activeAnalyzeJobs?: number;
  /** FIX-1: the last recompute was skipped by the worker's kill switch (WEAKNESS_JOBS_ENABLED off). */
  paused?: boolean;
  analysedInScope: number;
  inScope: number;
  /** Bullet games in the scope's window (the bullet offer). */
  bulletGames?: number;
  /** The scope already includes BULLET (no offer then). */
  scopeHasBullet?: boolean;
}

export interface StatusResult {
  status: PageStatus;
  /** READY with a recompute pending: the "Updating with {n} new games…" chip (shown when newGames > 0 or RUNNING). */
  updating: { newGames: number } | null;
  /**
   * Nothing will build or finish the profile on its own: ≥ 5 analysed in scope, no recompute job, and no snapshot
   * (plan §8.14), or an INSUFFICIENT snapshot although 20 are analysed now. The page sends one auto-build TR-12.
   */
  orphaned: boolean;
  /** Insufficient, and the window's bullet games would fill the gap: "You have 64 bullet games … Include them?". */
  offerBullet: boolean;
  /** FIX-1: profile updates are paused (kill switch) and there is no READY profile: shown as failed, not retryable. */
  paused: boolean;
}

export function deriveStatus(i: StatusInput): StatusResult {
  const analysed = Math.max(0, i.analysedInScope);
  // Kill switch (FIX-1): the web cannot read the worker's env, but the job row says it: the last run was skipped.
  // Only where a build would otherwise run (≥ 5 analysed): with fewer games the page still asks for games.
  const paused = i.paused === true && i.recompute === "none" && i.snapshot?.status !== "READY" && analysed >= PRELIMINARY_FROM;
  // FIX-2 (D-P6-FIX2-7): an INSUFFICIENT snapshot is orphaned only when games were analysed since it was written (the
  // live count, which counts exactly the worker's set, is above the snapshot's). Equal or lower: the worker already
  // looked at these games; building again would write the same row, and the page would stay "computing" for good.
  const orphaned =
    !paused &&
    i.recompute === "none" &&
    analysed >= PRELIMINARY_FROM &&
    (i.snapshot === null ||
      (i.snapshot.status === "INSUFFICIENT" && analysed >= GAMES_REQUIRED && analysed > i.snapshot.gamesAnalysed));
  // More games will be analysed only while an import runs, analyses are queued or running, or a recompute is pending
  // (its coverage step queues them). Unknown (absent) counts as pending: the plan's rule.
  const analysing = i.importRunning || i.recompute !== "none" || (i.activeAnalyzeJobs ?? 1) > 0;
  let status: PageStatus;
  let updating: StatusResult["updating"] = null;
  if (i.snapshot?.status === "READY") {
    status = "ready";
    if (i.recompute !== "none") updating = { newGames: Math.max(0, analysed - i.snapshot.gamesAnalysed) };
  } else if (paused) {
    status = "failed";
  } else if ((i.snapshot?.status === "FAILED" || i.lastJobFailed) && i.recompute === "none") {
    status = "failed";
  } else if (analysed >= GAMES_REQUIRED && (analysing || orphaned)) {
    status = "computing";
  } else if (i.importRunning || (i.inScope >= GAMES_REQUIRED && analysing)) {
    // FIX-1: 20 games in scope but nothing left to analyse them (too short, failed, past the trial's eager budget):
    // the page is insufficient (meter and preliminary rows), never "computing" at a fixed ETA for good.
    status = "computing";
  } else {
    status = "insufficient";
  }
  const offerBullet =
    status === "insufficient" &&
    !i.scopeHasBullet &&
    i.inScope < GAMES_REQUIRED &&
    (i.bulletGames ?? 0) > 0 &&
    (i.bulletGames ?? 0) >= GAMES_REQUIRED - i.inScope;
  return { status, updating, orphaned: orphaned && status !== "ready" && status !== "failed", offerBullet, paused: paused && status === "failed" };
}
