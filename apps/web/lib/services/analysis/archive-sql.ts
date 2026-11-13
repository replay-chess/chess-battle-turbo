// The archive statements (phase-03 plan §9.3 G1; P3-D25). One page = one statement: an Index Scan on
// `game_players_userId_endedAt_gameId_idx (userId, endedAt DESC, gameId DESC)` with the filters as a Filter, nested
// loops to `games_pkey` and `legend_comparisons_pkey`, and no Sort node (the explain gate asserts it,
// `packages/db/scripts/explain-hot.ts` G1 rows). Only the conditions a request actually uses are in the statement,
// so the keyset is a real index condition rather than an `$x IS NULL OR …` filter.
//
// The counts (page 1 and limit=0 only, AP-38) run as a second statement over the same index prefix, in parallel.
import type { GameResultFilter, GameTcFilter, GamesFilter } from "@repo/contracts/http/games";
import { Prisma } from "@repo/db";
import { effectiveAnalysisStatusSql } from "./status-sql";

export type ArchiveCursor = { endedAt: string; gameId: string };

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
export function filterConditions(filter: GamesFilter): Prisma.Sql[] {
  const out: Prisma.Sql[] = [];
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
export function archivePageSql(userId: bigint, filter: GamesFilter, cursor: ArchiveCursor | null, limit: number): Prisma.Sql {
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

/** `filteredTotal` (the filter) and `all` (every finished game) in one pass over the user's index prefix. */
export function archiveCountsSql(userId: bigint, filter: GamesFilter): Prisma.Sql {
  const conditions = filterConditions(filter);
  const filtered = conditions.length
    ? Prisma.sql`count(*) FILTER (WHERE ${Prisma.join(conditions, " AND ")})`
    : Prisma.sql`count(*)`;
  return Prisma.sql`
SELECT (${filtered})::int AS "filteredTotal", count(*)::int AS "all"
  FROM game_players gp
  JOIN games g ON g.id = gp."gameId"
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

export type ArchiveCountsRow = { filteredTotal: number; all: number };
