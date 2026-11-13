// The pipeline's statements (phase-03 plan §8.12, §6.3 grants, §9.8). Each method is one round trip over Neon HTTP:
//
//   load        1 statement   the game + members + stored analysis + legend source + comparisons + the job's last
//                             error, and games."analysisStatus" → RUNNING (a data-modifying CTE of the same statement)
//   checkpoint  1 batch       lock guard → game_analyses upsert (partial arrays) → [first: legend facts insert]
//                             → heartbeat RETURNING priority
//   finish      1 batch       lock guard → game_analyses → games (DONE, opening) → player_reviews → game_players
//                             → users."gamesVersion" → [legend_comparisons] → [final-batch/ extensions] → jobs DONE
//   skip        1 batch       lock guard → games SKIPPED + the members' gamesVersion → jobs DONE
//
// So a whole analysis is claim + load + ⌊plies/10⌋ checkpoints + the final batch: a 40-ply game is 6 requests and
// the final batch holds 8 statements (§13.2 C5 "≤ 10 statements"). Every write starts with lockGuardStatement: when
// the job was reaped meanwhile the whole batch rolls back and the runner writes nothing. The worker role
// (replay_worker) can do exactly this: its column grants are §6.3's (games: analysisStatus, ecoCode, openingName,
// updatedAt; game_players: the six analysis columns + updatedAt; users: gamesVersion).
//
// A final write (finish, skip, a legend comparison) whose response is lost after the server committed is retried by
// the client (db/client.ts), and the retry's lock guard then fails with 22012 because the job is already DONE. That
// is not a lost lock: `finalBatch` reads the job and, when this worker's own first attempt marked it DONE, returns
// normally, so the runner still emits `analysis:done` and records the ready telemetry (FIX-1).
//
// `"updatedAt"` is written explicitly on every row (Prisma's @updatedAt is client-side, and the review ETags read it).
import type { Color } from "@repo/chess-analysis/codec";
import { idStr, num, numOrNull, stmt, wasRetried, type Db, type Row, type Statement } from "../db/client";
import { NOW } from "../queue/claim";
import { doneByMeStatement, doneStatement, heartbeatStatement, isLockLost, lockGuardStatement } from "../queue/outcome";
import type { AnalysisStore, LegendCompareStore } from "./store";
import type {
  CheckpointWrite,
  ComparisonWrite,
  FinalWrite,
  GameMember,
  GoneWrite,
  LegendCompareLoad,
  LegendSource,
  LoadedGame,
  OpeningRow,
  SkipWrite,
  StoredAnalysis,
  StoredComparison,
} from "./types";

// ── load ─────────────────────────────────────────────────────────────────────────────────────────────────────────
export function loadStatement(gameId: string, jobId: string): Statement {
  return stmt(
    `WITH st AS (
  UPDATE games SET "analysisStatus" = 'RUNNING', "updatedAt" = ${NOW}
   WHERE id = $1::bigint AND status = 'COMPLETED' AND "analysisStatus" IN ('NONE', 'QUEUED', 'FAILED')
  RETURNING id
)
SELECT g.id::text AS id, g."referenceId" AS ref, g.status::text AS status, g.mode::text AS mode,
       g."startingFen", g."startPly", g.moves, g."plyCount",
       (extract(epoch FROM g."completedAt") * 1000)::float8 AS "completedAtMs",
       g."ecoCode", g."openingName",
       COALESCE((SELECT json_agg(json_build_object('color', gp.color, 'userId', gp."userId"::text,
                                                   'userRef', u."referenceId", 'result', gp.result::text)
                                 ORDER BY gp.color DESC)
                   FROM game_players gp JOIN users u ON u.id = gp."userId"
                  WHERE gp."gameId" = g.id), '[]'::json) AS members,
       (SELECT json_build_object('version', a.version, 'engine', a.engine, 'nodesPass1', a."nodesPass1",
                                 'nodesPass2', a."nodesPass2", 'totalPlies', a."totalPlies",
                                 'gradedPlies', a."gradedPlies", 'evals', a.evals, 'second', a.second,
                                 'best', a.best, 'judgements', a.judgements, 'lines', a.lines,
                                 'completed', a."completedAt" IS NOT NULL, 'depthP50', a."depthP50")
          FROM game_analyses a WHERE a."gameId" = g.id) AS analysis,
       (SELECT json_build_object('chessPositionId', cp.id::text, 'pgn', cp.pgn, 'gameMetadata', cp."gameMetadata",
                                 'moveNumber', cp."moveNumber", 'whitePlayerName', cp."whitePlayerName",
                                 'blackPlayerName', cp."blackPlayerName",
                                 'whiteLegendName', (SELECT l.name FROM legends l WHERE l.id = cp."whitePlayerId"),
                                 'blackLegendName', (SELECT l.name FROM legends l WHERE l.id = cp."blackPlayerId"),
                                 'year', COALESCE(extract(year FROM cp."eventDate")::int,
                                                  CASE WHEN jsonb_typeof(g.meta->'position'->'year') = 'number'
                                                       THEN (g.meta->'position'->>'year')::int END))
          FROM chess_positions cp WHERE cp.id = g."chessPositionId") AS legend,
       COALESCE((SELECT json_agg(json_build_object('userId', lc."userId"::text, 'status', lc.status::text,
                                                   'facts', lc.facts) ORDER BY lc."userId")
                   FROM legend_comparisons lc WHERE lc."gameId" = g.id), '[]'::json) AS comparisons,
       (SELECT j."lastError" FROM jobs j WHERE j.id = $2::bigint) AS "jobLastError"
  FROM games g
 WHERE g.id = $1::bigint`,
    [gameId, jobId],
  );
}

