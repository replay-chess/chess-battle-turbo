// User-room events of server analysis (phase-03 plan §5.11; P3-D13, P3-D26, AP-10). Every event goes to
// `user:{userRef}` through P2's `POST /internal/emit {v:1, targets, event, data, dedupeKey?}` and is registered in
// registry.ts EMIT_EVENTS (WP-E) with the schema and budget below. Payloads carry `v: 1`; the socket server adds
// `useq` on delivery (registry.ts UseqStamp), so these objects are not strict.
//
// Only the game's member players ever receive them ("analysis private to players"). Shared events (`progress`,
// `writing`, `failed`, `games:changed`) go out as one call with both members in `targets`; `analysis:done` is
// personalised, one call per member side (dedupeKey analysisDoneDedupeKey()).
import { z } from "zod";
import { Ref } from "../http/common";
import { AnalysisFailureCode, BestTokens, bestTokenCount, EvalCode, JString, MAX_MOMENTS } from "../http/review";
import { ReviewBank } from "../http/train";

// ── Cadence (worker side, P3-D26) ───────────────────────────────────────────────────────────────────────────────
/** One `analysis:progress` frame every this many plies … */
export const PROGRESS_FRAME_EVERY_PLIES = 2;
/** … or this often, whichever comes first. */
export const PROGRESS_FRAME_EVERY_MS = 300;
/** A frame never carries more plies than this (fast book/cache plies are split), which keeps it ≤ 400 B. */
export const PROGRESS_FRAME_MAX_PLIES = 8;
/** Below band 80 and not watched: at most one coalesced `analysis:batch` per user per this interval. */
export const ANALYSIS_BATCH_EVERY_MS = 60_000;
export const ANALYSIS_BATCH_MAX_REFS = 20;

/** `done:<gameId>:<version>:<color>`: one `analysis:done` per member side and grading version. */
export function analysisDoneDedupeKey(gameId: bigint | number | string, version: number, color: "w" | "b"): string {
  return `done:${String(gameId)}:${version}:${color}`;
}

// ── Payloads ────────────────────────────────────────────────────────────────────────────────────────────────────
const Count = z.number().int().min(0);

/**
 * P5 (phase-05 §7.1, §7.6 step 6): the BANK cards that exist for this game side's moment plies after the analysis
 * batch committed (`plies` ≤ 4, ascending). The same shape as A2's `ReviewStatusDTO.bank`.
 */
export const BankAdded = ReviewBank;
export type BankAdded = z.infer<typeof BankAdded>;

/** Web A3/A4 (in `after()`), the socket finish (after commit), bot `complete`. ≤ 80 B. */
export const AnalysisQueuedEvent = z.object({
  v: z.literal(1),
  gameRef: Ref,
  /** Jobs ahead of this one. */
  position: Count,
  etaSec: Count,
});
export type AnalysisQueuedEvent = z.infer<typeof AnalysisQueuedEvent>;

/**
 * A ply delta: plies `from … gradedPlies − 1` were graded since the last frame. `j` and `best` carry one entry per
 * new ply; `evals` the new positions (at most one more than the new plies, when `from` is 0 the start position is
 * new too). The client splices them in with `mergePlies` (CA/src/codec.ts) and ignores a frame whose `gradedPlies`
 * is not above what it holds. Sent only while the job's priority ≥ GAME_ENDED or the game is watched. ≤ 400 B.
 */
export const AnalysisProgressEvent = z
  .object({
    v: z.literal(1),
    gameRef: Ref,
    from: Count,
    gradedPlies: Count,
    totalPlies: Count,
    evals: z.array(EvalCode).max(PROGRESS_FRAME_MAX_PLIES + 1),
    best: BestTokens,
    j: JString.max(PROGRESS_FRAME_MAX_PLIES),
    /** Median depth reached so far (the "depth 18" label). */
    depthP50: Count,
  })
  .superRefine((e, ctx) => {
    if (e.from > e.gradedPlies) ctx.addIssue({ code: "custom", path: ["from"], message: "from > gradedPlies" });
    if (e.gradedPlies > e.totalPlies) ctx.addIssue({ code: "custom", path: ["gradedPlies"], message: "gradedPlies > totalPlies" });
    const plies = e.gradedPlies - e.from;
    if (e.j.length !== plies) ctx.addIssue({ code: "custom", path: ["j"], message: "one judgement per new ply" });
    if (bestTokenCount(e.best) !== plies) ctx.addIssue({ code: "custom", path: ["best"], message: "one best move per new ply" });
    if (e.evals.length > plies + 1) ctx.addIssue({ code: "custom", path: ["evals"], message: "more evals than new positions" });
  });
