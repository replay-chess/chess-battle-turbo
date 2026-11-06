// Protocol v2 limits and timing constants (phase-02 plan §7.4.1, §7.4.4, §7.4.8, §8.20, §9.4).
// The game-rule constants mirror PKG/game-core/src/constants.ts; game-core owns them and its constants test asserts
// that both files agree. Contracts never imports game-core (it is the leaf package), so the values are repeated here
// for the socket server, the web client and the size tests.

/** `auth.proto` a v2 client sends in the handshake. */
export const PROTOCOL_VERSION = 2 as const;

// ── Game rules (mirrors of game-core §8.20) ─────────────────────────────────────────────────────────────────────
export const STUDY_SECONDS_NON_INITIAL = 30;
export const FIRST_MOVE_MS = 30_000;
export const GRACE_MS = 30_000;
/** Grace after ≥ GRACE_FLAPPING_DETACHES detaches within GRACE_FLAPPING_WINDOW_MS. */
export const GRACE_FLAPPING_MS = 10_000;
export const GRACE_FLAPPING_DETACHES = 3;
export const GRACE_FLAPPING_WINDOW_MS = 120_000;
export const DRAW_COOLDOWN_PLIES = 4;
export const REMATCH_MS = 30_000;
export const REMATCH_MAX_OFFERS = 3;
export const POST_GAME_RETENTION_MS = 60_000;
export const WAITING_RETENTION_MS = 600_000;
export const RESUME_MAX_WAIT_MS = 60_000;
export const LAG_CREDIT_MAX_MS = 250;
/** Lag credit over a whole game is capped at this share of the initial time. */
export const LAG_CREDIT_GAME_CAP_RATIO = 0.05;
export const PREMOVE_MIN_SPEND_MS = 100;
export const FLAG_TIMER_SLACK_MS = 20;
export const CHECKPOINT_PLIES = 10;
export const CHECKPOINT_MAX_AGE_MS = 15_000;
export const RESTORE_WINDOW_MS = 2 * 60 * 60 * 1000;
/** A live game with < 2 plies is stale after 30 min; with ≥ 2 plies after STALE_LIVE_PLAYED_MS. */
export const STALE_LIVE_MS = 30 * 60 * 1000;
export const STALE_LIVE_PLAYED_MS = 2 * 60 * 60 * 1000;
export const STALE_BOT_DAYS = 7;
export const LOW_TIME_MS = 10_000;
export const AMBER_MS = 60_000;
export const RED_MS = 20_000;

// ── Transport (§7.4.1) ──────────────────────────────────────────────────────────────────────────────────────────
export const PING_INTERVAL_MS = 10_000;
export const PING_TIMEOUT_MS = 8_000;
export const CLIENT_PING_EVERY_MS = 10_000;
/** Client-side timeout of every acked command. */
export const ACK_TIMEOUT_MS = 5_000;
export const RELOAD_BUTTON_AFTER_MS = 25_000;
/** socket.io `maxHttpBufferSize`: the largest inbound frame. */
export const MAX_HTTP_BUFFER_BYTES = 16 * 1024;
/** `clock:sync` drift check while playing (never every second). */
export const CLOCK_SYNC_EVERY_MS = 15_000;
/** `spectators:update` is sent at most once per this interval per game. */
export const SPECTATORS_UPDATE_MIN_MS = 5_000;
/** Server-side cap of a `live:list` answer. */
export const LIVE_LIST_MAX = 20;

