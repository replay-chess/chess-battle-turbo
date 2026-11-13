// The archive statements (phase-03 plan §9.3 G1; P3-D25). One page = one statement: an Index Scan on
// `game_players_userId_endedAt_gameId_idx (userId, endedAt DESC, gameId DESC)` with the filters as a Filter, nested
// loops to `games_pkey` and `legend_comparisons_pkey`, and no Sort node (the explain gate asserts it,
// `packages/db/scripts/explain-hot.ts` G1 rows). Only the conditions a request actually uses are in the statement,
// so the keyset is a real index condition rather than an `$x IS NULL OR …` filter.
//
// The counts (page 1 and limit=0 only, AP-38) run as a second statement over the same index prefix, in parallel.
//
// P4 (phase-04 plan §4.11): the source tab (`?source=replay|chesscom|lichess`) is one more condition on the player row
// (`game_players.source`, written by the import batch writer), and the counts statement adds the three per-source
// counts in the same pass.
import type { GameResultFilter, GameTcFilter, GamesFilter } from "@repo/contracts/http/games";
import type { GameSourceWire } from "@repo/contracts/http/review";
import { Prisma } from "@repo/db";
import { effectiveAnalysisStatusSql } from "./status-sql";

export type ArchiveCursor = { endedAt: string; gameId: string };

/** G1's filter plus the P4 source tab (absent = All). */
export type ArchiveFilter = GamesFilter & { source?: GameSourceWire };

const SOURCE_ENUM: Record<GameSourceWire, "REPLAY" | "CHESSCOM" | "LICHESS"> = {
  replay: "REPLAY",
  chesscom: "CHESSCOM",
  lichess: "LICHESS",
};

const RESULT_ENUM: Record<GameResultFilter, "WIN" | "LOSS" | "DRAW"> = { win: "WIN", loss: "LOSS", draw: "DRAW" };
const TC_ENUM: Record<GameTcFilter, "BULLET" | "BLITZ" | "RAPID" | "CLASSICAL"> = {
  bullet: "BULLET",
  blitz: "BLITZ",
  rapid: "RAPID",
  classical: "CLASSICAL",
};

/** Finished games only: a live row has no result, an aborted one is never in the archive. */
const FINISHED = Prisma.sql`gp.result = ANY('{WIN,LOSS,DRAW}'::"PlayerResult"[])`;

