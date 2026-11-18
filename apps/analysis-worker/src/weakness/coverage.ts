// J4 coverage (phase-06 plan §7.4.3; interface check §5 "Coverage caps"): enough of the member's in-scope games are
// analysed for a profile, inside P4's eager analysis budget. Runs at the start of every recompute and when an
// IMPORT_SYNC finishes. ONE statement:
//
//   analysed = the rows the recompute counts (FIX-2, D-P6-FIX2-7; TR-5 and the progress probe count the same set):
//              accuracy set and inputs usable (weaknessInputsV ≥ 1) or healable (0, analysis DONE); a −1 row (its
//              heal failed) does not count, so J4 queues a replacement for it inside the budget
//
//   target  = trialist ? WEAKNESS_ANALYSE_CAP_TRIAL (20) : WEAKNESS_ANALYSE_CAP (100)   in-scope analysed games wanted
//   want    = target − analysed in scope                                                   picks, newest first
//   room    = eagerCap − used, eagerCap = trialist ? IMPORT_ANALYSE_EAGER_TRIAL (20) : IMPORT_ANALYSE_CAP (200),
//             used = P4's budget (imported games whose analysis is queued, running or done: import/context.ts)
//   pick    = the newest in-scope games without an analysis (analysable: COMPLETED, ≥ ANALYSIS_MIN_PLIES plies,
//             analysisStatus NONE or QUEUED), rank ≤ want; a game with no job yet (NONE) also needs a NEW rank ≤ room,
//             so P6 never queues past P4's cap (a game P4 already queued costs no budget, its priority is raised)
//
// The picks needed to reach the first 20 analysed games get JOB_PRIORITY.IMPORT_NEWEST, the rest JOB_PRIORITY.WEAKNESS,
// `fairSeq` = the rank (one member's batch interleaves with other members' work). Existing QUEUED jobs are raised
// (priority, fairSeq, a fresh job's runAt pulled to now: P4's backlog slices wait days), never lowered; RUNNING,
// DONE and FAILED jobs are left alone. A new job flips its game NONE → QUEUED and bumps the members' gamesVersion (the
// archive ETag), as enqueueAnalysisSql does. Idempotent: a resend finds every pick already queued.
import { ANALYSIS_MIN_PLIES, JOB_MAX_ATTEMPTS, JOB_PRIORITY } from "@repo/contracts/internal/jobs";
import { GAMES_REQUIRED } from "@repo/chess-training/weakness/constants";
import type { WeaknessScope } from "@repo/chess-training/weakness/types";
import { num, stmt, type Db, type Statement } from "../db/client";
import { NOW } from "../queue/claim";

export interface CoverageInput {
  userId: string;
  scope: Pick<WeaknessScope, "timeClasses" | "maxGames">;
  since: Date;
  trialing: boolean;
  /** WEAKNESS_ANALYSE_CAP(_TRIAL). */
  caps: { member: number; trial: number };
  /** P4's import settings: IMPORT_ANALYSE_CAP (members) and IMPORT_ANALYSE_EAGER_TRIAL (trialists). */
  eager: { cap: number; eagerTrial: number };
}

export interface CoverageResult {
  inScope: number;
  analysed: number;
  /** P4's budget used before this statement. */
  used: number;
  picked: number;
  /** New ANALYZE_GAME jobs. */
  created: number;
  /** Existing QUEUED jobs raised. */
  raised: number;
}

