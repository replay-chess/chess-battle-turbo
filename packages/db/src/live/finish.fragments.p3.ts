// Phase 3 pieces of the finish statement (phase-03 plan §7.4, §7.6; P3-D7, P3-D27, P3-D29). Every finished game gets
// its ANALYZE_GAME job IN THE SAME STATEMENT that finishes it, so a finish without a job is impossible:
//
//   g's SET   "analysisStatus" = QUEUED (≥ ANALYSIS_MIN_PLIES plies) or SKIPPED (shorter games: no job)
//   p3_jobs   INSERT INTO jobs … ON CONFLICT ("dedupeKey") DO NOTHING, at JOB_PRIORITY.GAME_ENDED; the payload's
//             gameRef and reason come from the game row itself (FinishGameInput carries no ref; "referenceId" and
//             "mode" are immutable, so the statement's snapshot of the row is correct)
//   SELECT    "analysisQueued" (the job this statement inserted, 0/1), "analysisAhead" (QUEUED jobs that will run
//             first, for the ETA) and "analysisStatusBefore" (the stored status before this statement: NONE on a
//             first finish, the real state on a replayed finish, whose g CTE updates nothing)
//
// There is deliberately no gamesVersion fragment: P2's `uv` CTE already bumps it once per member per finish (a second
// bump here would double-count, and P2's finish test asserts one). The abort statement (abort.ts) sets SKIPPED.
//
// Registration is a static list (P3_FINISH_FRAGMENTS, spread into finish.ts's fragment list), not a side-effect
// import: @repo/db is `sideEffects: false`, so a bare import could be dropped by a bundler, and this file imports
// only TYPES from ./finish (no ESM cycle). Every caller of finishGame() (the socket outbox and boot restore, the web
// bot `complete`) therefore enqueues. Callers read the outcome with finishAnalysisOf() and kick the worker after the
// commit; the kick is a wake-up only (the worker's reaper and the web's lost-kick heal recover a lost one).
import { Prisma } from "#generated";
import {
  ANALYSIS_MIN_PLIES,
  JOB_MAX_ATTEMPTS,
  JOB_PRIORITY,
  analysisEtaSec,
  analyzeDedupeKey,
} from "@repo/contracts/internal/jobs";
import type { FinishFragment, FinishGameInput, FinishGameResult } from "./finish";

/** True when the finished game is long enough to analyse (§7.6: shorter games are SKIPPED and get no job). */
export function analysisEligible(plyCount: number): boolean {
  return plyCount >= ANALYSIS_MIN_PLIES;
}

/** The P3 fragment: the analysis status in g's SET, the job CTE and the three SELECT columns. */
export const P3_ANALYSIS_FRAGMENT: FinishFragment = {
  name: "p3_jobs",
  gameSet: (input: FinishGameInput) => [
    analysisEligible(input.plyCount)
      ? Prisma.sql`"analysisStatus" = 'QUEUED'::"AnalysisStatus"`
      : Prisma.sql`"analysisStatus" = 'SKIPPED'::"AnalysisStatus"`,
  ],
  cte: (input: FinishGameInput) => Prisma.sql`
      INSERT INTO jobs (kind, priority, "fairSeq", "dedupeKey", "gameId", payload, "runAt", "maxAttempts")
      SELECT 'ANALYZE_GAME'::"JobKind", ${JOB_PRIORITY.GAME_ENDED}::smallint, 0, ${analyzeDedupeKey(input.gameId)}::varchar(120),
             g.id,
             jsonb_build_object('v', 1, 'gameId', g.id::text, 'gameRef', x."referenceId",
                                'reason', CASE WHEN x.mode IN ('BOT', 'LEGEND_BOT') THEN 'bot_end' ELSE 'live_end' END),
             (now() AT TIME ZONE 'UTC'), ${JOB_MAX_ATTEMPTS.ANALYZE_GAME}::smallint
        FROM g JOIN games x ON x.id = g.id
       WHERE ${analysisEligible(input.plyCount)}::boolean
      ON CONFLICT ("dedupeKey") DO NOTHING
      RETURNING id`,
  select: (input: FinishGameInput) => [
    Prisma.sql`(SELECT count(*) FROM p3_jobs)::int AS "analysisQueued"`,
    // Jobs that run before a new GAME_ENDED job (higher or equal priority, already due; the claim index
    // jobs_ready_idx serves it). The game's own job is excluded (on a replay it is visible).
    Prisma.sql`CASE WHEN ${analysisEligible(input.plyCount)}::boolean THEN (
        SELECT count(*) FROM jobs q
         WHERE q.status = 'QUEUED' AND q.priority >= ${JOB_PRIORITY.GAME_ENDED}::smallint
           AND q."runAt" <= (now() AT TIME ZONE 'UTC') AND q."dedupeKey" IS DISTINCT FROM ${analyzeDedupeKey(input.gameId)}
      )::int ELSE 0 END AS "analysisAhead"`,
    Prisma.sql`(SELECT b."analysisStatus"::text FROM games b WHERE b.id = ${input.gameId}) AS "analysisStatusBefore"`,
  ],
};

