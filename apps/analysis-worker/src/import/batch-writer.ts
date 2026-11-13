// The import chunk writer (phase-04 plan §8.8, D4-22, D4-28, D4-30; api-perf AP-19, AP-26; feasibility F-OCI-4).
//
// ONE statement per chunk of ≤ IMPORT_CHUNK (100) games, newest first: a data-modifying CTE chain is atomic and costs
// one round trip (≈ 200 ms from Mumbai), so 2,000 games are 20 statements, not 2,000+. In order:
//
//   held   the job is still RUNNING under this worker (heart-beaten; else 22012 rolls everything back: sql.ts)
//   src    the rows (jsonb_to_recordset; ≈ 1 KB per game)
//   ins    games: INSERT … ON CONFLICT (source, "externalId") DO UPDATE … RETURNING id, (xmax = 0): the conflict
//          arbiter. A game the opponent (another member) imported first is attached, not dropped (AP-26): its
//          `whitePlayerId` / `blackPlayerId` get this member's side when it is free, and its analysis is queued
//          when it was never queued and this member's side is free
//   gp     game_players: this member's side, `linkedAccountId` set; ON CONFLICT DO NOTHING without a target, so a
//          side already held by another member (two members linked the same provider account) is never an error
//          (`game_players_gameId_color_key`)
//   cc     co-claimed sides (FIX-2, co-claim.ts): a side another member already holds (they linked the same
//          Chess.com account) gets this member's own claim copy of the game: `ins2` inserts a games row keyed
//          `coClaimExternalId` (the src row's unused `referenceId`), `gp2` this member's side of it. Every claimant
//          gets the games; nobody's side is taken. `taken` now counts only a side neither row could give
//   att    every side this statement attached (gp ∪ gp2), for the jobs, the counters and the run's first game
//   jq     ANALYZE_GAME jobs for the rows given a priority (priorities.ts), `fairSeq` = rank, payload
//          `{v, gameId, gameRef, reason: "import", importRunId, evalHint?}` (CT AnalyzeGamePayloadV1)
//   run    import_runs counters, `firstGameId` (the newest queued game, else the newest), phase, total, seen
//   acct   linked_accounts."importedCount"
//   ver    users."gamesVersion" + 1 when a row was added (the archive ETag, AP-19)
//   cur    import_cursors."lichessResumeUntilMs" = the chunk's oldest creation time (Lichess, §8.7 step 4)
//
// Every NOT NULL column without a database default is set (games."expiresAt" = "completedAt", "updatedAt"); `pgn`
// stays NULL (D4-30); games."createdAt" is the provider's creation time (Lichess `createdAt`, Chess.com
// `start_time`, else the end): the Lichess cursor of a resumed run reads it back (context.ts).
//
// Lost responses (F-OCI-4, P3-D11): the HTTP driver resends the SAME statement once. It is idempotent by
// construction: the games (and claim copies) conflict and the player rows exist, so `gp`, `gp2` and `jq` insert
// nothing and every counter adds 0; `taken` counts only sides that neither the game's row nor a claim copy holds for
// this member, so a resend reports 0 new rows, 0 taken, and the run's committed totals. The caller therefore reads the
// totals the statement returns, never its own tally.
import type { ImportedGame } from "@repo/chess-import/types";
import { JOB_MAX_ATTEMPTS } from "@repo/contracts/internal/jobs";
import { isLockLost } from "../queue/outcome";
import { coClaimExternalId } from "./co-claim";
import { num, stmt, type Db, type Statement } from "../db/client";
import type { ProviderDb } from "./context";
import { HELD_CHECK, heldCte, NOW } from "./sql";

/** Games per chunk statement (§8.8). */
export const IMPORT_CHUNK = 100;

/** A game ready to write: the mapper's output plus the worker's fields. */
export interface ChunkGame {
  game: ImportedGame;
  /** games."referenceId" for a new row (a cuid made in the worker: Prisma's default is client-side). */
  referenceId: string;
  /** Position in the run, newest = 1. */
  ord: number;
  /** JOB_PRIORITY value, or null: no analysis now. */
  priority: number | null;
  /** Rank among the run's analysable new games (jobs."fairSeq"). */
  fairSeq: number;
}