/** `%` and `_` are literal in a search, and so is the escape character itself (ILIKE's default escape is `\`). */
export function likePattern(q: string): string {
  return `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

/** The filter conditions (AND-ed); empty when the filter is empty. */
export function filterConditions(filter: ArchiveFilter): Prisma.Sql[] {
  const out: Prisma.Sql[] = [];
  if (filter.source) out.push(Prisma.sql`gp.source = ${SOURCE_ENUM[filter.source]}::"GameSource"`);
  if (filter.result?.length) {
    const values = filter.result.map((r) => RESULT_ENUM[r]);
    out.push(Prisma.sql`gp.result = ANY(${values}::"PlayerResult"[])`);
  }
  if (filter.tc?.length) {
    const values = filter.tc.map((t) => TC_ENUM[t]);
    out.push(Prisma.sql`gp."timeClass" = ANY(${values}::"TimeClass"[])`);
  }
  if (filter.moments) out.push(Prisma.sql`gp."momentsCount" > 0`);
  if (filter.q) {
    const like = likePattern(filter.q);
    out.push(
      Prisma.sql`(gp."opponentName" ILIKE ${like} OR g."openingName" ILIKE ${like} OR (g.meta->'position'->>'name') ILIKE ${like})`,
    );
  }
  return out;
}

const and = (parts: Prisma.Sql[]) => (parts.length ? Prisma.sql`AND ${Prisma.join(parts, " AND ")}` : Prisma.empty);

/** One archive page: `limit + 1` rows (the extra row only says whether there is a next page). */
export function archivePageSql(userId: bigint, filter: ArchiveFilter, cursor: ArchiveCursor | null, limit: number): Prisma.Sql {
  const keyset = cursor
    ? Prisma.sql`AND (gp."endedAt", gp."gameId") < (${cursor.endedAt}::timestamptz AT TIME ZONE 'UTC', ${cursor.gameId}::bigint)`
    : Prisma.empty;
  return Prisma.sql`
SELECT gp."gameId", g."referenceId" AS ref, gp.color, gp.result::text AS result, gp."timeClass"::text AS "timeClass",
       gp.mode::text AS mode, gp."endedAt", gp."opponentName", gp."opponentRating", gp."opponentUserId",
       gp."ratingDelta", gp.accuracy, gp.headline, gp."momentsCount", COALESCE(gp."ecoCode", g."ecoCode") AS "ecoCode",
       g.source::text AS source, ${effectiveAnalysisStatusSql()} AS "analysisStatus", COALESCE(g.fen, g."startingFen") AS fen,
       g."openingName", g."initialTimeSeconds", g."incrementSeconds", g.meta->'position'->>'name' AS "positionTitle",
       (lc."gameId" IS NOT NULL) AS "hasComparison"
  FROM game_players gp
  JOIN games g ON g.id = gp."gameId"
  LEFT JOIN legend_comparisons lc ON lc."gameId" = gp."gameId" AND lc."userId" = gp."userId"
 WHERE gp."userId" = ${userId} AND ${FINISHED}
   ${keyset}
   ${and(filterConditions(filter))}
 ORDER BY gp."endedAt" DESC, gp."gameId" DESC
 LIMIT ${limit + 1}`;
}

/**
 * `filteredTotal` (the filter, source tab included), `all` (every finished game) and the per-source tab counts
 * (P4) in one pass over the user's index prefix.
 *
 * `games` is joined only for a search (`q` reads the opening name and the position title); every other count is a
 * `game_players` column. regression: D6 — the join was unconditional, so the first /games of a member with 2,000
 * freshly imported games probed games_pkey and fetched the games heap (the widest table: PGN, moves, clocks) for every
 * one of them, ≈ 3,700 shared buffers of which ≈ 900 were read cold and dirtied by their first read (hint bits; on
 * Neon each also a full-page WAL image), against ≈ 120 for the game_players rows alone. The explain gate holds it
 * (packages/db/scripts/explain-hot.ts "P4 G1 counts").
 */
export function archiveCountsSql(userId: bigint, filter: ArchiveFilter): Prisma.Sql {
  const conditions = filterConditions(filter);
  const filtered = conditions.length
    ? Prisma.sql`count(*) FILTER (WHERE ${Prisma.join(conditions, " AND ")})`
    : Prisma.sql`count(*)`;
  const games = filter.q ? Prisma.sql`JOIN games g ON g.id = gp."gameId"` : Prisma.empty;
  return Prisma.sql`
SELECT (${filtered})::int AS "filteredTotal", count(*)::int AS "all",
       (count(*) FILTER (WHERE gp.source = 'REPLAY'::"GameSource"))::int AS replay,
       (count(*) FILTER (WHERE gp.source = 'CHESSCOM'::"GameSource"))::int AS chesscom,
       (count(*) FILTER (WHERE gp.source = 'LICHESS'::"GameSource"))::int AS lichess
  FROM game_players gp
  ${games}
 WHERE gp."userId" = ${userId} AND ${FINISHED}`;
}

/** What the page statement returns (the driver's types: bigint ids, Date times). */
export type ArchiveRow = {
  gameId: bigint;
  ref: string;
  color: "w" | "b";
  result: "WIN" | "LOSS" | "DRAW";
  timeClass: "BULLET" | "BLITZ" | "RAPID" | "CLASSICAL" | "DAILY" | "UNTIMED" | null;
  mode: "LEGEND_BOT" | "BOT" | "FRIEND" | "ONLINE" | "TOURNAMENT" | "IMPORTED";
  endedAt: Date;
  opponentName: string;
  opponentRating: number | null;
  opponentUserId: bigint | null;
  ratingDelta: number | null;
  accuracy: number | null;
  headline: string | null;
  momentsCount: number;
  ecoCode: string | null;
  source: "REPLAY" | "CHESSCOM" | "LICHESS";
  analysisStatus: "NONE" | "QUEUED" | "RUNNING" | "DONE" | "FAILED" | "SKIPPED";
  fen: string;
  openingName: string | null;
  initialTimeSeconds: number;
  incrementSeconds: number;
  positionTitle: string | null;
  hasComparison: boolean;
};

/** The per-source columns arrive from the P4 statement; a row without them (an older fake) counts as Replay only. */
export type ArchiveCountsRow = { filteredTotal: number; all: number; replay?: number; chesscom?: number; lichess?: number };
