// Weakness Profile events (phase-06 plan §10.1, TST X6): the profile page in every status, the drill config and the
// worker's recompute. Client events go through WP6's helper (consent-gated, P11); server events are sent by the
// analysis worker (`distinct_id = userRef`). Closed property sets: pattern keys (taxonomy keys such as `fork` or
// `rc:timePressure`, never labels), counts and enums only — no FEN, no names, no emails, no refs.
//
// Every client event carries the four context properties of §10.1: `device` (phone / tablet / desktop, the layout
// the page chose), `viewport_w` (CSS px), `zoom_bucket` (the page zoom rounded to the tested levels: 80, 100, 110,
// 125, 150, else `other`) and `is_trial`. P5's `train_session_started` / `train_session_completed` are reused for
// the runner with `kind: "weakness"` and `theme = pattern` (consistency R-18): nothing is re-declared here.
import { z } from "zod";

export const WEAKNESS_EVENT_STATUSES = ["insufficient", "computing", "ready", "failed"] as const;
export const WEAKNESS_LIST_MODES = ["vs_band", "own_only", "most_frequent"] as const;
export const WEAKNESS_ENTRIES = ["nav", "hub", "home", "palette", "chord", "direct", "dot"] as const;
export const WEAKNESS_TABS = ["phase", "clock", "open", "str"] as const;
export const WEAKNESS_DEVICES = ["phone", "tablet", "desktop"] as const;
export const WEAKNESS_ZOOM_BUCKETS = ["80", "100", "110", "125", "150", "other"] as const;
export const WEAKNESS_RECOMPUTE_FROM = ["failed", "bullet_offer", "auto"] as const;
export const WEAKNESS_RECOMPUTE_RESULTS = ["ok", "rate_limited", "error"] as const;
export const WEAKNESS_PLAN_KINDS = ["drill", "puzzles", "lesson"] as const;
export const WEAKNESS_DRILL_SURFACES = ["inline", "sheet"] as const;
export const WEAKNESS_DRILL_ENTRIES = ["row", "hub", "plan"] as const;
export const WEAKNESS_DRILL_RESULTS = ["ok", "empty", "rate_limited", "error"] as const;
/** The worker's `payload.trigger` (CT/internal/jobs.ts WEAKNESS_TRIGGERS; drift-tested). */
export const WEAKNESS_EVENT_TRIGGERS = ["analysis", "first_build", "import", "user", "scope", "heal", "algo", "weekly", "removed"] as const;
export const WEAKNESS_BAND_SOURCES = ["lichess", "chesscom", "replay", "onboarding"] as const;
export const WEAKNESS_SNAPSHOT_STATUSES = ["ready", "insufficient", "failed"] as const;

const count = (max = 100_000) => z.number().int().min(0).max(max);
/** A taxonomy key (`fork`, `hangingPiece`, `rc:timePressure`), never a label. */
const pattern = z.string().regex(/^(rc:)?[a-z][A-Za-z0-9]{1,31}$/);
const rank = z.number().int().min(1).max(5);
const share = z.number().min(0).max(1);

/** The §10.1 context every weakness client event carries. */
const context = {
  device: z.enum(WEAKNESS_DEVICES),
  viewport_w: z.number().int().min(0).max(10_000),
  zoom_bucket: z.enum(WEAKNESS_ZOOM_BUCKETS),
  is_trial: z.boolean(),
};