const numbers = (v: unknown): number[] => (Array.isArray(v) ? v.map((x) => num(x)) : []);
const strOrNull = (v: unknown): string | null => (typeof v === "string" ? v : null);

function toMember(v: unknown): GameMember {
  const m = v as Record<string, unknown>;
  const color = m.color === "w" || m.color === "b" ? m.color : null;
  if (!color) throw new TypeError("game_players.color must be w or b");
  const result = m.result;
  return {
    color,
    userId: idStr(m.userId),
    userRef: String(m.userRef),
    result: result === "WIN" || result === "LOSS" || result === "DRAW" || result === "ABORTED" ? result : null,
  };
}

function toAnalysis(v: unknown): StoredAnalysis | null {
  if (!v || typeof v !== "object") return null;
  const a = v as Record<string, unknown>;
  return {
    version: num(a.version),
    engine: String(a.engine),
    nodesPass1: num(a.nodesPass1),
    nodesPass2: num(a.nodesPass2),
    totalPlies: num(a.totalPlies),
    gradedPlies: num(a.gradedPlies),
    evals: numbers(a.evals),
    second: numbers(a.second),
    best: numbers(a.best),
    judgements: numbers(a.judgements),
    lines: a.lines && typeof a.lines === "object" ? (a.lines as StoredAnalysis["lines"]) : null,
    completed: a.completed === true,
    depthP50: numOrNull(a.depthP50),
  };
}

function toLegend(v: unknown): LegendSource | null {
  if (!v || typeof v !== "object") return null;
  const l = v as Record<string, unknown>;
  return {
    chessPositionId: idStr(l.chessPositionId),
    pgn: strOrNull(l.pgn),
    gameMetadata: l.gameMetadata ?? null,
    moveNumber: numOrNull(l.moveNumber),
    whiteLegendName: strOrNull(l.whiteLegendName),
    blackLegendName: strOrNull(l.blackLegendName),
    whitePlayerName: strOrNull(l.whitePlayerName),
    blackPlayerName: strOrNull(l.blackPlayerName),
    year: numOrNull(l.year),
  };
}

function toComparison(v: unknown): StoredComparison {
  const c = v as Record<string, unknown>;
  const status = c.status;
  if (status !== "FACTS_READY" && status !== "NARRATING" && status !== "READY" && status !== "FAILED") {
    throw new TypeError("unknown legend_comparisons.status");
  }
  return { userId: idStr(c.userId), status, facts: c.facts };
}

const splitMoves = (v: unknown): string[] => (typeof v === "string" && v.trim() !== "" ? v.trim().split(/\s+/) : []);

export function toLoadedGame(row: Row): LoadedGame {
  return {
    id: idStr(row.id),
    ref: String(row.ref),
    status: String(row.status),
    mode: strOrNull(row.mode),
    startingFen: String(row.startingFen),
    startPly: num(row.startPly),
    moves: splitMoves(row.moves),
    plyCount: num(row.plyCount),
    completedAtMs: numOrNull(row.completedAtMs),
    ecoCode: strOrNull(row.ecoCode),
    openingName: strOrNull(row.openingName),
    members: (Array.isArray(row.members) ? row.members : []).map(toMember),
    analysis: toAnalysis(row.analysis),
    legend: toLegend(row.legend),
    comparisons: (Array.isArray(row.comparisons) ? row.comparisons : []).map(toComparison),
    jobLastError: strOrNull(row.jobLastError),
  };
}