export interface ChunkInput {
  jobId: string;
  me: string;
  source: ProviderDb;
  userId: string;
  linkedAccountId: string;
  runId: string;
  games: readonly ChunkGame[];
  phase: "reading" | "saving";
  /** Set once the reading phase knows it (the first saving chunk); null keeps the stored value. */
  total: number | null;
  seen: number | null;
  /** Lichess: the oldest saved game's creation time (the resume point); null for Chess.com. */
  resumeUntilMs: number | null;
}

export interface ChunkResult {
  /** game_players rows this statement inserted (0 on a resend after a lost response). */
  newRows: number;
  /** ANALYZE_GAME jobs it inserted. */
  queued: number;
  /** Rows whose side another member already holds (counted as skipped by the run). */
  taken: number;
  /** The run's committed totals after the statement. */
  imported: number;
  analysed: number;
  analysisQueued: number;
}

/** The `src` record of one game (the jsonb_to_recordset column list below, in the same names). */
export function chunkRow(c: ChunkGame, linkedAccountId: string): Record<string, unknown> {
  const g = c.game;
  return {
    referenceId: c.referenceId,
    ord: c.ord,
    externalId: g.externalId,
    copyExternalId: coClaimExternalId(g.externalId, linkedAccountId),
    externalUrl: g.externalUrl,
    timeClass: g.timeClass,
    rated: g.rated,
    endedAt: g.endedAt.toISOString(),
    createdAt: g.createdAtMs !== null ? new Date(g.createdAtMs).toISOString() : null,
    whiteName: g.whiteName,
    blackName: g.blackName,
    whiteRating: g.whiteRating,
    blackRating: g.blackRating,
    whiteTitle: g.whiteTitle,
    blackTitle: g.blackTitle,
    outcome: g.outcome,
    endMethod: g.endMethod,
    legacyResult: g.legacyResult,
    ecoCode: g.ecoCode,
    openingName: g.openingName,
    moves: g.moves,
    moveClocksMs: g.moveClocksMs,
    plyCount: g.plyCount,
    startPly: g.startPly,
    startingFen: g.startingFen,
    fen: g.fen,
    initialTimeSeconds: g.initialTimeSeconds,
    incrementSeconds: g.incrementSeconds,
    creatorTimeRemaining: g.creatorTimeRemaining,
    opponentTimeRemaining: g.opponentTimeRemaining,
    memberWon: g.memberWon,
    color: g.color,
    result: g.result,
    ratingBefore: g.ratingBefore,
    ratingDelta: g.ratingDelta,
    opponentName: g.opponentName,
    opponentRating: g.opponentRating,
    priority: c.priority,
    fairSeq: c.fairSeq,
    evalHint: c.priority !== null && g.evalHint ? g.evalHint : null,
  };
}

// `endedAt` / `createdAt` arrive as ISO-UTC strings: the cast to `timestamp` (without zone) drops the `Z` and keeps
// the UTC wall time, which is how every Prisma DateTime column stores time.
const SRC_COLUMNS = `"referenceId" text, ord int, "externalId" text, "copyExternalId" text, "externalUrl" text, "timeClass" "TimeClass",
      rated boolean, "endedAt" timestamp, "createdAt" timestamp, "whiteName" text, "blackName" text,
      "whiteRating" int, "blackRating" int, "whiteTitle" text, "blackTitle" text, outcome "GameWinner",
      "endMethod" "GameEndMethod", "legacyResult" "GameResult", "ecoCode" text, "openingName" text, moves text,
      "moveClocksMs" int[], "plyCount" int, "startPly" int, "startingFen" text, fen text, "initialTimeSeconds" int,
      "incrementSeconds" int, "creatorTimeRemaining" int, "opponentTimeRemaining" int, "memberWon" boolean,
      color text, result "PlayerResult", "ratingBefore" int, "ratingDelta" int, "opponentName" text,
      "opponentRating" int, priority int, "fairSeq" int, "evalHint" jsonb`;

