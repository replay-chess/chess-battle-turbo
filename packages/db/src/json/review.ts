// JSON column registry entries for the review (phase-03 plan 6.6, data-model §2.6):
//   - player_reviews.content  → ReviewContentV1 (written by the analysis worker; P7 swaps the text source, no shape change)
//   - player_reviews.progress → ReviewProgressV1 (written by A5 through the SQL function review_progress_merge, and A6)
//   - game_analyses.lines     → LinesV1 (written by the analysis worker; flagged plies only)
//
// Ply keys and `ply` fields are offsets from games."startPly" (0-based), the same index as game_analyses arrays.
// Writers use the `build*` functions (throw on a bad value); readers use the tolerant `parse*` functions (never
// throw: a missing, legacy or malformed value reads as null and the caller falls back to "no review yet").
import { PLAN_KEYS, PlanKey, Sentence } from "@repo/contracts/http/review";
import { z } from "zod";

/** A ply number as a JSON object key ("0" … "9999"). */
const PlyKey = z.string().regex(/^(0|[1-9]\d{0,3})$/);
/** One move in UCI ("e2e4", "e7e8q"). */
const Uci = z.string().regex(/^[a-h][1-8][a-h][1-8][nbrq]?$/);

// One sentence of review text (`v` = passed the P7 verifier; always false for template text, P3-D16) and the plan
// chips of a key moment (plan 8.8): one definition, shared with the review DTO in @repo/contracts.
export { PLAN_KEYS, PlanKey, Sentence };

/** player_reviews."textStatus" (a varchar, P3-D16). P3 writes TEMPLATE; READY (the VERIFIED tag) is P7's. */
export const ReviewTextStatus = z.enum(["PENDING", "TEMPLATE", "READY", "FALLBACK"]);
export type ReviewTextStatus = z.infer<typeof ReviewTextStatus>;

/** One key moment (≤ 3 per member side, P3-D3/D14). The API moment id is `ply`. */
export const ReviewMomentV1 = z.object({
  /** ply offset from startPly (0-based) */
  ply: z.number().int().min(0),
  /** JudgementCode (CA/src/codec.ts): 1 BRILLIANT … 12 BLUNDER, never 0 (ungraded) */
  judgement: z.number().int().min(1).max(12),
  playedUci: Uci,
  bestUci: Uci,
  /** moves within 2 Win% of best (MultiPV 3, pass 2) */
  accept: z.array(Uci).max(3),
  /** best line from fenBefore, UCI space-separated, 3–8 plies */
  pv: z.string().max(60),
  /** mover POV Win%, 1 decimal */
  winBefore: z.number().min(0).max(100),
  winAfter: z.number().min(0).max(100),
  /** the engine's idea class (plan 8.8) */
  intent: PlanKey,
  ask: z.string().max(300),
  why: z.array(Sentence).max(3),
  /** chip feedback for all five chips, precomputed so a tap needs no network (exhaustive record) */
  plan: z.record(PlanKey, z.string().max(200)),
  /** P5 fills (MistakeOccurrence) */
  mistakeRef: z.string().nullable(),
});
export type ReviewMomentV1 = z.infer<typeof ReviewMomentV1>;

export const ReviewContentV1 = z.object({
  v: z.literal(1),
  source: z.enum(["template", "llm"]),
  summary: z.array(Sentence).max(4),
  /** the game-over card line (COV C-02): the turning-point sentence, or the best decision for a clean game */
  coachLine: Sentence.nullable(),
  phaseLine: z.string().max(120),
  headline: z.string().max(80).nullable(),
  isClean: z.boolean(),
  bestPly: z.number().int().min(0).nullable(),
  bestDecision: z.string().max(200).nullable(),
  moments: z.array(ReviewMomentV1).max(3),
});
export type ReviewContentV1 = z.infer<typeof ReviewContentV1>;

/** A walkthrough outcome per moment ply. */
export const MomentResult = z.enum(["FOUND", "FOUND_RETRY", "REVEALED"]);
export type MomentResult = z.infer<typeof MomentResult>;

/** The highest momentIndex: every moment has been walked (the walkthrough is complete). */
export const MOMENT_INDEX_MAX = 3;
/** The cap on attempts per moment (the SQL merge clamps to it as well). */
export const ATTEMPTS_MAX = 50;