// ── checkpoint ───────────────────────────────────────────────────────────────────────────────────────────────────
/**
 * The partial arrays (§8.12 step 5). A run that starts over a completed analysis of another profile clears what the
 * final write owns (lines, accuracy, counts, division, depth, readyMs, completedAt): until this run finishes, the row
 * is a running analysis.
 */
export function checkpointAnalysisStatement(w: CheckpointWrite): Statement {
  return stmt(
    `INSERT INTO game_analyses ("gameId", version, engine, "nodesPass1", "nodesPass2", "evalSource", "totalPlies",
                            "gradedPlies", "failedAtPly", evals, second, best, judgements, "createdAt", "updatedAt")
VALUES ($1::bigint, $2, $3, $4, $5, 'ENGINE', $6, $7, NULL, $8::smallint[], $9::smallint[], $10::smallint[],
        $11::smallint[], ${NOW}, ${NOW})
ON CONFLICT ("gameId") DO UPDATE
   SET version = EXCLUDED.version, engine = EXCLUDED.engine, "nodesPass1" = EXCLUDED."nodesPass1",
       "nodesPass2" = EXCLUDED."nodesPass2", "evalSource" = 'ENGINE', "totalPlies" = EXCLUDED."totalPlies",
       "gradedPlies" = EXCLUDED."gradedPlies", "failedAtPly" = NULL, evals = EXCLUDED.evals,
       second = EXCLUDED.second, best = EXCLUDED.best, judgements = EXCLUDED.judgements, lines = NULL,
       "middlegamePly" = NULL, "endgamePly" = NULL, "accuracyWhite" = NULL, "accuracyBlack" = NULL,
       "countsWhite" = NULL, "countsBlack" = NULL, "depthP50" = NULL, "readyMs" = NULL, "completedAt" = NULL,
       "updatedAt" = ${NOW}`,
    [
      w.gameId,
      w.identity.version,
      w.identity.engine,
      w.identity.nodesPass1,
      w.identity.nodesPass2,
      w.identity.totalPlies,
      w.gradedPlies,
      w.arrays.evals,
      w.arrays.second,
      w.arrays.best,
      w.arrays.judgements,
    ],
  );
}

/** Legend facts rows: inserted FACTS_READY, or completed to READY with their evals (never over NARRATING/READY). */
export function comparisonsStatement(
  gameId: string,
  chessPositionId: string | null,
  rows: readonly ComparisonWrite[],
): Statement {
  return stmt(
    `INSERT INTO legend_comparisons ("gameId", "userId", "chessPositionId", status, facts, "createdAt", "updatedAt")
SELECT $1::bigint, r."userId", $2::bigint,
       (CASE WHEN r.ready THEN 'READY' ELSE 'FACTS_READY' END)::"ComparisonStatus", r.facts, ${NOW}, ${NOW}
  FROM jsonb_to_recordset($3::jsonb) AS r("userId" bigint, facts jsonb, ready boolean)
ON CONFLICT ("gameId", "userId") DO UPDATE
   SET facts = jsonb_set(legend_comparisons.facts, '{evalAtDivergence}', EXCLUDED.facts->'evalAtDivergence'),
       status = 'READY', error = NULL, "updatedAt" = ${NOW}
 WHERE EXCLUDED.status = 'READY' AND legend_comparisons.status IN ('FACTS_READY', 'FAILED')`,
    [gameId, chessPositionId, JSON.stringify(rows.map((r) => ({ userId: r.userId, facts: r.facts, ready: r.ready })))],
  );
}