/** The games columns the writer sets (a new row, or a claim copy). */
const GAME_COLUMNS = `"referenceId", source, "externalId", "externalUrl", mode, status, rated, "timeClass",
      "completedAt", "expiresAt", "whiteName", "blackName", "whiteRating", "blackRating", "whiteTitle", "blackTitle",
      outcome, "endMethod", result, "winnerId", "ecoCode", "openingName", moves, "moveClocksMs", "plyCount",
      "startPly", "startingFen", fen, "initialTimeSeconds", "incrementSeconds", "creatorTimeRemaining",
      "opponentTimeRemaining", "creatorId", "whitePlayerId", "blackPlayerId", "analysisStatus", "createdAt",
      "updatedAt"`;

/** The SELECT list of GAME_COLUMNS from the src alias `s`, with `externalId` the given expression. */
function gameValues(s: string, externalId: string): string {
  return `SELECT ${s}."referenceId", $2::"GameSource", ${externalId}, ${s}."externalUrl", 'IMPORTED', 'COMPLETED', ${s}.rated,
      ${s}."timeClass", ${s}."endedAt", ${s}."endedAt", ${s}."whiteName", ${s}."blackName", ${s}."whiteRating", ${s}."blackRating",
      ${s}."whiteTitle", ${s}."blackTitle", ${s}.outcome, ${s}."endMethod", ${s}."legacyResult",
      CASE WHEN ${s}."memberWon" THEN $3::bigint END, ${s}."ecoCode", ${s}."openingName", ${s}.moves, ${s}."moveClocksMs",
      ${s}."plyCount", ${s}."startPly", ${s}."startingFen", ${s}.fen, ${s}."initialTimeSeconds", ${s}."incrementSeconds",
      ${s}."creatorTimeRemaining", ${s}."opponentTimeRemaining", $3::bigint,
      CASE WHEN ${s}.color = 'w' THEN $3::bigint END, CASE WHEN ${s}.color = 'b' THEN $3::bigint END,
      CASE WHEN ${s}.priority IS NULL THEN 'NONE' ELSE 'QUEUED' END::"AnalysisStatus",
      COALESCE(${s}."createdAt", ${s}."endedAt"), ${NOW}`;
}

/** This member's game_players row for each row of the games CTE `g`, joined to src on `src.<srcKey>`. */
function playerInsert(g: string, s: string, gameKey: string, srcKey = '"externalId"'): string {
  return `INSERT INTO game_players ("gameId", "userId", color, source, mode, "timeClass", rated, "endedAt", result,
      "ratingBefore", "ratingDelta", "opponentName", "opponentRating", "ecoCode", "linkedAccountId", "createdAt",
      "updatedAt")
  SELECT ${g}.id, $3::bigint, ${s}.color, $2::"GameSource", 'IMPORTED', ${s}."timeClass", ${s}.rated, ${s}."endedAt", ${s}.result,
      ${s}."ratingBefore", ${s}."ratingDelta", left(${s}."opponentName", 40), ${s}."opponentRating", ${s}."ecoCode", $4::bigint,
      ${NOW}, ${NOW}
    FROM ${g} JOIN src ${s} ON ${s}.${srcKey} = ${gameKey}
  ON CONFLICT DO NOTHING
  RETURNING "gameId"`;
}

/**
 * $1 rows · $2 source · $3 userId · $4 linkedAccountId · $5 runId · $6 resume-until ms or NULL · $7 phase ·
 * $8 total or NULL · $9 seen or NULL · $10 jobId · $11 me · $12 ANALYZE_GAME maxAttempts.
 */