// ── Abuse limits (§7.4.1 step 1, §7.4.8) ────────────────────────────────────────────────────────────────────────
export const SOCKETS_PER_USER = 10;
export const HANDSHAKES_PER_USER_PER_MIN = 20;
export const SOCKETS_PER_IP = 500;
export const HANDSHAKES_PER_IP_PER_MIN = 300;
/** The per-IP guard is off for this long after boot (every tab reconnects in the restore window). */
export const IP_GUARD_BOOT_GRACE_MS = 120_000;
/** One token bucket for all commands of a socket together. */
export const COMMAND_BUCKET = { burst: 20, perSecond: 10 } as const;
/** Sustained flooding for this long disconnects the socket. */
export const FLOOD_DISCONNECT_MS = 5_000;
/** Recorded in `meta` for P9's queue ban: this many aborts within the window. */
export const ABORT_ABUSE = { count: 3, windowMs: 10 * 60 * 1000 } as const;

// ── Sizes ───────────────────────────────────────────────────────────────────────────────────────────────────────
/** Longest game a v2 payload carries (plies). Far above any real game; it bounds `moves` and `clocksMs`. */
export const MAX_GAME_PLIES = 1_200;
/** Longest prefix (SAN moves before the start position) of a legend or opening start. */
export const MAX_PREFIX_PLIES = 400;
export const DISPLAY_NAME_MAX = 40;
/** A client-chosen move id (`game:move.clientMoveId`), echoed in the ack only. Kept short for MoveAck's budget. */
export const CLIENT_MOVE_ID_MAX = 16;
/** Socket token string length cap (checked before any parse). */
export const SOCKET_TOKEN_MAX_CHARS = 1_024;
/** Socket token lifetime (§7.1.7). The verifier refuses longer-lived tokens. */
export const SOCKET_TOKEN_TTL_SEC = 15 * 60;
/** Accepted clock skew between the minting web server and the socket server. */
export const SOCKET_TOKEN_SKEW_SEC = 60;

/**
 * Serialised payload budgets in bytes (§7.4.6, §9.4, asserted by test/size.test.ts with realistic fixtures).
 * Events not listed in EVENT_BUDGET_BYTES use DEFAULT_EVENT_BUDGET.
 *
 * Measured, not guessed (WP-C hand-back; plan clarification for the owner): the plan's 2 KB GameState target does
 * not hold with realistic data. At 80 plies a GameState is 2,055 B with no avatar URLs and ≈ 2.4 KB with two real
 * 176-character Clerk avatar URLs; the Opera legend start plus 80 plies is ≈ 2.7 KB. The enforced ceiling is 3 KB.
 * A `move:applied` with all three flags, a 3-digit ply and seq and a 7-character SAN is 208 B (ceiling 224 B).
 */
export const GAME_STATE_BUDGET = 3_072;
export const MOVE_APPLIED_BUDGET = 224;
export const MOVE_ACK_BUDGET = 160;
export const DEFAULT_EVENT_BUDGET = 120;
/**
 * Events whose plan-mandated fields cannot fit 120 B with a 25-character ref and 13-digit epoch-ms times
 * (recorded as a plan clarification in the WP-C hand-back): `game:phase` and `clock:sync` carry `clocks`,
 * `game:ended` carries the final FEN, `rematch:started` carries three refs.
 */
export const EVENT_BUDGET_BYTES: Readonly<Record<string, number>> = {
  "game:snapshot": GAME_STATE_BUDGET,
  "move:applied": MOVE_APPLIED_BUDGET,
  "game:phase": 220,
  "clock:sync": 160,
  "game:ended": 320,
  "rematch:started": 200,
  "game:error": 260,
};

export function eventBudget(event: string): number {
  return EVENT_BUDGET_BYTES[event] ?? DEFAULT_EVENT_BUDGET;
}

// ── /internal/* (§7.5) ──────────────────────────────────────────────────────────────────────────────────────────
export const EMIT_MAX_TARGETS = 50;
/** `/internal/emit` `dedupeKey` memory. */
export const EMIT_DEDUPE_TTL_MS = 60_000;
/** Body cap Caddy enforces on `/internal/*`. */
export const INTERNAL_BODY_MAX_BYTES = 64 * 1024;
export const BROADCAST_NOTICE_MIN_S = 5;
export const BROADCAST_NOTICE_MAX_S = 600;