export function coverageStatement(i: CoverageInput): Statement {
  const target = i.trialing ? i.caps.trial : i.caps.member;
  const eagerCap = i.trialing ? i.eager.eagerTrial : i.eager.cap;
  return stmt(
    `WITH s AS (
  SELECT gp."gameId", gp.accuracy, gp.source, gp."endedAt", g."referenceId" AS ref, g.status AS gstatus, g."plyCount",
         g."analysisStatus", gp."weaknessInputsV" AS v
    FROM game_players gp JOIN games g ON g.id = gp."gameId"
   WHERE gp."userId" = $1::bigint AND gp."endedAt" >= ($2::timestamptz AT TIME ZONE 'UTC')
     AND gp."timeClass"::text = ANY($3::text[])
     AND gp.mode NOT IN ('BOT', 'LEGEND_BOT') AND gp.result IS DISTINCT FROM 'ABORTED'
     AND NOT (gp.source <> 'REPLAY' AND (CASE gp.color WHEN 'w' THEN g."blackTitle" ELSE g."whiteTitle" END) IS NOT DISTINCT FROM 'BOT')
   ORDER BY gp."endedAt" DESC, gp."gameId" DESC
   LIMIT $4
), c AS (
  SELECT count(*) FILTER (WHERE accuracy IS NOT NULL AND (v >= 1 OR (v = 0 AND "analysisStatus" = 'DONE')))::int AS analysed,
         count(*)::int AS "inScope" FROM s
), b AS (
  SELECT count(*)::int AS used FROM game_players gp JOIN games g ON g.id = gp."gameId"
   WHERE gp."userId" = $1::bigint AND gp.source <> 'REPLAY' AND g."analysisStatus" <> 'NONE'
), lim AS (
  SELECT GREATEST(0, $5::int - c.analysed) AS want, GREATEST(0, $6::int - b.used) AS room,
         GREATEST(0, $7::int - c.analysed) AS first
    FROM c, b
), p AS (
  SELECT s."gameId", s.ref, s.source, s."analysisStatus",
         row_number() OVER w AS rank,
         count(*) FILTER (WHERE s."analysisStatus" = 'NONE') OVER w AS "newRank"
    FROM s
   WHERE s.accuracy IS NULL AND s.gstatus = 'COMPLETED' AND s."plyCount" >= $8 AND s."analysisStatus" IN ('NONE', 'QUEUED')
  WINDOW w AS (ORDER BY s."endedAt" DESC, s."gameId" DESC ROWS UNBOUNDED PRECEDING)
), pick AS (
  SELECT p."gameId", p.ref, p.source, p.rank::int AS rank,
         (CASE WHEN p.rank <= lim.first THEN $9 ELSE $10 END)::smallint AS prio
    FROM p, lim
   WHERE p.rank <= lim.want AND (p."analysisStatus" <> 'NONE' OR p."newRank" <= lim.room)
), up AS (
  INSERT INTO jobs (kind, "dedupeKey", "userId", "gameId", priority, "fairSeq", payload, "runAt", "maxAttempts", "createdAt")
  SELECT 'ANALYZE_GAME', 'analyze:' || x."gameId", $1::bigint, x."gameId", x.prio, x.rank,
         jsonb_build_object('v', 1, 'gameId', x."gameId"::text, 'gameRef', x.ref,
                            'reason', CASE WHEN x.source = 'REPLAY' THEN 'backfill' ELSE 'import' END),
         ${NOW}, $11::smallint, ${NOW}
    FROM pick x
  ON CONFLICT ("dedupeKey") DO UPDATE SET
    priority  = GREATEST(jobs.priority, EXCLUDED.priority),
    "fairSeq" = LEAST(jobs."fairSeq", EXCLUDED."fairSeq"),
    "runAt"   = CASE WHEN jobs.attempts = 0 THEN LEAST(jobs."runAt", EXCLUDED."runAt") ELSE jobs."runAt" END
  WHERE jobs.status = 'QUEUED'
  RETURNING "gameId", (xmax = 0) AS created
), g2 AS (
  UPDATE games SET "analysisStatus" = 'QUEUED', "updatedAt" = ${NOW}
    FROM up
   WHERE games.id = up."gameId" AND up.created AND games."analysisStatus" = 'NONE'
  RETURNING games.id
), uv AS (
  UPDATE users u SET "gamesVersion" = u."gamesVersion" + 1
    FROM (SELECT DISTINCT gp."userId" FROM game_players gp JOIN g2 ON g2.id = gp."gameId") m
   WHERE u.id = m."userId"
  RETURNING u.id
)
SELECT c."inScope", c.analysed, b.used, (SELECT count(*) FROM pick)::int AS picked,
       (SELECT count(*) FROM up WHERE created)::int AS created, (SELECT count(*) FROM up WHERE NOT created)::int AS raised,
       (SELECT count(*) FROM uv)::int AS bumped
  FROM c, b`,
    [
      i.userId,
      i.since.toISOString(),
      [...i.scope.timeClasses],
      i.scope.maxGames,
      target,
      eagerCap,
      GAMES_REQUIRED,
      ANALYSIS_MIN_PLIES,
      JOB_PRIORITY.IMPORT_NEWEST,
      JOB_PRIORITY.WEAKNESS,
      JOB_MAX_ATTEMPTS.ANALYZE_GAME,
    ],
  );
}

export async function ensureWeaknessCoverage(db: Db, i: CoverageInput): Promise<CoverageResult> {
  const rows = await db.query(coverageStatement(i));
  const r = rows[0] ?? {};
  return {
    inScope: num(r.inScope ?? 0),
    analysed: num(r.analysed ?? 0),
    used: num(r.used ?? 0),
    picked: num(r.picked ?? 0),
    created: num(r.created ?? 0),
    raised: num(r.raised ?? 0),
  };
}
