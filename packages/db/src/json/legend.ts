// JSON column registry entry for legend_comparisons.facts (phase-03 plan 6.6, 8.9; data-model §2.6).
//
// Written by bot / legend-bot `complete` (web), lazily by A2/A9 and by the worker, always through the same pure
// compareWithLegend() (CA/src/legend/compare.ts) and `INSERT … ON CONFLICT DO NOTHING` (P3-D24). The worker later
// fills `evalAtDivergence` and flips the row to READY. Writers use buildComparisonFacts (throws); readers use
// parseComparisonFacts (never throws).
import { LEGEND_COMPUTE_MAX_ATTEMPTS } from "@repo/contracts/http/legend";
import { z } from "zod";

/** legend_comparisons.status (the ComparisonStatus enum). */
export const ComparisonStatus = z.enum(["FACTS_READY", "NARRATING", "READY", "FAILED"]);
export type ComparisonStatus = z.infer<typeof ComparisonStatus>;

/** The most attempts A9b may request before it answers 410 (plan 7.2); one definition, in @repo/contracts. */
export { LEGEND_COMPUTE_MAX_ATTEMPTS };

/** Space-separated UCI, at most 120 plies (5 chars + 1 space each). */
const UciLine = z.string().max(120 * 6);
const UciMove = z.string().regex(/^[a-h][1-8][a-h][1-8][nbrq]?$/);

export const ComparisonFactsV1 = z.object({
  v: z.literal(1),
  /** the member's side */
  side: z.enum(["w", "b"]),
  historicalName: z.string().max(40),
  /** ply number of the legend position (games."startPly") */
  startPly: z.number().int().min(0),
  comparedPlies: z.number().int().min(0),
  matchedPlies: z.number().int().min(0),
  /** first ply (offset from startPly) where the game left the legend's line; null = never diverged */
  divergencePly: z.number().int().min(0).nullable(),
  divergenceBy: z.enum(["user", "opponent"]).nullable(),
  userUci: UciMove.nullable(),
  userSan: z.string().max(10).nullable(),
  legendUci: UciMove.nullable(),
  legendSan: z.string().max(10).nullable(),
  legendResult: z.enum(["white_won", "black_won", "draw"]),
  legendTotalMoves: z.number().int().min(0).nullable(),
  /** from startPly, space-separated (≤ 120 plies each) */
  userLineUci: UciLine,
  legendLineUci: UciLine,
  /** the worker fills it (status → READY); Win% for the member, after each move */
  evalAtDivergence: z.object({ userWin: z.number().min(0).max(100), legendWin: z.number().min(0).max(100) }).nullable(),
});
export type ComparisonFactsV1 = z.infer<typeof ComparisonFactsV1>;

/** Validates a facts document; throws a ZodError on a bad value. */
export function buildComparisonFacts(input: ComparisonFactsV1): ComparisonFactsV1 {
  return ComparisonFactsV1.parse(input);
}

/** Tolerant reader: `null` for a missing, legacy or malformed value. Never throws. */
export function parseComparisonFacts(value: unknown): ComparisonFactsV1 | null {
  const parsed = ComparisonFactsV1.safeParse(value);
  return parsed.success ? parsed.data : null;
}