export type AnalysisProgressEvent = z.infer<typeof AnalysisProgressEvent>;

/** Pass 2 deep searches in one run: at most ENGINE_PROFILE.pass2.maxPositions (6) + the legend pair (2). */
export const WRITING_STEPS_MAX = 8;

/**
 * Pass 2 (the "Finding your key moments" phase): sent when it starts, then after each deep search with `at` of `of`
 * planned searches, so the card shows real progress through the phase's ~10 s on the dev box instead of sitting at 95 %
 * (dev pass D3): `at` of `of` (short keys: the 60 B budget). Both are absent on a frame from before the counts existed. ≤ 60 B.
 */
export const AnalysisWritingEvent = z
  .object({
    v: z.literal(1),
    gameRef: Ref,
    at: z.number().int().min(0).max(WRITING_STEPS_MAX).optional(),
    of: z.number().int().min(0).max(WRITING_STEPS_MAX).optional(),
  })
  .refine((e) => (e.at === undefined) === (e.of === undefined) && (e.at ?? 0) <= (e.of ?? 0), {
    message: "at and of come together, at ≤ of",
  });
export type AnalysisWritingEvent = z.infer<typeof AnalysisWritingEvent>;

/** Personalised per recipient (one emit per member side). The client refetches A1 once on it. ≤ 480 B (P5). */
export const AnalysisDoneEvent = z.object({
  v: z.literal(1),
  gameRef: Ref,
  /** The GRADING_VERSION that wrote it. */
  analysisVersion: z.number().int().min(1),
  /** The recipient's accuracy (null for < 3 positions). */
  accuracy: z.number().int().min(0).max(100).nullable(),
  momentsCount: z.number().int().min(0).max(MAX_MOMENTS),
  headline: z.string().max(80).nullable(),
  /** The game-over card line (§8.7), ≤ 160 characters. */
  coachLine: z.string().max(160).nullable(),
  isClean: z.boolean(),
  /**
   * Reserved by P3 and kept null: the socket parses `data` with this schema, so a newer worker sending a non-null
   * `bank` to an older socket would be dropped. P5's values travel in the two optional fields below (interface check
   * §0.4: extra keys are stripped by an older socket, missing ones are fine for a newer client).
   */
  bank: z.null(),
  /** P5: the cards this game side has in the bank now; null when the response of the batch was lost or J1 was off. */
  bankAdded: BankAdded.nullable().optional(),
  /** P5: the recipient's due count shown in the nav and on Home (the cap formula of §8.5 applied). */
  bankDue: Count.nullable().optional(),
});
export type AnalysisDoneEvent = z.infer<typeof AnalysisDoneEvent>;

/** The worker on a failed attempt, the reaper on a stalled job. ≤ 192 B. */
export const AnalysisFailedEvent = z.object({
  v: z.literal(1),
  gameRef: Ref,
  gradedPlies: Count,
  totalPlies: Count,
  failedAtPly: Count,
  /** False once the attempts are used up (the review shows the terminal state; A4 answers 410). */
  retryable: z.boolean(),
  /** When the automatic retry is due (back-off), or null for a terminal failure. */
  retryAt: z.iso.datetime().nullable(),
  code: AnalysisFailureCode,
});
export type AnalysisFailedEvent = z.infer<typeof AnalysisFailedEvent>;

