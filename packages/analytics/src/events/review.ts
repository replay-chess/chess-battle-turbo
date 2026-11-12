// Game Review events (phase-03 plan §10.1, TST X6): the review, the walkthrough, the game-over slots, shares, the
// archive, the legend comparison, Practice and How we grade (client, `track()`), plus the server events the web
// (posthog-node in `after()`), the socket server and the analysis worker (HTTP `/batch`, every 5 s) send with
// `distinct_id` = User.referenceId. Closed property sets: no FEN, PGN, SAN, names, refs or free text. Numbers that
// could identify a game are bucketed. P2's `engine_init` is reused unchanged for Practice's engine load (R-18).
import { z } from "zod";

// ── Shared property types ───────────────────────────────────────────────────────────────────────────────────────
export const ANALYSIS_STATUSES = ["none", "queued", "running", "done", "failed", "skipped"] as const;
export const ANALYSIS_FAILURE_CODES = ["engine_failed", "worker_stalled", "timeout", "internal"] as const;
export const JUDGEMENTS = [
  "brilliant",
  "great",
  "best",
  "excellent",
  "good",
  "book",
  "forced",
  "interesting",
  "inaccuracy",
  "mistake",
  "miss",
  "blunder",
] as const;
export const PLAN_CHIPS = ["attack", "defend", "trade", "improve", "unsure"] as const;
export const PRIORITY_BANDS = ["80+", "<80"] as const;
export const COMPARISON_STATUSES = ["facts_ready", "narrating", "ready", "failed"] as const;
export const DEVICE_CLASSES = ["phone", "tablet", "desktop"] as const;
export const REVIEW_SOURCES = ["game_over", "archive", "home", "deeplink", "share_owner"] as const;
export const SHARE_FROM = ["review_menu", "complete"] as const;
export const ANALYZE_REASONS = ["live_end", "bot_end", "opened", "retry", "regrade", "backfill", "smoke"] as const;
export const GAME_MODES = ["online", "friend", "bot", "legend_bot", "tournament", "imported"] as const;
export const GAME_SOURCES = ["replay", "chesscom", "lichess"] as const;

const count = (max = 10_000) => z.number().int().min(0).max(max);
const ms = z.number().int().min(0).max(86_400_000);
const idx = z.number().int().min(0).max(2);
const moments = z.number().int().min(0).max(3);
/** A ply rounded down to a multiple of 10 (no exact move number leaves the client). */
const plyBucket = z.number().int().min(0).max(1_200).multipleOf(10);
/** A percentage rounded down to a multiple of 10. */
const pctBucket = z.number().int().min(0).max(100).multipleOf(10);
/** Coarse counts: "0", "1", "2-9", "10-29", "30-99", "100+". */
export const COUNT_BUCKETS = ["0", "1", "2-9", "10-29", "30-99", "100+"] as const;
const countBucket = z.enum(COUNT_BUCKETS);

/** The COUNT_BUCKETS bucket of a count. */
export function countBucketOf(n: number): (typeof COUNT_BUCKETS)[number] {
  if (n <= 0) return "0";
  if (n === 1) return "1";
  if (n < 10) return "2-9";
  if (n < 30) return "10-29";
  if (n < 100) return "30-99";
  return "100+";
}

/** Rounds down to a multiple of 10 (plyBucket, pctBucket, accuracy_bucket). */
export function bucket10(n: number): number {
  return Math.max(0, Math.floor(n / 10) * 10);
}

/** The review narration rates (Web Speech, plan §8.10). */
const narrationRate = z.union([z.literal(1), z.literal(1.25), z.literal(1.5)]);