export const weaknessClientEvents = {
  /** Page mount, once per status per visit. */
  weakness_viewed: z
    .object({
      ...context,
      status: z.enum(WEAKNESS_EVENT_STATUSES),
      patterns: count(5),
      games_analysed: count(),
      games_in_scope: count(),
      list_mode: z.enum(WEAKNESS_LIST_MODES).nullable(),
      top_pattern: pattern.nullable(),
      band_min: z.number().int().min(0).max(4_000).nullable(),
      has_clock: z.boolean(),
      updating: z.boolean(),
      entry: z.enum(WEAKNESS_ENTRIES),
    })
    .strict(),
  weakness_computing_viewed: z
    .object({
      ...context,
      pct: count(100),
      eta_sec: z.number().int().min(0).max(86_400).nullable(),
      stalled: z.boolean(),
      target: count(300),
      orphaned: z.boolean(),
    })
    .strict(),
  /** TR-13 sent. `latency_s` = now − computedAt. */
  weakness_ready_seen: z.object({ ...context, version: count(10_000_000), latency_s: count(365 * 86_400) }).strict(),
  weakness_row_expanded: z.object({ ...context, pattern, rank }).strict(),
  weakness_tab_changed: z.object({ ...context, tab: z.enum(WEAKNESS_TABS) }).strict(),
  weakness_see_all_clicked: z.object({ ...context, more_count: count(2) }).strict(),
  weakness_import_cta_clicked: z.object({ ...context, analysed: count() }).strict(),
  weakness_play_cta_clicked: z.object({ ...context, analysed: count() }).strict(),
  weakness_include_bullet_clicked: z.object({ ...context, bullet_games: count() }).strict(),
  weakness_recompute_clicked: z
    .object({ ...context, from: z.enum(WEAKNESS_RECOMPUTE_FROM), result: z.enum(WEAKNESS_RECOMPUTE_RESULTS) })
    .strict(),
  weakness_week_plan_clicked: z.object({ ...context, kind: z.enum(WEAKNESS_PLAN_KINDS), pattern }).strict(),
  weakness_drill_opened: z
    .object({ ...context, pattern, rank: rank.nullable(), surface: z.enum(WEAKNESS_DRILL_SURFACES), entry: z.enum(WEAKNESS_DRILL_ENTRIES) })
    .strict(),
  weakness_drill_configured: z
    .object({ ...context, pattern, size: z.union([z.literal(10), z.literal(20)]), mix: z.boolean() })
    .strict(),
  weakness_drill_started: z
    .object({
      ...context,
      pattern,
      size: z.union([z.literal(10), z.literal(20)]),
      mix: z.boolean(),
      own: count(20),
      puzzles: count(20),
      result: z.enum(WEAKNESS_DRILL_RESULTS),
    })
    .strict(),
} as const;

export const weaknessServerEvents = {
  /** The worker, after every snapshot write (READY or INSUFFICIENT; a FAILED write sends weakness_recompute_failed). */
  weakness_snapshot_computed: z
    .object({
      status: z.enum(WEAKNESS_SNAPSHOT_STATUSES),
      algo_version: count(1_000),
      trigger: z.enum(WEAKNESS_EVENT_TRIGGERS),
      games_in_scope: count(300),
      games_analysed: count(300),
      list_mode: z.enum(WEAKNESS_LIST_MODES).nullable(),
      top_patterns: z.array(pattern).max(3),
      band_center: z.number().int().min(0).max(4_000).nullable(),
      band_source: z.enum(WEAKNESS_BAND_SOURCES).nullable(),
      duration_ms: count(600_000),
      healed_rows: count(300),
      bumped: z.boolean(),
    })
    .strict(),
  /** The member's first READY profile. */
  weakness_first_ready: z
    .object({
      minutes_since_first_analysis: count(10_000_000),
      games_analysed: count(300),
      source_mix: z.object({ lichess: share, chesscom: share, replay: share }).strict(),
    })
    .strict(),
  /** The final failed attempt (no PII: the error code only). */
  weakness_recompute_failed: z
    .object({ code: z.string().regex(/^[a-z][a-z0-9_]{0,39}$/), attempts: count(10), trigger: z.enum(WEAKNESS_EVENT_TRIGGERS) })
    .strict(),
} as const;

export const weaknessEvents = { ...weaknessClientEvents, ...weaknessServerEvents } as const;