export const CHUNK_SQL = `WITH ${heldCte("$10", "$11")},
src AS (
  SELECT * FROM jsonb_to_recordset($1::jsonb) AS x(${SRC_COLUMNS})
),
ins AS (
  INSERT INTO games (${GAME_COLUMNS})
  ${gameValues("s", 's."externalId"')}
    FROM src s
  ON CONFLICT (source, "externalId") DO UPDATE SET
      "whitePlayerId" = COALESCE(games."whitePlayerId", EXCLUDED."whitePlayerId"),
      "blackPlayerId" = COALESCE(games."blackPlayerId", EXCLUDED."blackPlayerId"),
      "analysisStatus" = CASE
        WHEN games."analysisStatus" = 'NONE' AND EXCLUDED."analysisStatus" = 'QUEUED'
             AND NOT EXISTS (SELECT 1 FROM game_players p
                              WHERE p."gameId" = games.id
                                AND (p."userId" = $3::bigint
                                     OR p.color = CASE WHEN EXCLUDED."whitePlayerId" IS NOT NULL THEN 'w' ELSE 'b' END))
        THEN 'QUEUED'::"AnalysisStatus" ELSE games."analysisStatus" END,
      "updatedAt" = ${NOW}
  RETURNING id, "externalId", "referenceId", (xmax = 0) AS created
),
gp AS (
  ${playerInsert("ins", "s", 'ins."externalId"')}
),
cc AS (
  SELECT s.* FROM ins JOIN src s ON s."externalId" = ins."externalId"
   WHERE ins.id NOT IN (SELECT "gameId" FROM gp)
     AND NOT EXISTS (SELECT 1 FROM game_players p WHERE p."gameId" = ins.id AND p."userId" = $3::bigint)
),
ins2 AS (
  INSERT INTO games (${GAME_COLUMNS})
  ${gameValues("s", 's."copyExternalId"')}
    FROM cc s
  ON CONFLICT (source, "externalId") DO UPDATE SET "updatedAt" = games."updatedAt"
  RETURNING id, "externalId", "referenceId"
),
gp2 AS (
  ${playerInsert("ins2", "s", 'ins2."externalId"', '"copyExternalId"')}
),
att AS (
  SELECT ins.id AS "gameId", ins."referenceId", s.priority, s."fairSeq", s."evalHint", s.ord
    FROM gp JOIN ins ON ins.id = gp."gameId" JOIN src s ON s."externalId" = ins."externalId"
  UNION ALL
  SELECT ins2.id, ins2."referenceId", s.priority, s."fairSeq", s."evalHint", s.ord
    FROM gp2 JOIN ins2 ON ins2.id = gp2."gameId" JOIN src s ON s."copyExternalId" = ins2."externalId"
),
jq AS (
  INSERT INTO jobs (kind, status, priority, "fairSeq", "dedupeKey", "userId", "gameId", payload, "runAt", "maxAttempts")
  SELECT 'ANALYZE_GAME', 'QUEUED', a.priority, a."fairSeq", 'analyze:' || a."gameId", $3::bigint, a."gameId",
         jsonb_strip_nulls(jsonb_build_object('v', 1, 'gameId', a."gameId"::text, 'gameRef', a."referenceId",
                                              'reason', 'import', 'importRunId', $5::bigint::text, 'evalHint', a."evalHint")),
         ${NOW}, $12::smallint
    FROM att a
   WHERE a.priority IS NOT NULL
  ON CONFLICT ("dedupeKey") DO NOTHING
  RETURNING "gameId"
),
run AS (
  UPDATE import_runs SET
      imported = imported + (SELECT count(*) FROM att),
      "analysisQueued" = LEAST(32767, "analysisQueued" + (SELECT count(*) FROM jq)),
      "firstGameId" = COALESCE("firstGameId",
        (SELECT a."gameId" FROM att a ORDER BY (a.priority IS NULL), a.ord LIMIT 1)),
      phase = $7, total = COALESCE($8::int, total), seen = GREATEST(seen, COALESCE($9::int, seen)),
      "updatedAt" = ${NOW}
   WHERE id = $5::bigint
  RETURNING imported, analysed, "analysisQueued"
),
acct AS (
  UPDATE linked_accounts SET "importedCount" = "importedCount" + (SELECT count(*) FROM att), "updatedAt" = ${NOW}
   WHERE id = $4::bigint AND EXISTS (SELECT 1 FROM att)
  RETURNING id
),
ver AS (
  UPDATE users SET "gamesVersion" = "gamesVersion" + 1
   WHERE id = $3::bigint AND EXISTS (SELECT 1 FROM att)
  RETURNING id
),
cur AS (
  UPDATE import_cursors SET "lichessResumeUntilMs" = $6::bigint, "updatedAt" = ${NOW}
   WHERE "linkedAccountId" = $4::bigint AND $6::bigint IS NOT NULL
  RETURNING 1
)
SELECT ${HELD_CHECK},
       (SELECT count(*) FROM att)::int AS "newRows",
       (SELECT count(*) FROM jq)::int AS queued,
       (SELECT count(*) FROM cc
         WHERE cc."copyExternalId" NOT IN (SELECT ins2."externalId" FROM gp2 JOIN ins2 ON ins2.id = gp2."gameId")
           AND NOT EXISTS (SELECT 1 FROM games g JOIN game_players p ON p."gameId" = g.id AND p."userId" = $3::bigint
                            WHERE g.source = $2::"GameSource" AND g."externalId" = cc."copyExternalId"))::int AS taken,
       (SELECT imported FROM run) AS imported,
       (SELECT analysed FROM run) AS analysed,
       (SELECT "analysisQueued" FROM run) AS "analysisQueued"`;