// ── Client events (`track()`) ───────────────────────────────────────────────────────────────────────────────────
export const reviewClientEvents = {
  review_opened: z
    .object({ source: z.enum(REVIEW_SOURCES), status: z.enum(ANALYSIS_STATUSES), device: z.enum(DEVICE_CLASSES) })
    .strict(),
  review_summary_viewed: z.object({ accuracy_bucket: pctBucket.nullable(), moments, is_clean: z.boolean() }).strict(),
  review_tab_switched: z.object({ tab: z.enum(["coach", "moves"]) }).strict(),
  eval_graph_jump: z.object({ ply_bucket: plyBucket }).strict(),
  // Web Speech rates of the review narration (plan §8.10: 1, 1.25, 1.5); Compare's audio player uses 0.75/1/1.5.
  narration_played: z.object({ context: z.enum(["summary", "moment"]), speed: narrationRate }).strict(),
  narration_completed: z.object({ context: z.enum(["summary", "moment"]), speed: narrationRate }).strict(),
  review_started: z.object({ moments }).strict(),
  moment_viewed: z.object({ idx, judgement: z.enum(JUDGEMENTS) }).strict(),
  moment_attempt: z
    .object({ idx, correct: z.boolean(), attempt_no: z.number().int().min(1).max(50), accepted_as: z.enum(["best", "alt"]).nullable() })
    .strict(),
  moment_plan_picked: z.object({ idx, chip: z.enum(PLAN_CHIPS), matched_intent: z.boolean() }).strict(),
  moment_revealed: z.object({ idx, attempts: count(50) }).strict(),
  moment_show_line: z.object({ idx }).strict(),
  review_completed: z
    .object({ moments, found: moments, found_retry: moments, revealed: moments, duration_ms: ms })
    .strict(),
  game_over_review_clicked: z
    .object({ status_at_click: z.enum(ANALYSIS_STATUSES), has_coach_line: z.boolean(), legend: z.boolean() })
    .strict(),
  game_over_replay_clicked: z.object({ divergence_ply_bucket: plyBucket }).strict(),
  analysis_retry_clicked: z.object({ code: z.enum(ANALYSIS_FAILURE_CODES), attempt: z.number().int().min(1).max(10) }).strict(),
  pgn_downloaded: z.object({ annotated: z.literal(true) }).strict(),
  how_we_grade_viewed: z
    .object({ tab: z.enum(["labels", "acc", "coach"]), from: z.enum(["review", "game_over", "nav", "deeplink", "pricing"]) })
    .strict(),
  share_opened: z.object({ from: z.enum(SHARE_FROM) }).strict(),
  share_link_copied: z.object({ from: z.enum(SHARE_FROM), show_username: z.boolean() }).strict(),
  share_image_downloaded: z.object({ from: z.enum(SHARE_FROM), show_username: z.boolean() }).strict(),
  share_posted_x: z.object({ from: z.enum(SHARE_FROM), show_username: z.boolean() }).strict(),
  share_pgn_copied: z.object({ from: z.enum(SHARE_FROM), show_username: z.boolean() }).strict(),
  share_username_toggled: z.object({ from: z.enum(SHARE_FROM), show_username: z.boolean() }).strict(),
  share_revoked: z.object({ from: z.enum(SHARE_FROM), show_username: z.boolean() }).strict(),
  share_signup_clicked: z.object({}).strict(),
  games_archive_viewed: z.object({ count_bucket: countBucket, filters_active: z.number().int().min(0).max(4) }).strict(),
  games_archive_filtered: z
    .object({
      result: z.array(z.enum(["win", "loss", "draw"])).max(3),
      tc: z.array(z.enum(["bullet", "blitz", "rapid", "classical"])).max(4),
      moments: z.boolean(),
      /** Length of the search text only, never the text. */
      q_len: z.number().int().min(0).max(40),
      results_bucket: countBucket,
    })
    .strict(),
  games_archive_game_opened: z.object({ analysed: z.boolean(), target: z.enum(["review", "compare"]) }).strict(),
  /** P3 owns it; P8 reuses it (R-18). */
  legend_compare_opened: z
    .object({ from: z.enum(["game_over", "archive", "review_menu"]), status: z.enum(COMPARISON_STATUSES) })
    .strict(),
  compare_tab_viewed: z
    .object({
      tab: z.enum(["explanation", "your_moves", "legend_moves", "practice"]),
      comparison_status: z.enum(COMPARISON_STATUSES),
    })
    .strict(),
  compare_narration_played: z
    .object({
      pct_listened: pctBucket,
      speed: z.union([z.literal(0.75), z.literal(1), z.literal(1.5)]),
      audio_failed: z.boolean(),
    })
    .strict(),
  practice_started: z
    .object({ from: z.enum(["compare", "review", "position", "fen", "game_over"]), ply_bucket: plyBucket.nullable() })
    .strict(),
  practice_action: z.object({ action: z.enum(["takeback", "reset", "hint1", "hint2", "compare"]) }).strict(),
} as const;

// ── Server events (web `after()`, the socket server, the worker) ────────────────────────────────────────────────
export const reviewServerEvents = {
  /** Once per dedupeKey: only when the enqueue created the job. */
  analysis_queued: z
    .object({
      game_mode: z.enum(GAME_MODES),
      source: z.enum(GAME_SOURCES),
      reason: z.enum(ANALYZE_REASONS),
      priority: z.number().int().min(0).max(100),
      queue_position: count(100_000),
    })
    .strict(),
  /** Worker claim. */
  analysis_started: z
    .object({
      wait_ms: ms,
      attempt: z.number().int().min(1).max(10),
      resumed_from_ply: count(1_200),
      priority: z.number().int().min(0).max(100),
      band: z.enum(PRIORITY_BANDS),
    })
    .strict(),
  /** Worker done. `ms_from_game_end` is null for regrades, backfills and smoke runs (excluded from the SLO). */
  analysis_ready: z
    .object({
      ms_from_game_end: ms.nullable(),
      plies: count(1_200),
      nodes_total: z.number().int().min(0).max(1e12),
      cache_hit_ratio: z.number().min(0).max(1),
      duration_ms: ms,
      pass2_positions: count(100),
      moments_w: moments,
      moments_b: moments,
      clean_w: z.boolean(),
      clean_b: z.boolean(),
      regrade: z.boolean(),
    })
    .strict(),
  analysis_failed: z
    .object({
      code: z.enum(ANALYSIS_FAILURE_CODES),
      attempt: z.number().int().min(1).max(10),
      failed_at_ply: count(1_200),
      retryable: z.boolean(),
    })
    .strict(),
  /** Worker: a job that had failed before finished after a user's Retry. */
  analysis_retry_succeeded: z
    .object({ code: z.enum(ANALYSIS_FAILURE_CODES), attempt: z.number().int().min(1).max(10) })
    .strict(),
  /** A10, once per Idempotency-Key (not on a reuse or replay). */
  share_link_created: z.object({ from: z.enum(SHARE_FROM), show_username: z.boolean() }).strict(),
  /** `/r` page `after()` on ISR renders, and the client island beacon. `referrer_domain` is a host only (no path). */
  share_page_viewed: z
    .object({
      referrer_domain: z
        .string()
        .max(80)
        .regex(/^(?:none|[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+)$/),
      signed_in: z.boolean(),
    })
    .strict(),
} as const;

export const reviewEvents = { ...reviewClientEvents, ...reviewServerEvents } as const;
