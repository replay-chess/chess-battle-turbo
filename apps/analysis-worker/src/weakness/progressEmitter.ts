// `weakness:progress` and the first-build trigger (phase-06 plan §7.4.4, §7.3, §8.13). `maybeEmitWeaknessProgress`
// runs after each ANALYZE_GAME commit, after each import page and when a recompute starts, for members WITHOUT a READY
// profile (they are watching the Computing screen):
//
//   1. the in-memory member state (TTL 10 min): zone, scope, trial, `hasReady`; a member with a READY profile returns
//      at once (no query). A miss costs one read (context.ts, the recompute's own context statement);
//   2. the probe (one statement: the game_players part of Q-W3 over the member's scope, the active analysis jobs, the
//      recompute row, the active import runs);
//   3. TRN computeProgress (the same function TR-5 runs, so the socket frame and the polling payload agree), with
//      `secPerGame` = the rolling median of the last 50 ANALYZE_GAME durations of this process and one engine lane;
//   4. emit when the percentage moved ≥ 5 points or ≥ 10 s passed since the member's last frame
//      (WEAKNESS_PROGRESS_STEP_PCT / WEAKNESS_PROGRESS_MIN_GAP_MS);
//   5. when the in-scope analysed count reaches 5, 10, 15 or 20 and more: arm `first_build` (GAME_ENDED, now, no
//      debounce) and wake the I/O lane.
//
// Best effort, like every emit: an error is logged and never fails the analysis or the import that called it. No
// timer: a frame inside the gap is dropped (the next analysis or the TR-5 poll carries the numbers).
import { WEAKNESS_PROGRESS_MIN_GAP_MS, WEAKNESS_PROGRESS_STEP_PCT } from "@repo/contracts/socket/user";
import { PRELIMINARY_FROM } from "@repo/chess-training/weakness/constants";
import { computeProgress } from "@repo/chess-training/weakness/progress";
import type { RecomputeState } from "@repo/chess-training/weakness/status";
import type { WeaknessScope } from "@repo/chess-training/weakness/types";
import { num, numOrNull, stmt, type Db, type Row, type Statement } from "../db/client";
import type { Logger } from "../obs/log";
import type { Clock } from "../scheduler/clock";
import type { EmitSink } from "../socket/emit";
import { isWeaknessTrialing, loadWeaknessContext, scopeOf } from "./context";
import type { WeaknessSettings } from "./settings";
import type { Telemetry } from "../obs/telemetry";
import { coalescedOf, firstBuildStatement } from "./triggers";

/** How long the member state (zone, scope, `hasReady`) is trusted (§7.4.4: TTL 10 min). */
export const STATE_TTL_MS = 10 * 60_000;
/** ANALYZE_GAME durations kept for the median (§7.4.4: the last 50). */
export const DURATION_SAMPLES = 50;
/** An import page probes at most this often per member (pages land every few hundred ms). */
export const IMPORT_PROBE_MIN_MS = 5_000;
/** The engine lanes of one worker (one Stockfish lane, P3). */
export const ENGINE_LANES = 1;

export interface ProgressProbe {
  inScope: number;
  analysed: number;
  activeAnalyze: number;
  recompute: RecomputeState;
  lastAnalysedAtMs: number | null;
  importRunning: boolean;
  importDone: number;
  importTotal: number;
  hasReady: boolean;
  snapshot: boolean;
}

/** The probe (one statement): Q-W3's game_players part over the scope, the member's jobs, the active import runs. */
export function probeStatement(userId: string, since: Date, scope: Pick<WeaknessScope, "timeClasses" | "maxGames">): Statement {
  return stmt(
    `WITH s AS (
  SELECT gp."gameId", gp.accuracy, gp."weaknessInputsV" AS v
    FROM game_players gp JOIN games g ON g.id = gp."gameId"
   WHERE gp."userId" = $1::bigint AND gp."endedAt" >= ($2::timestamptz AT TIME ZONE 'UTC')
     AND gp."timeClass"::text = ANY($3::text[])
     AND gp.mode NOT IN ('BOT', 'LEGEND_BOT') AND gp.result IS DISTINCT FROM 'ABORTED'
     AND NOT (gp.source <> 'REPLAY' AND (CASE gp.color WHEN 'w' THEN g."blackTitle" ELSE g."whiteTitle" END) IS NOT DISTINCT FROM 'BOT')
   ORDER BY gp."endedAt" DESC, gp."gameId" DESC
   LIMIT $4
)
SELECT (SELECT count(*) FROM s)::int AS "inScope",
       (SELECT count(*) FROM s WHERE accuracy IS NOT NULL
          AND (s.v >= 1 OR (s.v = 0 AND EXISTS (SELECT 1 FROM game_analyses ga WHERE ga."gameId" = s."gameId" AND ga."completedAt" IS NOT NULL))))::int
         AS analysed,
       (SELECT (extract(epoch FROM max(ga."completedAt")) * 1000)::float8 FROM s JOIN game_analyses ga ON ga."gameId" = s."gameId")
         AS "lastAnalysedAtMs",
       (SELECT count(*) FROM jobs j WHERE j."userId" = $1::bigint AND j.kind = 'ANALYZE_GAME'
                                      AND j.status IN ('QUEUED', 'RUNNING'))::int AS "activeAnalyze",
       (SELECT j.status::text FROM jobs j WHERE j."dedupeKey" = 'weakness:' || $1::bigint::text
                                            AND j.status IN ('QUEUED', 'RUNNING')) AS recompute,
       (SELECT count(*) FROM import_runs r WHERE r."userId" = $1::bigint AND r.status IN ('QUEUED', 'RUNNING'))::int AS "importRuns",
       (SELECT COALESCE(sum(r.seen), 0) FROM import_runs r WHERE r."userId" = $1::bigint AND r.status = 'RUNNING')::int AS "importDone",
       (SELECT COALESCE(sum(r.total), 0) FROM import_runs r WHERE r."userId" = $1::bigint AND r.status = 'RUNNING')::int AS "importTotal",
       COALESCE((SELECT ws.status = 'READY' FROM weakness_snapshots ws WHERE ws."userId" = $1::bigint
                  ORDER BY ws."weekStart" DESC LIMIT 1), false) AS "hasReady",
       EXISTS (SELECT 1 FROM weakness_snapshots ws WHERE ws."userId" = $1::bigint) AS snapshot`,
    [userId, since.toISOString(), [...scope.timeClasses], scope.maxGames],
  );
}