export function chunkStatement(input: ChunkInput): Statement {
  if (input.games.length === 0 || input.games.length > IMPORT_CHUNK) {
    throw new RangeError(`an import chunk holds 1..${IMPORT_CHUNK} games`);
  }
  return stmt(CHUNK_SQL, [
    JSON.stringify(input.games.map((g) => chunkRow(g, input.linkedAccountId))),
    input.source,
    input.userId,
    input.linkedAccountId,
    input.runId,
    input.resumeUntilMs === null ? null : String(Math.trunc(input.resumeUntilMs)),
    input.phase,
    input.total,
    input.seen,
    input.jobId,
    input.me,
    JOB_MAX_ATTEMPTS.ANALYZE_GAME,
  ]);
}

export function toChunkResult(row: Record<string, unknown> | undefined): ChunkResult {
  if (!row) throw new Error("the chunk statement returned no row");
  return {
    newRows: num(row.newRows),
    queued: num(row.queued),
    taken: num(row.taken),
    imported: num(row.imported ?? 0),
    analysed: num(row.analysed ?? 0),
    analysisQueued: num(row.analysisQueued ?? 0),
  };
}

/** The import run's account was deleted mid-run: the FK `game_players_linkedAccountId_fkey` refuses the rows. */
export class AccountGone extends Error {
  constructor(cause: unknown) {
    super("the linked account was deleted during the import", { cause });
    this.name = "AccountGone";
  }
}

const SERIALIZATION = new Set(["40001", "40P01"]);
const codeOf = (e: unknown) => (typeof e === "object" && e !== null ? (e as { code?: unknown }).code : undefined);

/**
 * Writes one chunk (§8.8 errors): 23503 → AccountGone (the caller cancels); a serialization failure or deadlock
 * (40001 / 40P01) is retried once; a lost lock (22012) and everything else propagate (the driver already retried a
 * dropped connection once, F-OCI-4; a statement timeout fails the attempt, which resumes through the known filter).
 */
export async function writeChunk(db: Db, input: ChunkInput): Promise<ChunkResult> {
  for (let attempt = 1; ; attempt++) {
    try {
      const rows = await db.query(chunkStatement(input));
      return toChunkResult(rows[0]);
    } catch (error) {
      if (isLockLost(error)) throw error;
      const code = codeOf(error);
      if (code === "23503") throw new AccountGone(error);
      if (attempt === 1 && typeof code === "string" && SERIALIZATION.has(code)) continue;
      throw error;
    }
  }
}