// ── final write ──────────────────────────────────────────────────────────────────────────────────────────────────
export function finalAnalysisStatement(w: FinalWrite): Statement {
  return stmt(
    `INSERT INTO game_analyses ("gameId", version, engine, "nodesPass1", "nodesPass2", "evalSource", "totalPlies",
                            "gradedPlies", "failedAtPly", evals, second, best, judgements, lines, "middlegamePly",
                            "endgamePly", "accuracyWhite", "accuracyBlack", "countsWhite", "countsBlack", "depthP50",
                            "readyMs", "createdAt", "updatedAt", "completedAt")
VALUES ($1::bigint, $2, $3, $4, $5, 'ENGINE', $6, $6, NULL, $7::smallint[], $8::smallint[], $9::smallint[],
        $10::smallint[], $11::jsonb, $12, $13, $14::real, $15::real, $16::smallint[], $17::smallint[], $18,
        CASE WHEN $19::boolean THEN
          (SELECT LEAST(2147483647, GREATEST(0, round(extract(epoch FROM (${NOW} - g."completedAt")) * 1000)))::int
             FROM games g WHERE g.id = $1::bigint) END,
        ${NOW}, ${NOW}, ${NOW})
ON CONFLICT ("gameId") DO UPDATE
   SET version = EXCLUDED.version, engine = EXCLUDED.engine, "nodesPass1" = EXCLUDED."nodesPass1",
       "nodesPass2" = EXCLUDED."nodesPass2", "evalSource" = 'ENGINE', "totalPlies" = EXCLUDED."totalPlies",
       "gradedPlies" = EXCLUDED."gradedPlies", "failedAtPly" = NULL, evals = EXCLUDED.evals,
       second = EXCLUDED.second, best = EXCLUDED.best, judgements = EXCLUDED.judgements, lines = EXCLUDED.lines,
       "middlegamePly" = EXCLUDED."middlegamePly", "endgamePly" = EXCLUDED."endgamePly",
       "accuracyWhite" = EXCLUDED."accuracyWhite", "accuracyBlack" = EXCLUDED."accuracyBlack",
       "countsWhite" = EXCLUDED."countsWhite", "countsBlack" = EXCLUDED."countsBlack",
       "depthP50" = EXCLUDED."depthP50", "readyMs" = EXCLUDED."readyMs", "updatedAt" = ${NOW},
       "completedAt" = ${NOW}`,
    [
      w.gameId,
      w.identity.version,
      w.identity.engine,
      w.identity.nodesPass1,
      w.identity.nodesPass2,
      w.identity.totalPlies,
      w.arrays.evals,
      w.arrays.second,
      w.arrays.best,
      w.arrays.judgements,
      JSON.stringify(w.lines),
      w.middlegamePly,
      w.endgamePly,
      w.accuracy.w,
      w.accuracy.b,
      w.counts.w,
      w.counts.b,
      w.depthP50,
      w.measureReady,
    ],
  );
}

/** DONE, and the game's opening when it has none yet (§8.12 step 8: never over an existing one; never openingId). */
export function gameDoneStatement(gameId: string, opening: { eco: string; name: string } | null): Statement {
  return stmt(
    `UPDATE games
    SET "analysisStatus" = 'DONE',
        "openingName" = CASE WHEN "ecoCode" IS NULL AND $2::text IS NOT NULL THEN $3 ELSE "openingName" END,
        "ecoCode" = COALESCE("ecoCode", $2::text),
        "updatedAt" = ${NOW}
  WHERE id = $1::bigint`,
    [gameId, opening?.eco ?? null, opening?.name ?? null],
  );
}

export function reviewsStatement(gameId: string, members: FinalWrite["members"]): Statement {
  return stmt(
    `INSERT INTO player_reviews ("gameId", color, content, "textStatus", "createdAt", "updatedAt")
SELECT $1::bigint, r.color, r.content, 'TEMPLATE', ${NOW}, ${NOW}
  FROM jsonb_to_recordset($2::jsonb) AS r(color text, content jsonb)
ON CONFLICT ("gameId", color) DO UPDATE
   SET content = EXCLUDED.content, "textStatus" = 'TEMPLATE', "updatedAt" = ${NOW}`,
    [gameId, JSON.stringify(members.map((m) => ({ color: m.color, content: m.content })))],
  );
}

/** The six analysis columns per member side; `ecoCode` is copied from the game (after gameDoneStatement). */
export function playersStatement(gameId: string, members: FinalWrite["members"]): Statement {
  return stmt(
    `UPDATE game_players gp
    SET accuracy = r.accuracy, headline = r.headline, "momentsCount" = r."momentsCount", counts = r.counts,
        "phaseAccuracy" = r."phaseAccuracy",
        "ecoCode" = (SELECT g."ecoCode" FROM games g WHERE g.id = $1::bigint), "updatedAt" = ${NOW}
   FROM jsonb_to_recordset($2::jsonb)
        AS r(color text, accuracy real, headline text, "momentsCount" smallint, counts smallint[], "phaseAccuracy" real[])
  WHERE gp."gameId" = $1::bigint AND gp.color = r.color`,
    [
      gameId,
      JSON.stringify(
        members.map((m) => ({
          color: m.color,
          accuracy: m.accuracy,
          headline: m.headline,
          momentsCount: m.momentsCount,
          counts: m.counts,
          phaseAccuracy: m.phaseAccuracy,
        })),
      ),
    ],
  );
}

