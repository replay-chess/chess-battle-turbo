// Phase-02 plan 8.20. Mirrored in @repo/contracts/socket/limits (WP-C); a test there compares the two.
// Values the socket may scale for tests (TIMING_PROFILE=fast) are read through MachineConfig, never directly.

export const INITIAL_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

/** Study phase length when the start position is not the initial one (owner Q1). */
export const STUDY_SECONDS_NON_INITIAL = 30;
/** Window for each side's first move; no move → aborted. */
export const FIRST_MOVE_MS = 30_000;
/** Reconnect grace for a disconnected player (only while the opponent is online). */
export const GRACE_MS = 30_000;
/** Grace for a flapping player (≥ GRACE_FLAPPING_DETACHES detaches within GRACE_FLAPPING_WINDOW_MS). */
export const GRACE_FLAPPING_MS = 10_000;
export const GRACE_FLAPPING_DETACHES = 3;
export const GRACE_FLAPPING_WINDOW_MS = 120_000;
/** After a decline (explicit or by moving) the offerer may offer again at plyCount + this. */
export const DRAW_COOLDOWN_PLIES = 4;
export const REMATCH_MS = 30_000;
export const REMATCH_MAX_OFFERS = 3;
export const POST_GAME_RETENTION_MS = 60_000;
export const WAITING_RETENTION_MS = 600_000;
export const RESUME_MAX_WAIT_MS = 60_000;
export const LAG_CREDIT_MAX_MS = 250;
/** Total lag credit per side per game, as a share of the initial time. */
export const LAG_CREDIT_GAME_CAP_RATIO = 0.05;
export const PREMOVE_MIN_SPEND_MS = 100;
export const FLAG_TIMER_SLACK_MS = 20;
export const CHECKPOINT_PLIES = 10;
export const CHECKPOINT_MAX_AGE_MS = 15_000;
export const RESTORE_WINDOW_MS = 2 * 60 * 60 * 1000;
/** Stale live games (owner Q7): abort after 30 min with < 2 plies; abandon after 2 h with ≥ 2 plies. */
export const STALE_LIVE_MS = 30 * 60 * 1000;
export const STALE_LIVE_PLAYED_MS = 2 * 60 * 60 * 1000;
export const STALE_BOT_DAYS = 7;
export const PING_INTERVAL_MS = 10_000;
export const PING_TIMEOUT_MS = 8_000;
export const CLIENT_PING_EVERY_MS = 10_000;
export const ACK_TIMEOUT_MS = 5_000;
export const RELOAD_BUTTON_AFTER_MS = 25_000;
/** Below this the running clock shows tenths and the `low_time` modifier is on. */
export const LOW_TIME_MS = 10_000;
export const AMBER_MS = 60_000;
export const RED_MS = 20_000;
export const SLIDE_MS = 180;
export const CAPTURE_FADE_MS = 120;
export const DRAG_THRESHOLD_PX = 4;
export const DRAG_SCALE = 1.06;

/** Starting value of the per-side RTT EWMA and its smoothing factor (plan 8.4). */
export const RTT_START_MS = 150;
export const RTT_ALPHA = 0.2;
/** `study_last5`: the countdown is enlarged when ≤ 5 s remain. */
export const STUDY_LAST_MS = 5_000;
/** A game that ended longer ago than this is `already_ended` on arrival (plan 5.1); sooner, the result card shows. */
export const ALREADY_ENDED_AFTER_MS = 120_000;
/** Server sync failures before the store enters `server_error`. */
export const SYNC_FAILURES_FOR_ERROR = 3;
/** Clock-ack dedupe window: the last N move acks are kept per game. */
export const MOVE_ACK_MEMORY = 16;
/** Bot games: hint search and arrow colour (plan 8.14). */
export const HINT_ARROW_COLOR = "#0369a1";
export const HINT_MOVETIME_MS = 300;
/** Bot draw policy (plan 8.15, owner Q11). */
export const BOT_DRAW_MIN_PLIES = 60;
export const BOT_DRAW_MAX_EVAL_CP = 30;
export const BOT_DRAW_MIN_OFFER_PLIES = 2;
export const BOT_DRAW_EVAL_NODES = 20_000;
/** Bot search cap on slow devices (plan 8.13). */
export const BOT_STOP_AFTER_MS = 3_000;
/** Journal key prefix for bot games in localStorage (plan 5.3.2). */
export const BOT_JOURNAL_PREFIX = "rc:bot:";
/** Spectator "watching" events are throttled to one per this interval by the socket. */
export const SPECTATORS_UPDATE_MIN_MS = 5_000;
/** Clock drift check while playing. */
export const CLOCK_SYNC_EVERY_MS = 15_000;
/** Adjudication: tolerance for a clock that grew by more than the increment. */
export const ADJUDICATE_CLOCK_TOLERANCE_MS = 50;
/** Adjudication: a claimed timeout must end with less than this on the flagging side. */
export const ADJUDICATE_TIMEOUT_MAX_MS = 1_000;
/** Bot checkpoint / complete guards (plan 7.1.3): rev gap and the longest move list accepted. */
export const CHECKPOINT_MAX_REV_GAP = 64;
export const BOT_CHECKPOINT_MAX_MOVES = 400;