export function toProbe(r: Row | undefined): ProgressProbe {
  const rec = r?.recompute === "RUNNING" ? "running" : r?.recompute === "QUEUED" ? "queued" : "none";
  return {
    inScope: num(r?.inScope ?? 0),
    analysed: num(r?.analysed ?? 0),
    activeAnalyze: num(r?.activeAnalyze ?? 0),
    recompute: rec,
    lastAnalysedAtMs: numOrNull(r?.lastAnalysedAtMs),
    importRunning: num(r?.importRuns ?? 0) > 0,
    importDone: num(r?.importDone ?? 0),
    importTotal: num(r?.importTotal ?? 0),
    hasReady: r?.hasReady === true,
    snapshot: r?.snapshot === true,
  };
}

interface MemberState {
  loadedAtMs: number;
  hasReady: boolean;
  timeZone: string;
  scope: WeaknessScope;
  since: Date;
  trialing: boolean;
  lastPct: number | null;
  lastEmitMs: number | null;
  lastCount: number | null;
  lastProbeMs: number | null;
}

export interface ProgressEmitterOptions {
  db: Db;
  emitter: EmitSink;
  clock: Clock;
  log: Logger;
  settings: WeaknessSettings;
  /** Wakes the I/O lane after a `first_build` was armed (its sleep may be a day long). */
  wakeIo?: () => void;
  /** Sentry metrics (FIX-1: `worker.weakness.coalesced`). */
  telemetry?: Telemetry;
}

/** Why a probe runs (the import hook probes at most every 5 s per member). */
export type ProgressReason = "analysis" | "import" | "recompute";

export class WeaknessProgressEmitter {
  private readonly members = new Map<string, MemberState>();
  private readonly durations: number[] = [];

  constructor(private readonly opts: ProgressEmitterOptions) {}

  /** An ANALYZE_GAME of this process took `ms` (the median feeds the ETA). */
  noteAnalysisMs(ms: number): void {
    if (!Number.isFinite(ms) || ms <= 0) return;
    this.durations.push(ms);
    if (this.durations.length > DURATION_SAMPLES) this.durations.shift();
  }

  /** Seconds per analysed game: the median of the last 50 durations, or null before the first. */
  secPerGame(): number | null {
    if (this.durations.length === 0) return null;
    const sorted = [...this.durations].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    const m = sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
    return m / 1000;
  }

  /** A snapshot write: a READY profile stops the frames (the member's page shows the profile). */
  noteSnapshot(userId: string, ready: boolean): void {
    const s = this.members.get(userId);
    // FIX-2: the newest snapshot decides (an INSUFFICIENT row after a purge turns the frames back on).
    if (s) s.hasReady = ready;
  }

  /** Forgets every member (tests). */
  reset(): void {
    this.members.clear();
  }

  private async state(userId: string): Promise<MemberState | null> {
    const now = this.opts.clock.now();
    const hit = this.members.get(userId);
    if (hit && now - hit.loadedAtMs < STATE_TTL_MS) return hit;
    const c = await loadWeaknessContext(this.opts.db, userId);
    if (!c) return null;
    const { scope, since } = scopeOf(c, new Date(now));
    const state: MemberState = {
      loadedAtMs: now,
      hasReady: c.hadReady,
      timeZone: c.timeZone,
      scope,
      since,
      trialing: isWeaknessTrialing(c, now),
      lastPct: hit?.lastPct ?? null,
      lastEmitMs: hit?.lastEmitMs ?? null,
      lastCount: hit?.lastCount ?? null,
      lastProbeMs: hit?.lastProbeMs ?? null,
    };
    this.members.set(userId, state);
    return state;
  }