/** The archive ETag of every member (P3-D27). */
export function bumpMembersStatement(gameId: string): Statement {
  return stmt(
    `UPDATE users u SET "gamesVersion" = u."gamesVersion" + 1
   FROM game_players gp
  WHERE gp."gameId" = $1::bigint AND u.id = gp."userId"`,
    [gameId],
  );
}

export function skipStatement(gameId: string): Statement {
  return stmt(
    `WITH g AS (
  UPDATE games SET "analysisStatus" = 'SKIPPED', "updatedAt" = ${NOW}
   WHERE id = $1::bigint AND "analysisStatus" <> 'SKIPPED'
  RETURNING id
), uv AS (
  UPDATE users u SET "gamesVersion" = u."gamesVersion" + 1
    FROM game_players gp JOIN g ON g.id = gp."gameId"
   WHERE u.id = gp."userId"
  RETURNING u.id
)
SELECT (SELECT count(*) FROM g)::int AS changed, (SELECT count(*) FROM uv)::int AS bumped`,
    [gameId],
  );
}

export function openingsStatement(): Statement {
  return stmt(`SELECT eco, name, pgn FROM openings WHERE "isActive" ORDER BY id`);
}

export function queuedForStatement(userRefs: readonly string[]): Statement {
  return stmt(
    `SELECT u."referenceId" AS ref, count(*)::int AS n
   FROM jobs j
   JOIN game_players gp ON gp."gameId" = j."gameId"
   JOIN users u ON u.id = gp."userId"
  WHERE j.status = 'QUEUED' AND j.kind = 'ANALYZE_GAME' AND u."referenceId" = ANY($1::text[])
  GROUP BY u."referenceId"`,
    [[...userRefs]],
  );
}

// ── LEGEND_COMPARE ───────────────────────────────────────────────────────────────────────────────────────────────
export function legendLoadStatement(gameId: string, userId: string): Statement {
  return stmt(
    `SELECT g.id::text AS id, g."referenceId" AS ref, g.status::text AS status, g."startingFen", g.moves,
       (SELECT json_build_object('color', gp.color, 'userRef', u."referenceId")
          FROM game_players gp JOIN users u ON u.id = gp."userId"
         WHERE gp."gameId" = g.id AND gp."userId" = $2::bigint) AS member,
       (SELECT json_build_object('userId', lc."userId"::text, 'status', lc.status::text, 'facts', lc.facts)
          FROM legend_comparisons lc WHERE lc."gameId" = g.id AND lc."userId" = $2::bigint) AS comparison
  FROM games g
 WHERE g.id = $1::bigint`,
    [gameId, userId],
  );
}

export function legendCompleteStatement(input: {
  gameId: string;
  userId: string;
  evalAtDivergence: { userWin: number; legendWin: number } | null;
}): Statement {
  return stmt(
    `UPDATE legend_comparisons
    SET facts = CASE WHEN $3::jsonb IS NULL THEN facts ELSE jsonb_set(facts, '{evalAtDivergence}', $3::jsonb) END,
        status = 'READY', error = NULL, "updatedAt" = ${NOW}
  WHERE "gameId" = $1::bigint AND "userId" = $2::bigint AND status IN ('FACTS_READY', 'FAILED')`,
    [input.gameId, input.userId, input.evalAtDivergence === null ? null : JSON.stringify(input.evalAtDivergence)],
  );
}

export function legendFailStatement(input: { gameId: string; userId: string; error: string }): Statement {
  return stmt(
    `UPDATE legend_comparisons SET status = 'FAILED', error = $3, "updatedAt" = ${NOW}
  WHERE "gameId" = $1::bigint AND "userId" = $2::bigint AND status = 'FACTS_READY'`,
    [input.gameId, input.userId, input.error.slice(0, 500)],
  );
}

function toLegendCompareLoad(row: Row): LegendCompareLoad {
  const m = row.member as { color?: unknown; userRef?: unknown } | null;
  const color = m && (m.color === "w" || m.color === "b") ? (m.color as Color) : null;
  return {
    gameId: idStr(row.id),
    ref: String(row.ref),
    status: String(row.status),
    startingFen: String(row.startingFen),
    moves: splitMoves(row.moves),
    member: color && m ? { color, userRef: String(m.userRef) } : null,
    comparison: row.comparison ? toComparison(row.comparison) : null,
  };
}