export const ReviewProgressV1 = z.object({
  v: z.literal(1),
  momentIndex: z.number().int().min(0).max(MOMENT_INDEX_MAX),
  /** key = ply */
  results: z.record(PlyKey, MomentResult),
  /** key = ply; cumulative tries */
  attempts: z.record(PlyKey, z.number().int().min(0).max(ATTEMPTS_MAX)),
  /** key = ply; the member's last chip */
  planChips: z.record(PlyKey, PlanKey),
  /** moment plies the member opted out of the Mistake Bank (P3-D19, read by P5) */
  bankOptOut: z.array(z.number().int().min(0)).max(3),
});
export type ReviewProgressV1 = z.infer<typeof ReviewProgressV1>;

/** What A5 sends to review_progress_merge after reducing an event batch in TS. */
export const ReviewProgressPatch = z.object({
  results: z.record(PlyKey, MomentResult).optional(),
  attempts: z.record(PlyKey, z.number().int().min(0)).optional(),
  planChips: z.record(PlyKey, PlanKey).optional(),
});
export type ReviewProgressPatch = z.infer<typeof ReviewProgressPatch>;

/** LinesV1 entry for one flagged ply (errors, brilliant/great, key moments). */
export const LineV1 = z.object({
  /** best line from the position before the ply, UCI space-separated */
  pv: z.string().max(200),
  /** alternatives within 2 Win% of best (MultiPV, pass 2) */
  alts: z.array(Uci).max(3),
  /** Win% lost by the played move × 10 (integer) */
  d: z.number().int().min(0).max(1000),
});
export type LineV1 = z.infer<typeof LineV1>;
/** game_analyses.lines: {"<ply>": LineV1} for flagged plies only. */
export const LinesV1 = z.record(PlyKey, LineV1);
export type LinesV1 = z.infer<typeof LinesV1>;

/** Validates a review document; throws a ZodError on a bad value (the worker, before its final batch). */
export function buildReviewContent(input: ReviewContentV1): ReviewContentV1 {
  return ReviewContentV1.parse(input);
}

/** Tolerant reader: `null` for a missing, legacy or malformed value. Never throws. */
export function parseReviewContent(value: unknown): ReviewContentV1 | null {
  const parsed = ReviewContentV1.safeParse(value);
  return parsed.success ? parsed.data : null;
}

/** Progress of a review nobody has opened (also what a NULL column means). */
export function emptyReviewProgress(): ReviewProgressV1 {
  return { v: 1, momentIndex: 0, results: {}, attempts: {}, planChips: {}, bankOptOut: [] };
}

/** Tolerant reader: a NULL column is empty progress; a malformed value reads as `null`. Never throws. */
export function parseReviewProgress(value: unknown): ReviewProgressV1 | null {
  if (value === null || value === undefined) return emptyReviewProgress();
  const parsed = ReviewProgressV1.safeParse(value);
  return parsed.success ? parsed.data : null;
}

/** Tolerant reader for game_analyses.lines: NULL is `{}`; a malformed value reads as `null`. Never throws. */
export function parseLines(value: unknown): LinesV1 | null {
  if (value === null || value === undefined) return {};
  const parsed = LinesV1.safeParse(value);
  return parsed.success ? parsed.data : null;
}

/**
 * The TypeScript twin of the SQL function `review_progress_merge(p, patch, idx)` (M3 migration), for optimistic
 * client state and for the parity test (packages/db/test/m3.int.test.ts asserts both give the same document).
 * Monotonic: momentIndex never goes back, an existing result is never overwritten, attempts keep the per-ply max
 * (capped at ATTEMPTS_MAX), the latest chip wins, bankOptOut is carried over.
 */
export function mergeReviewProgress(
  stored: ReviewProgressV1 | null,
  patch: ReviewProgressPatch,
  momentIndex: number | null,
): ReviewProgressV1 {
  const p = stored ?? emptyReviewProgress();
  const results: Record<string, MomentResult> = { ...(patch.results ?? {}), ...p.results };
  const attempts: Record<string, number> = { ...p.attempts };
  for (const [ply, n] of Object.entries(patch.attempts ?? {})) {
    attempts[ply] = Math.min(ATTEMPTS_MAX, Math.max(attempts[ply] ?? 0, n));
  }
  for (const ply of Object.keys(attempts)) attempts[ply] = Math.min(ATTEMPTS_MAX, attempts[ply]!);
  return {
    v: 1,
    momentIndex: Math.min(MOMENT_INDEX_MAX, Math.max(p.momentIndex, momentIndex ?? 0, 0)),
    results,
    attempts,
    planChips: { ...p.planChips, ...(patch.planChips ?? {}) },
    bankOptOut: [...p.bankOptOut],
  };
}
