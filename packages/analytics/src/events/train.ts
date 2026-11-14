// Train and Mistake Bank events (phase-05 plan §10.1, TST X6): the hub, the bank, the runner (bank and puzzles), the
// session summary, the theme picker, the outbox and the game-over bank line (client, `trackTrain()` in
// apps/web/lib/analytics/train-events.ts), plus `train_attempts_applied` (web, posthog-node in W1's `after()`) and
// `mistakes_extracted` (the analysis worker's J1 and EXTRACT_MISTAKES). P5 owns `train_session_*`; P6 reuses them with
// `kind: "weakness"` (consistency R-18). Closed property sets: no FEN, SAN or UCI, no opponent names, refs or free
// text. A theme is a Lichess theme key or an `rc:` key (a taxonomy label, not user content).
import { z } from "zod";

// ── Shared property types (drift-tested against @repo/contracts/http/train in train.test.ts) ────────────────────
export const TRAIN_ITEM_KINDS = ["mistake", "review_position", "puzzle", "opening_line"] as const;
export const TRAIN_SESSION_KINDS = ["daily", "bank", "puzzles", "weakness", "practice"] as const;
export const TRAIN_SESSION_SOURCES = [
  "hub",
  "plan",
  "bank",
  "review_complete",
  "summary",
  "nav",
  "solve_one",
  "home",
  "picker",
  "deeplink",
] as const;
export const TRAIN_GRADES = ["again", "hard", "good", "easy"] as const;
export const TRAIN_REPORT_REASONS = ["wrong_solution", "better_move", "illegal_move", "text_wrong", "other"] as const;
export const GAME_OVER_MODES = ["bot", "friend", "online", "tournament"] as const;
export const EXTRACT_SOURCES = ["live", "import", "backfill"] as const;

const count = (max = 10_000) => z.number().int().min(0).max(max);
const itemKind = z.enum(TRAIN_ITEM_KINDS);
const sessionKind = z.enum(TRAIN_SESSION_KINDS);
const grade = z.enum(TRAIN_GRADES);
/** A theme key (`fork`, `rc:recapture`), never a label. */
const theme = z.string().regex(/^(rc:)?[A-Za-z0-9]{2,30}$/);
const pct = z.number().int().min(0).max(100);
const rating = z.number().int().min(0).max(4_000);
const ms = z.number().int().min(0).max(86_400_000);

export const trainClientEvents = {
  // ── Hub (S2) ──
  train_hub_viewed: z
    .object({
      state: z.enum(["default", "nothingdue", "new_user"]),
      due_shown: count(),
      due_raw: count(),
      plan_done: count(3),
      plan_total: count(3),
      streak: count(),
    })
    .strict(),
  train_hub_link_clicked: z.object({ target: z.enum(["bank", "puzzles", "step_1", "step_2", "thumb"]) }).strict(),
  train_plan_started: z.object({ steps: count(3), est_min: count(120), resumed: z.boolean() }).strict(),
  train_plan_step_completed: z.object({ step: z.number().int().min(1).max(3), kind: z.enum(["bank", "puzzles", "lesson", "review", "import"]) }).strict(),
  // ── Runner (S4, S5) ──
  train_session_started: z
    .object({
      kind: sessionKind,
      source: z.enum(TRAIN_SESSION_SOURCES),
      theme: theme.nullable(),
      size: count(40),
      items: count(40),
      counts_toward_cap: z.boolean(),
      resumed: z.boolean(),
      widened: z.boolean(),
    })
    .strict(),
  train_item_shown: z.object({ kind: itemKind, theme, rating: rating.nullable(), pass: z.union([z.literal(1), z.literal(2)]), index: count(1_000) }).strict(),
  train_hint_used: z.object({ step: z.union([z.literal(1), z.literal(2)]) }).strict(),
  train_wrong_move: z.object({ kind: itemKind, is_game_move: z.boolean() }).strict(),
  train_solution_shown: z.object({ kind: itemKind, after_wrong: z.boolean() }).strict(),
  train_item_graded: z
    .object({
      grade,
      suggested: grade,
      overridden: z.boolean(),
      first_try: z.boolean(),
      hints: count(2),
      wrongs: count(10),
      time_ms: z.number().int().min(0).max(3_600_000),
      interval_days: z.number().min(0).max(36_500),
      kind: itemKind,
      pass: z.union([z.literal(1), z.literal(2)]),
      offline: z.boolean(),
    })
    .strict(),
  train_item_skipped: z.object({ kind: itemKind }).strict(),
  train_item_reported: z.object({ kind: itemKind, reason: z.enum(TRAIN_REPORT_REASONS) }).strict(),
  train_attempt_conflict: z.object({ kind: itemKind }).strict(),
  train_session_completed: z
    .object({ kind: sessionKind, solved: count(40), total: count(40), perfect: z.boolean(), duration_s: count(86_400) })
    .strict(),
  train_session_abandoned: z
    .object({ kind: sessionKind, solved: count(40), total: count(40), perfect: z.boolean(), duration_s: count(86_400) })
    .strict(),
  // ── Summary (S7) ──
  train_summary_next_clicked: z.object({ target: z.enum(["puzzles", "train", "lesson"]) }).strict(),
  // ── Mistake Bank (S3) ──
  bank_viewed: z
    .object({ state: z.enum(["empty", "caughtup", "default"]), due: count(), total: count(), complete: z.boolean() })
    .strict(),
  bank_filter_applied: z
    .object({
      theme: theme.nullable(),
      phase: z.enum(["opening", "middlegame", "endgame"]).nullable(),
      source: z.enum(["own", "missed"]).nullable(),
      results: count(),
    })
    .strict(),
  bank_solve_one_clicked: z.object({ mastery: count(5) }).strict(),
  bank_see_in_game_clicked: z.object({}).strict(),
  bank_card_removed: z.object({ undo: z.boolean() }).strict(),
  // ── Puzzles (S5, S6) ──
  puzzle_theme_changed: z.object({ from: theme.nullable(), to: theme, pct: pct.nullable(), surface: z.enum(["picker", "url"]) }).strict(),
  puzzle_rating_changed: z.object({ delta: z.number().int().min(-1_000).max(1_000), rating, provisional: z.boolean() }).strict(),
  theme_milestone_reached: z.object({ theme, pct: z.union([z.literal(50), z.literal(70), z.literal(90)]) }).strict(),
  streak_extended: z.object({ days: count(36_500) }).strict(),
  streak_reset: z.object({ days_before: count(36_500) }).strict(),
  // ── Outbox ──
  train_offline_flush: z.object({ items: count(500), max_age_s: count(30 * 86_400), duplicates: count(500) }).strict(),
  // ── Game-over card (P2 slot, P5 line) ──
  game_over_bank_line_shown: z.object({ count: count(4), mode: z.enum(GAME_OVER_MODES) }).strict(),
} as const;

export const trainServerEvents = {
  /** W1 `after()`: one per accepted batch. */
  train_attempts_applied: z
    .object({ n: count(50), ok: count(50), duplicates: count(50), conflicts: count(50), rejected: count(50), batch_ms: ms })
    .strict(),
  /** Worker J1 (inside ANALYZE_GAME) and the EXTRACT_MISTAKES backfill, one per member side. */
  mistakes_extracted: z
    .object({
      candidates: count(4),
      puzzles: count(4),
      review_positions: count(4),
      cards_added: count(3),
      recurrences: count(4),
      extract_ms: ms,
      source: z.enum(EXTRACT_SOURCES),
    })
    .strict(),
} as const;

export const trainEvents = { ...trainClientEvents, ...trainServerEvents } as const;