/** The job result of an analysis whose game was deleted (AnalysisStore.gone). */
export const GAME_GONE = "game_gone";

/** One row when the game still exists. */
export function gameExistsStatement(gameId: string): Statement {
  return stmt(`SELECT 1 AS present FROM games WHERE id = $1::bigint`, [gameId]);
}

/**
 * A lock-guarded final batch that ends in doneStatement. A 22012 from the client's retry of an ambiguous failure
 * means "already DONE" when this worker's first attempt committed: then it returns normally (see the header).
 */
export async function finalBatch(db: Db, jobId: string, me: string, ss: readonly Statement[]): Promise<Row[][] | null> {
  try {
    return await db.batch(ss);
  } catch (error) {
    if (isLockLost(error) && wasRetried(error)) {
      const rows = await db.query(doneByMeStatement(jobId, me));
      if (rows.length > 0) return null;
    }
    throw error;
  }
}

export class SqlAnalysisStore implements AnalysisStore, LegendCompareStore {
  constructor(private readonly db: Db) {}

  async load(gameId: string, jobId: string): Promise<LoadedGame | null> {
    const rows = await this.db.query(loadStatement(gameId, jobId));
    return rows[0] ? toLoadedGame(rows[0]) : null;
  }

  async checkpoint(w: CheckpointWrite): Promise<number> {
    const out = await this.db.batch([
      lockGuardStatement(w.jobId, w.me),
      checkpointAnalysisStatement(w),
      ...(w.newComparisons.length ? [comparisonsStatement(w.gameId, w.chessPositionId, w.newComparisons)] : []),
      heartbeatStatement(w.jobId, w.me),
    ]);
    const beat = out[out.length - 1]?.[0];
    return num(beat?.priority);
  }

  async finish(w: FinalWrite): Promise<Row[][] | null> {
    const head = [
      lockGuardStatement(w.jobId, w.me),
      finalAnalysisStatement(w),
      gameDoneStatement(w.gameId, w.opening),
      reviewsStatement(w.gameId, w.members),
      playersStatement(w.gameId, w.members),
      bumpMembersStatement(w.gameId),
      ...(w.comparisons.length ? [comparisonsStatement(w.gameId, w.chessPositionId, w.comparisons)] : []),
    ];
    const out = await finalBatch(this.db, w.jobId, w.me, [...head, ...w.extensions, doneStatement(w.jobId, w.me, w.result)]);
    return out ? out.slice(head.length, head.length + w.extensions.length) : null;
  }

  async skip(w: SkipWrite): Promise<void> {
    await finalBatch(this.db, w.jobId, w.me, [
      lockGuardStatement(w.jobId, w.me),
      skipStatement(w.gameId),
      doneStatement(w.jobId, w.me, { skipped: w.reason }),
    ]);
  }

  async gone(w: GoneWrite): Promise<boolean> {
    const rows = await this.db.query(gameExistsStatement(w.gameId));
    if (rows.length > 0) return false;
    await finalBatch(this.db, w.jobId, w.me, [lockGuardStatement(w.jobId, w.me), doneStatement(w.jobId, w.me, { skipped: GAME_GONE })]);
    return true;
  }

  async openings(): Promise<OpeningRow[]> {
    const rows = await this.db.query(openingsStatement());
    return rows.map((r) => ({ eco: String(r.eco), name: String(r.name), pgn: String(r.pgn) }));
  }

  async queuedFor(userRefs: readonly string[]): Promise<Map<string, number>> {
    if (userRefs.length === 0) return new Map();
    const rows = await this.db.query(queuedForStatement(userRefs));
    return new Map(rows.map((r) => [String(r.ref), num(r.n)]));
  }

  async loadComparison(gameId: string, userId: string): Promise<LegendCompareLoad | null> {
    const rows = await this.db.query(legendLoadStatement(gameId, userId));
    return rows[0] ? toLegendCompareLoad(rows[0]) : null;
  }

  async completeComparison(input: {
    jobId: string;
    me: string;
    gameId: string;
    userId: string;
    evalAtDivergence: { userWin: number; legendWin: number } | null;
  }): Promise<void> {
    await finalBatch(this.db, input.jobId, input.me, [
      lockGuardStatement(input.jobId, input.me),
      legendCompleteStatement(input),
      doneStatement(input.jobId, input.me, { evals: input.evalAtDivergence !== null }),
    ]);
  }

  async failComparison(input: { gameId: string; userId: string; error: string }): Promise<void> {
    await this.db.query(legendFailStatement(input));
  }
}
