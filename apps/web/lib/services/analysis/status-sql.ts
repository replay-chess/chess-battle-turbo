// The analysis status a read reports (A1, A2, the archive): games."analysisStatus", except that a game the finish
// statement never marked can still be one that will never be analysed. A game finished before the P3 fragment existed
// (or aborted) keeps NONE, and A3 refuses it with 409 `skipped` (under ANALYSIS_MIN_PLIES, aborted): reported as NONE
// it left the review on "Waiting for the engine" forever and the archive on "Not reviewed yet" (regression:
// short-game-never-skipped, dev ref cmwc6a882mk2i7lcif60lwr1n: 2 plies, NONE, no job). Reads it as SKIPPED instead,
// the same rule as A3's eligibility (enqueue.ts) and the finish fragment (analysisEligible).
import { ANALYSIS_MIN_PLIES } from "@repo/contracts/internal/jobs";
import { Prisma } from "@repo/db";

/** `"analysisStatus"` of the games row aliased `g`, with never-analysable finished games read as SKIPPED. */
export function effectiveAnalysisStatusSql(): Prisma.Sql {
  return Prisma.sql`CASE
    WHEN g."analysisStatus" = 'NONE'::"AnalysisStatus"
     AND (g.status = 'ABORTED'::"GameStatus" OR (g.status = 'COMPLETED'::"GameStatus" AND g."plyCount" < ${ANALYSIS_MIN_PLIES}::int))
    THEN 'SKIPPED' ELSE g."analysisStatus"::text END`;
}
