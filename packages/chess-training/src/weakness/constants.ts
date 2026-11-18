// Constants of the Weakness Profile (phase-06 plan §8.1). One place: the engine, the worker, the web DAL, the UI and
// the `/how-we-grade#weakness` page read them, so a product change is a one-line edit with the tests that pin it.
// Browser-safe: its only imports are the chess-analysis clock and codec modules (no Node, no chess.js, no zod).

/** Bump → B-W3 re-enqueues every member and the daily `algo` sweep rebuilds older snapshots. */
export const ALGO_VERSION = 1;

// ── Thresholds (D8 / X15 / R-WK-04) ─────────────────────────────────────────────────────────────────────────────
/** Analysed in-scope games for a full profile ("14 / 20 games analysed"). */
export const GAMES_REQUIRED = 20;
/** The preliminary list shows from this many analysed games. */
export const PRELIMINARY_FROM = 5;
/** Preliminary rows need the pattern in at least this many games. */
export const PRELIMINARY_MIN_GAMES = 2;
export const PRELIMINARY_ROWS = 3;

// ── Scope (rct-b Q24, D-P6-1) ───────────────────────────────────────────────────────────────────────────────────
export const SCOPE_DEFAULT = { timeClasses: ["RAPID", "BLITZ"], months: 6, maxGames: 300 } as const;
export const SCOPE_MONTHS = [3, 6, 12] as const;
export const MAX_GAMES = 300;

// ── Eligibility and ranking (R-WK-05) ───────────────────────────────────────────────────────────────────────────
export const MIN_EVENTS = 5;
export const MIN_GAMES_WITH = 3;
/** User moves a theme candidate needs. */
export const MIN_MOVES = 200;
/** Moves under one minute the time-pressure candidate needs. */
export const MIN_MOVES_TP = 100;
/**
 * The effect a band comparison must show (FIX-2, D-P6-FIX2-1; the plan's ratio 1.5 OR z 2 flagged 58–81 % of exactly
 * band-average members, measured on the J5 sides): the member's capped rate is at least this multiple of the band's
 * capped rate…
 */
export const RATIO_MIN = 1.25;
/**
 * …and the count is unlikely under the band's rate: the quasi-Poisson tail P(X ≥ k) is at most FAMILY_ALPHA divided
 * by the number of candidate keys tested (Bonferroni over the taxonomy: ~30 themes are tested for every member, so a
 * per-theme 5 % test flags some theme for most members by chance). A band-average member then gets a `vs_band` list
 * in at most ~10 % of cases (measured 1–10 % over bullet, blitz and rapid at 50, 150 and 300 games).
 */
export const FAMILY_ALPHA = 0.1;
/**
 * The ratio and the test count at most this many events of a pattern per game (FIX-1, D-P6-FIX1-5), for the member
 * AND the band (FIX-2: the baseline's `capped100`; v1 measured capped/raw ≈ 0.63–0.67 for rook endgames against ≈ 0.95
 * for forks, so capping one side only set a stricter bar for themes that cluster in games). The shown rate and the
 * ranking score keep every event. Time pressure is exempt on both sides: its denominator (moves under a minute)
 * clusters in the same scrambles as its events.
 */
export const EVENTS_PER_GAME_CAP = 2;
/** `most_frequent` fallback rows need at least this many events. */
export const MOST_FREQUENT_MIN_EVENTS = 3;
export const TOP_N = 3;
export const MORE_N = 2;

// ── Trend (rct-b W1) ────────────────────────────────────────────────────────────────────────────────────────────
export const TREND_RECENT_DAYS = 30;
/** The prior window ends where the recent one starts and reaches back to day 90. */
export const TREND_PRIOR_DAYS = 60;
/**
 * FIX-2 (D-P6-FIX2-3): a direction needs the recent rate at least 1.25× the prior one (worse) or at most 1/1.25 of it
 * (better), symmetric in the log ratio…
 */
export const TREND_RATIO = 1.25;
/** …and a two-sided test of "same rate in both windows" at this level (the conditional binomial, widened by φ). */
export const TREND_ALPHA = 0.05;
/** Both windows need this many moves (≈ 10 games; the plan's 100 was ≈ 3 games)… */
export const TREND_MIN_MOVES = 300;
/** …or this many moves under a minute for time pressure. */
export const TREND_MIN_MOVES_TP = 60;

// ── Clock (design buckets "> 5, 2–5, 1–2, < 1 min"; rct-b W2) ──────────────────────────────────────────────────
/** `lt1 < 60 000 ≤ 1to2 < 120 000 ≤ 2to5 < 300 000 ≤ gt5` and the under-a-minute rule: the clock module's own values. */
export { CLOCK_EDGES_MS, TIME_PRESSURE_MS } from "@repo/chess-analysis/clock";
/** A clock bucket shows a rate from this many moves ("—" below). */
export const CLOCK_MIN_MOVES_BUCKET = 30;
/** The Clock tab needs this many timed moves in all. */
export const CLOCK_MIN_MOVES_TOTAL = 100;
/** The clock sentence speaks of a rise from this ratio (low clock vs > 5 min). */
export const CLOCK_SENTENCE_MIN_RATIO = 1.8;
/** Below 1.8× the sentence still says the rate rises from this ratio (FIX-1, D-P6-FIX1-2). */
export const CLOCK_SENTENCE_RISE_RATIO = 1.25;
/** …and says it drops at or below this ratio. */
export const CLOCK_SENTENCE_FALL_RATIO = 0.8;

