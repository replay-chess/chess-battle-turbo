// Constants of the training domain (phase-05 plan §8). One place, so a product change is a one-line edit with the
// tests that pin it. Browser-safe (no imports): the /grade, /labels and /items subpaths import from here.

// ── Training day and release (§8.4) ─────────────────────────────────────────────────────────────────────────────
/** A local training day starts at this hour (Anki-style rollover: 02:00 still belongs to yesterday). */
export const DEFAULT_DAY_START_HOUR = 4;
/** New and reviewed BANK cards come back at this local hour ("tomorrow at 08:00"). */
export const DEFAULT_RELEASE_HOUR = 8;
/** The zone used when a member has none (P4 `User.timeZone` default). */
export const DEFAULT_TIME_ZONE = "UTC";

// ── Caps (§8.5) ─────────────────────────────────────────────────────────────────────────────────────────────────
/** BANK reviews counted per local day (settings range 5–30, P10). */
export const DEFAULT_BANK_DAILY_CAP = 10;
/** NEW BANK cards introduced per local day, inside the cap. */
export const DEFAULT_NEW_PER_DAY = 5;
/** An attempt reschedules a card that is due up to this long after `reviewedAt` (the "once a day" rule). */
export const DUE_GRACE_MS = 60 * 60 * 1000;
/** Daily fair use on puzzles (`TRAIN_PUZZLES_DAILY_LIMIT` overrides it on the server). */
export const PUZZLES_DAILY_LIMIT = 400;

// ── Sessions (§8.6) ─────────────────────────────────────────────────────────────────────────────────────────────
/** Most items a built BANK session holds (before Again re-queues). */
export const BANK_SESSION_MAX = 20;
/** A PUZZLES batch (create and each extend). */
export const PUZZLE_BATCH = 10;
/** Puzzles in the daily plan's puzzle step. */
export const PLAN_PUZZLE_COUNT = 3;
/** At most this share of a puzzle batch is due PUZZLE-deck cards (every third slot). */
export const PUZZLE_DUE_SHARE = 0.3;
/** Due puzzle cards sit at every `PUZZLE_DUE_EVERY`-th slot (indices 2, 5, 8 …). */
export const PUZZLE_DUE_EVERY = 3;
/** Rating window of new puzzles: [R − below, R + above], widened by `PUZZLE_WIDEN_STEP` per step. */
export const PUZZLE_WINDOW_BELOW = 100;
export const PUZZLE_WINDOW_ABOVE = 150;
export const PUZZLE_WIDEN_STEP = 100;
/** Widening steps tried on the theme before falling back to `mix`. */
export const PUZZLE_MAX_WIDEN_STEPS = 4;
/** Widen until at least this many candidates remain (§7.3 W2). */
export const PUZZLE_MIN_CANDIDATES = 15;
/** Puzzles attempted in the last N days are not served again. */
export const PUZZLE_EXCLUDE_DAYS = 90;
/** Shard bands are `floor(rating / 100)` within these bounds (shards hold 600–2599). */
export const PUZZLE_BAND_MIN = 6;
export const PUZZLE_BAND_MAX = 25;
/** The theme the shards use for "any theme" and the fallback when a theme has too few puzzles. */
export const MIX_THEME = "mix";
/** An item graded AGAIN on pass 1 comes back this many slots later (or at the end). */
export const REQUEUE_OFFSET = 4;
/**
 * The most items a session holds, pass-2 copies included (`SessionItemsV1`, `SessionPayload.items`). A puzzle stream
 * that reaches it ends there (W3 adds no more; the summary offers the next set), and an Again on a full list schedules
 * the card but queues no pass-2 copy (the server and the client apply the same rule, FIX-1 stream-40).
 */
export const SESSION_ITEMS_MAX = 40;
/** The Again learning step: the pass-2 copy's previews are computed at `now + AGAIN_STEP_MINUTES`. */
export const AGAIN_STEP_MINUTES = 10;

// ── Time estimates (§8.6) ───────────────────────────────────────────────────────────────────────────────────────
export const MIN_PER_BANK_ITEM = 0.75;
export const MIN_PER_PUZZLE = 1.3;
export const MIN_PER_WEAKNESS_ITEM = 0.5;

// ── Grades (§8.3) ───────────────────────────────────────────────────────────────────────────────────────────────
/** `autoGrade` (no UI in P5) applies the suggested grade after this delay. */
export const AUTO_GRADE_DELAY_MS = 600;
/** Hint steps: 1 = the ring on the piece, 2 = the arrow. */
export const MAX_HINT_STEPS = 2;

// ── Mastery (§8.8) ──────────────────────────────────────────────────────────────────────────────────────────────
/** Card mastery dots by stability (days): < 4 → 1, < 10 → 2, < 30 → 3, < 90 → 4, else 5. */
export const MASTERY_STABILITY_BOUNDS = [4, 10, 30, 90] as const;
/** EWMA weight of the newest attempt in a theme. */
export const THEME_EWMA_ALPHA = 0.15;
/** A theme's percentage is shown from this many attempts ("New" below). */
export const THEME_MIN_ATTEMPTS = 5;
export const THEME_MILESTONES = [50, 70, 90] as const;

// ── Day streak (§8.9, D-4) ──────────────────────────────────────────────────────────────────────────────────────
/** A gap of up to this many days keeps the streak (one missed day is forgiven: "resets if you skip 2 days"). */
export const STREAK_MAX_GAP_DAYS = 2;

// ── Puzzle rating (§8.7, D-3) ───────────────────────────────────────────────────────────────────────────────────
export const PUZZLE_SEED_OFFSET = 300;
export const PUZZLE_SEED_MIN = 800;
export const PUZZLE_SEED_MAX = 2200;
export const PUZZLE_SEED_DEFAULT = 1200;
export const PUZZLE_SEED_RD = 250;
export const PUZZLE_SEED_VOL = 0.06;
/** The puzzle side of a rating period: every puzzle is an opponent with this fixed RD. */
export const PUZZLE_OPPONENT_RD = 50;
/** "Provisional" while the member has fewer puzzle attempts than this. */
export const PROVISIONAL_ATTEMPTS = 20;

// ── Daily plan (§8.10) ──────────────────────────────────────────────────────────────────────────────────────────
/** The focus theme when nothing else picks one. */
export const DEFAULT_FOCUS_THEME = "fork";
/** Plan step hrefs (§4.2): a page that creates or resumes a session (never prefetched). */
export const PLAN_BANK_HREF = "/train/bank/session?plan=1";
export const IMPORT_HREF = "/settings/connected";
