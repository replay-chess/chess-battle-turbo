// Legend comparison facts (phase-03 plan §8.9, P3-D24): derived data, so every writer computes them with the one
// pure rule in @repo/chess-analysis/legend/facts (`legendFactsOf`: which legend, the surname, the skip reasons) and
// inserts with `ON CONFLICT DO NOTHING` (bot `complete`, the A2/A9 lazy insert, the worker, the DB backfill). This
// file is the web's entry: the column-shaped input of the review SQL, the zod validation and the insert statement.
import {
  historicalFullName,
  historicalShortName,
  legendFactsOf,
  realPlayerName,
  type LegendNames,
} from "@repo/chess-analysis/legend/facts";
import { Prisma } from "@repo/db";
import { buildComparisonFacts, type ComparisonFactsV1 } from "@repo/db/json";

export { historicalFullName, historicalShortName, realPlayerName, type LegendNames };

export type LegendFactsInput = {
  whiteLegendName: string | null;
  blackLegendName: string | null;
  whitePlayerName: string | null;
  blackPlayerName: string | null;
  startFen: string;
  startPly: number;
  /** The game's UCI moves from startFen, space-separated. */
  moves: string;
  member: "w" | "b";
  legendPgn: string | null;
  legendMeta: unknown;
  legendMoveNumber: number | null;
};

/** The facts row for one member of a legend game, or null when there is nothing to compare (see the CA rule). */
export function legendFactsFor(input: LegendFactsInput): ComparisonFactsV1 | null {
  const out = legendFactsOf({
    names: input,
    pgn: input.legendPgn,
    gameMetadata: input.legendMeta,
    moveNumber: input.legendMoveNumber,
    startFen: input.startFen,
    startPly: input.startPly,
    moves: input.moves.trim() === "" ? [] : input.moves.trim().split(/\s+/),
    member: input.member,
  });
  return out.ok ? buildComparisonFacts(out.facts) : null;
}

/**
 * The idempotent insert (`legend_facts`): one row per (game, member), FACTS_READY, never overwriting a row another
 * writer (or the worker's READY update) got to first. Returns the row's state: the inserted one, or the existing
 * one when the insert was a no-op. `updatedAt` is written explicitly (Prisma's @updatedAt is client-side).
 */
export function insertLegendFactsSql(input: {
  gameId: bigint;
  userId: bigint;
  chessPositionId: bigint | null;
  facts: ComparisonFactsV1;
}): Prisma.Sql {
  const now = Prisma.sql`(now() AT TIME ZONE 'UTC')`;
  return Prisma.sql`WITH ins AS (
  INSERT INTO legend_comparisons ("gameId", "userId", "chessPositionId", status, facts, "createdAt", "updatedAt")
  VALUES (${input.gameId}, ${input.userId}, ${input.chessPositionId}::bigint, 'FACTS_READY', ${JSON.stringify(input.facts)}::jsonb, ${now}, ${now})
  ON CONFLICT ("gameId", "userId") DO NOTHING
  RETURNING status::text AS status, facts, attempts, "updatedAt"
)
SELECT status, facts, attempts, "updatedAt" FROM ins
UNION ALL
SELECT lc.status::text, lc.facts, lc.attempts, lc."updatedAt" FROM legend_comparisons lc
 WHERE lc."gameId" = ${input.gameId} AND lc."userId" = ${input.userId} AND NOT EXISTS (SELECT 1 FROM ins)`;
}

export type FactsRowState = {
  status: "FACTS_READY" | "NARRATING" | "READY" | "FAILED";
  facts: unknown;
  attempts: number;
  updatedAt: Date;
};