// ── Where / examples ────────────────────────────────────────────────────────────────────────────────────────────
export const WHERE_LAST_N = 20;

// ── Rating band (R-WK-01, R-WK-02) ──────────────────────────────────────────────────────────────────────────────
export const BAND_HALF_WIDTH = 100;
export const BASELINE_STEP = 100;
export const BAND_CENTER_MIN = 700;
export const BAND_CENTER_MAX = 2400;
/** Rated games of one source needed to take its median. */
export const BAND_RATING_MIN_GAMES = 10;
/** The median is taken over the newest this many rated games of the source. */
export const BAND_RATING_SAMPLE = 20;
/** `User.ratingBand` midpoints (onboarding fallback). */
export const ONBOARDING_BAND_RATING = {
  NEW_TO_CHESS: 700,
  UNDER_800: 700,
  R800_1200: 1000,
  R1200_1600: 1400,
  R1600_2000: 1800,
  R2000_PLUS: 2100,
} as const;

// ── Drill (design DCLogic; P5 §8 "0.5 min per weakness item") ──────────────────────────────────────────────────
export const DRILL_SIZES = [10, 20] as const;
export const DRILL_OWN_SHARE = 0.6;
export const MIN_PER_ITEM = 0.5;
/** The week plan's drill row is always this size. */
export const WEEK_PLAN_DRILL_SIZE = 10;
/** The week plan's puzzle row: "3 drills a session". */
export const WEEK_PLAN_PUZZLES = 3;

// ── Coverage and jobs (D-P6-3, FE F-OCI-3, §7.4) ────────────────────────────────────────────────────────────────
/** In-scope analysed games wanted per member / per trialist (env WEAKNESS_ANALYSE_CAP / _TRIAL override them). */
export const ANALYSE_CAP = 100;
export const ANALYSE_CAP_TRIAL = 20;
/**
 * P4's eager analysis budget (interface check §5: the trialist's eager cap is 20, not the plan's 40). The worker reads
 * the live values from its import settings; these mirror them for the copy and the tests.
 */
export const EAGER_CAP = 200;
export const EAGER_CAP_TRIAL = 20;
export const DEBOUNCE_SEC = 240;
export const RECOMPUTE_LIMIT_SEC = 600;

// ── Progress (rct-b §4.4, W1) ───────────────────────────────────────────────────────────────────────────────────
export const PROGRESS_STEP_PCT = 5;
export const PROGRESS_MIN_MS = 10_000;
export const STALLED_MS = 600_000;
/** The ETA's constant overhead (the recompute itself), seconds. */
export const ETA_OVERHEAD_SEC = 5;
/** Fallback seconds per analysed game when no worker estimate exists (env ANALYSIS_SECONDS_PER_GAME). */
export const DEFAULT_SECONDS_PER_GAME = 45;
/** Progress weights of the four steps (import, grade, patterns, compare). */
export const PROGRESS_WEIGHTS = { import: 0.15, grade: 0.7, patterns: 0.1, compare: 0.05 } as const;

// ── Retention ───────────────────────────────────────────────────────────────────────────────────────────────────
export const KEEP_WEEKS = 12;

// ── Openings (rct-b W1) ─────────────────────────────────────────────────────────────────────────────────────────
export const OPENINGS_MIN_GAMES = 3;
export const OPENINGS_ROWS = 4;
export const BEST_SCORE_MIN_GAMES = 10;
export const MOST_PLAYED_MIN_GAMES = 5;

// ── Strengths (R-WEAK; design copy) ─────────────────────────────────────────────────────────────────────────────
/** +300 cp (Win% 75.1): STATS_V1 slot 27, the codec's threshold. */
export { STATS_V1_REACHED_CP as CONVERSION_CP } from "@repo/chess-analysis/codec";
export const CONVERSION_MIN_REACHED = 5;
export const CONVERSION_MIN_RATE = 0.8;
/** Conversion looks at the newest this many analysed games. */
export const CONVERSION_GAMES = 30;
export const BOOK_EXIT_EQUAL_WIN = 45;
export const BOOK_EXIT_MIN_GAMES = 10;
export const BOOK_EXIT_MIN_SHARE = 0.7;
/** A strength must also beat the band by this much (conversion, book exit). */
export const STRENGTH_BAND_MARGIN = 0.05;
export const PHASE_STRENGTH_DELTA = 3;
export const PHASE_SENTENCE_DELTA = 2;
export const STRENGTHS_MAX = 2;

// ── Phase accuracy (R-ACC-02) ───────────────────────────────────────────────────────────────────────────────────
/** A game's phase counts in the weighted mean from this many of the member's moves in it. */
export const PHASE_MIN_MOVES_GAME = 3;
/** The phase shows a number from this many moves in all ("—" below). */
export const PHASE_MIN_MOVES = 60;

// ── Headline (§8.17) ────────────────────────────────────────────────────────────────────────────────────────────
/**
 * The clock clause (FIX-1, D-P6-FIX1-4; replaces the plan's "40 % of top's events, or time pressure is another row"): the top row's rate per move under a minute must be at least this multiple of its rate with more time (FIX-1,
 * D-P6-FIX1-4): "especially with under a minute" is said only of a pattern that is more frequent in time trouble.
 */
export const HEADLINE_CLOCK_RATIO = 1.5;
/** The clock clause needs at least this many of the top row's events under a minute. */
export const HEADLINE_CLOCK_MIN_EVENTS = 5;