/** Background jobs (band < 80, not watched), coalesced per user, at most one per 60 s, flushed at drain end. ≤ 672 B (P5). */
export const AnalysisBatchEvent = z.object({
  v: z.literal(1),
  done: Count,
  failed: Count,
  /** Still queued for this user when the frame was built. */
  queued: Count,
  /** The games this frame covers (most recent first), at most ANALYSIS_BATCH_MAX_REFS. */
  refs: z.array(Ref).max(ANALYSIS_BATCH_MAX_REFS),
  /** P5: BANK cards added by the games of this frame (summed since the last frame); optional for skew safety. */
  bankAdded: Count.nullable().optional(),
  /** P5: the recipient's due count after the last game of this frame. */
  bankDue: Count.nullable().optional(),
});
export type AnalysisBatchEvent = z.infer<typeof AnalysisBatchEvent>;

/** LEGEND_COMPARE finished (the compare page and the game-over legend block refetch). ≤ 64 B. */
export const CompareReadyEvent = z.object({ v: z.literal(1), gameRef: Ref, status: z.enum(["ready", "failed"]) });
export type CompareReadyEvent = z.infer<typeof CompareReadyEvent>;

/** The archive changed (a finish, or a band ≥ 80 analysis state). Lower bands use `analysis:batch`. ≤ 60 B. */
export const GamesChangedEvent = z.object({ v: z.literal(1), gameRef: Ref.optional() });
export type GamesChangedEvent = z.infer<typeof GamesChangedEvent>;

// ── Registry input (WP-E spreads these into registry.ts EMIT_EVENTS with `to: ["user"]`, `seq: false`) ──────────
export const ANALYSIS_EVENTS = {
  "analysis:queued": AnalysisQueuedEvent,
  "analysis:progress": AnalysisProgressEvent,
  "analysis:writing": AnalysisWritingEvent,
  "analysis:done": AnalysisDoneEvent,
  "analysis:failed": AnalysisFailedEvent,
  "analysis:batch": AnalysisBatchEvent,
  "compare:ready": CompareReadyEvent,
  "games:changed": GamesChangedEvent,
} as const;
export type AnalysisEventName = keyof typeof ANALYSIS_EVENTS;
export type AnalysisEventPayload<N extends AnalysisEventName> = z.output<(typeof ANALYSIS_EVENTS)[N]>;
export const ANALYSIS_EVENT_NAMES = Object.keys(ANALYSIS_EVENTS) as AnalysisEventName[];

/**
 * Serialised `data` budgets in bytes, asserted by test/analysis.test.ts with the worst-case fixtures.
 *
 * Measured, not guessed (as P2 did for the game events; plan clarification recorded in the WP-D-contracts hand-back):
 * §5.11's figures hold for queued (80), progress (400), writing (60) and games:changed (60), but not for four events
 * whose plan-mandated fields cannot fit with `v: 1` and a 25-character ref:
 *   - done: a 160-character coach line plus an 80-character headline (both schema limits, with "·"/"…") = 399 B;
 *   - failed: a typical payload is already 172 B (the ISO `retryAt` alone is 26 B); 3-digit plies + `worker_stalled`
 *     = 176 B, so 192 leaves room for 4-digit plies;
 *   - batch: 20 refs of 25 characters are 560 B of refs alone; 612 B with the counters;
 *   - compare:ready: `{"v":1,"gameRef":…,"status":"failed"}` = 63 B.
 * P5 (phase-05 §7.1, §9.4; interface check §0.4) re-measured the two events that gained the bank fields: done 469 B
 * (the 399 B frame + `bankAdded` with four 4-digit plies + a 5-digit `bankDue`) → 480; batch 645 B → 672.
 */
export const ANALYSIS_EVENT_BUDGETS = {
  "analysis:queued": 80,
  "analysis:progress": 400,
  "analysis:writing": 60,
  "analysis:done": 480,
  "analysis:failed": 192,
  "analysis:batch": 672,
  "compare:ready": 64,
  "games:changed": 60,
} as const satisfies Record<AnalysisEventName, number>;

// ── `game:result.review` (the live game-over seed; CT/socket/events.ts GameResultEvent, WP-E) ──────────────────
/** P2's `{ status: "none" }` widens to this: `queued` for ≥ 6 plies, `skipped` for shorter or aborted games. */
export const GameResultReview = z.object({
  status: z.enum(["queued", "skipped"]),
  etaSec: z.number().int().min(0).nullable(),
});
export type GameResultReview = z.infer<typeof GameResultReview>;