  /**
   * §7.4.4 for one member (see the header). `importNumbers`: the import page's own progress (the run's newest
   * numbers). Returns what happened (tests and logs); never throws.
   */
  async maybeEmit(
    member: { userId: string; userRef: string },
    reason: ProgressReason,
    importNumbers?: { done: number; total: number | null },
  ): Promise<{ emitted: boolean; firstBuild: boolean; skipped?: "ready" | "throttled" | "disabled" | "gone" }> {
    if (!this.opts.settings.enabled) return { emitted: false, firstBuild: false, skipped: "disabled" };
    try {
      const st = await this.state(member.userId);
      if (!st) return { emitted: false, firstBuild: false, skipped: "gone" };
      if (st.hasReady) return { emitted: false, firstBuild: false, skipped: "ready" };
      const now = this.opts.clock.now();
      if (reason === "import" && st.lastProbeMs !== null && now - st.lastProbeMs < IMPORT_PROBE_MIN_MS) {
        return { emitted: false, firstBuild: false, skipped: "throttled" };
      }
      st.lastProbeMs = now;
      const probe = toProbe((await this.opts.db.query(probeStatement(member.userId, st.since, st.scope)))[0]);
      if (probe.hasReady) {
        st.hasReady = true;
        return { emitted: false, firstBuild: false, skipped: "ready" };
      }
      // The recompute's own frame never arms `first_build`: it would flag the very row that is running (rerun).
      const firstBuild = reason === "recompute" ? false : await this.maybeFirstBuild(member.userId, st, probe.analysed, now);
      if (reason === "recompute") st.lastCount = probe.analysed;
      const importRunning = importNumbers ? importNumbers.total === null || importNumbers.done < importNumbers.total : probe.importRunning;
      const progress = computeProgress(
        {
          analysedInScope: probe.analysed,
          inScope: probe.inScope,
          isTrialing: st.trialing,
          importRunning,
          importDone: importNumbers?.done ?? probe.importDone,
          importTotal: importNumbers?.total ?? probe.importTotal,
          importRatePerSec: null,
          recompute: reason === "recompute" ? "running" : firstBuild && probe.recompute === "none" ? "queued" : probe.recompute,
          hasReady: false,
          snapshot: probe.snapshot,
          activeAnalyzeJobs: probe.activeAnalyze,
          lastAnalysedAt: probe.lastAnalysedAtMs === null ? null : new Date(probe.lastAnalysedAtMs),
          secPerGame: this.secPerGame(),
          lanes: ENGINE_LANES,
          queueAheadSec: 0,
          bandLabel: null,
        },
        new Date(now),
      );
      const moved = st.lastPct === null || Math.abs(progress.pct - st.lastPct) >= WEAKNESS_PROGRESS_STEP_PCT;
      const waited = st.lastEmitMs === null || now - st.lastEmitMs >= WEAKNESS_PROGRESS_MIN_GAP_MS;
      if (!moved && !waited) return { emitted: false, firstBuild, skipped: "throttled" };
      const step = progress.steps.find((s) => s.state === "run")?.key ?? "compare";
      const importing = importRunning && (importNumbers?.total ?? probe.importTotal) > 0;
      const sent = await this.opts.emitter.emit(
        "weakness:progress",
        {
          v: 1,
          pct: progress.pct,
          step,
          etaSec: progress.etaSec,
          stalled: progress.stalled,
          analysed: progress.analysed,
          target: progress.target,
          importDone: importing ? (importNumbers?.done ?? probe.importDone) : null,
          importTotal: importing ? (importNumbers?.total ?? probe.importTotal) : null,
        },
        [member.userRef],
      );
      st.lastPct = progress.pct;
      st.lastEmitMs = now;
      return { emitted: sent === "sent", firstBuild };
    } catch (error) {
      this.opts.log.warn("weakness progress failed", { reason, error });
      return { emitted: false, firstBuild: false };
    }
  }

  /**
   * Step 5: arm `first_build` whenever the analysed count moved, from 5 on (FIX-1; the plan armed it at 5, 10, 15 and
   * ≥ 20 only). The insufficient page shows the live count in its meter and the snapshot's count in its preliminary
   * rows ("Seen in 8 of 10 games" next to "12 / 20"); rebuilding the INSUFFICIENT snapshot after each analysis keeps
   * the two the same (a few cheap statements per game, only until the first READY profile).
   */
  private async maybeFirstBuild(userId: string, st: MemberState, analysed: number, now: number): Promise<boolean> {
    const last = st.lastCount;
    st.lastCount = analysed;
    if (analysed < PRELIMINARY_FROM) return false;
    if (last !== null && last === analysed) return false;
    const s = firstBuildStatement(userId, now, this.opts.settings);
    if (!s) return false;
    const rows = await this.opts.db.query(s);
    if (rows.length > 0) this.opts.wakeIo?.();
    const coalesced = coalescedOf(rows);
    if (coalesced > 0) this.opts.telemetry?.metric("count", "worker.weakness.coalesced", coalesced, { trigger: "first_build" });
    return rows.length > 0;
  }
}