/** Every P3 fragment, in order. finish.ts starts its fragment list with these. */
export const P3_FINISH_FRAGMENTS: readonly FinishFragment[] = [P3_ANALYSIS_FRAGMENT];

// ── The outcome, for the callers (socket outbox, web bot complete) ──────────────────────────────────────────────
// The ETA shown before the first progress frame: the shared model in @repo/contracts/internal/jobs (the web's A2
// answers with the same function), nothing is graded yet.

const STORED_STATUSES = ["NONE", "QUEUED", "RUNNING", "DONE", "FAILED", "SKIPPED"] as const;
export type StoredAnalysisStatus = (typeof STORED_STATUSES)[number];

/** What a finish means for analysis (finishAnalysisOf). */
export interface FinishAnalysis {
  /**
   * The game-over seed (`game:result.review`, the bot `complete` response): `queued` when the game has (or just
   * got) a job, `skipped` when it is too short. A replay of a finish whose game was never enqueued (`NONE`, a game
   * finished by pre-P3 code) also answers `skipped`: there is no job to wait for, and the card's own A2 read shows
   * the real state.
   */
  review: { status: "queued" | "skipped"; etaSec: number | null };
  /** The stored status after the statement (QUEUED/SKIPPED for a fresh finish; the stored one on a replay). */
  status: StoredAnalysisStatus;
  /** This statement inserted the ANALYZE_GAME job. */
  created: boolean;
  /** QUEUED jobs that run first (0 when none is queued). */
  ahead: number;
  /** Kick the worker after the commit: a job is waiting (fresh, or a replay whose job is still QUEUED). */
  kick: boolean;
}

function storedStatusOf(value: unknown): StoredAnalysisStatus | null {
  return typeof value === "string" && (STORED_STATUSES as readonly string[]).includes(value) ? (value as StoredAnalysisStatus) : null;
}

function intOf(value: unknown): number {
  const n = typeof value === "bigint" ? Number(value) : typeof value === "number" ? value : Number(value ?? 0);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

/**
 * Reads the P3 columns of a finishGame() result. `plyCount` is the finish input's (the stored one on a replay is the
 * same game). Returns null only when the result carries no P3 columns (a finishGame built without the fragment).
 */
export function finishAnalysisOf(result: Pick<FinishGameResult, "finished" | "extra">, plyCount: number): FinishAnalysis | null {
  const extra = result.extra;
  if (!("analysisQueued" in extra) || !("analysisStatusBefore" in extra)) return null;
  const created = intOf(extra.analysisQueued) > 0;
  const ahead = intOf(extra.analysisAhead);
  const eta = (n: number) => analysisEtaSec({ ahead, remainingPlies: n });
  if (result.finished) {
    if (!analysisEligible(plyCount)) {
      return { review: { status: "skipped", etaSec: null }, status: "SKIPPED", created: false, ahead: 0, kick: false };
    }
    return { review: { status: "queued", etaSec: eta(plyCount) }, status: "QUEUED", created, ahead, kick: true };
  }
  // A replayed finish: the g CTE matched nothing, so the stored status is the truth.
  const stored = storedStatusOf(extra.analysisStatusBefore) ?? "NONE";
  switch (stored) {
    case "QUEUED":
      return { review: { status: "queued", etaSec: eta(plyCount) }, status: stored, created: false, ahead, kick: true };
    case "RUNNING":
    case "DONE":
    case "FAILED":
      return { review: { status: "queued", etaSec: null }, status: stored, created: false, ahead: 0, kick: false };
    case "SKIPPED":
    case "NONE":
      return { review: { status: "skipped", etaSec: null }, status: stored, created: false, ahead: 0, kick: false };
  }
}
