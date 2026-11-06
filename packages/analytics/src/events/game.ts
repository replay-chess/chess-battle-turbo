// Game client events (phase-02 plan §10.1) wired in P2: the engine (`engine_init`, `hint_used`, `undo_used`, sent
// by `trackEngineEvent()` in apps/web/features/engine/EngineProvider.tsx) and the game screen (`trackGame()` in
// apps/web/lib/analytics/game-events.ts). Closed property sets: no FEN, PGN, move text or refs. The socket's
// server events (`game_started`, `game_ended`, `game_aborted`, `rematch_expired`) are `gameSocketEvents` below. The
// screen's lifecycle and action events (game_viewed … shortcut_used) are sent by apps/web/features/game/telemetry.ts
// from the store's transitions (FIX-A: they were neither registered nor sent).
import { z } from "zod";

export const GAME_OVER_CTAS = ["rematch", "new_game", "analyse", "watch_another", "back_to_tournament", "restart"] as const;

export const END_METHODS = [
  "checkmate",
  "resignation",
  "timeout",
  "timeout_vs_insufficient",
  "stalemate",
  "threefold",
  "fifty_move",
  "insufficient_material",
  "agreement",
  "abandoned",
] as const;

export const GAME_PHASES = ["waiting", "study", "first_move", "playing", "ended"] as const;
/** A snake_case code (socket error codes, illegal reasons); never free text. */
const CODE = z.string().regex(/^[a-z][a-z0-9_]{0,39}$/);
const PLY = z.number().int().min(0).max(10_000);

export const gameClientEvents = {
  engine_init: z
    .object({
      ok: z.boolean(),
      cached: z.boolean(),
      ms: z.number().int().min(0).max(600_000),
      elo_floor: z.number().int().min(0).max(4_000).nullable(),
      source: z.enum(["r2", "origin"]),
    })
    .strict(),
  hint_used: z.object({ level: z.union([z.literal(1), z.literal(2)]) }).strict(),
  undo_used: z.object({}).strict(),
  game_over_cta: z.object({ cta: z.enum(GAME_OVER_CTAS) }).strict(),
  share_game: z.object({ method: z.enum(["link", "pgn"]) }).strict(),
  flip_board: z.object({ on: z.boolean() }).strict(),
  sound_toggled: z.object({ on: z.boolean() }).strict(),
  game_viewed: z
    .object({
      role: z.enum(["player", "spectator"]),
      entry: z.enum(["create", "link", "rematch", "resume", "reload"]),
      phase: z.enum(GAME_PHASES),
    })
    .strict(),
  /** Sampled 20 %. `ms_to_join_ack` is null for bot games (no socket). */
  game_board_ready: z
    .object({ ms_to_board: z.number().int().min(0).max(600_000), ms_to_join_ack: z.number().int().min(0).max(600_000).nullable() })
    .strict(),
  move_rejected: z.object({ code: CODE }).strict(),
  /** Sampled 10 %. `reason`: game-core IllegalReason (plan 8.17). */
  illegal_move: z.object({ reason: CODE }).strict(),
  /** Sampled 10 %. */
  premove_set: z.object({}).strict(),
  premove_dropped: z.object({ reason: z.enum(["illegal", "cancelled"]) }).strict(),
  promotion_picked: z.object({ piece: z.enum(["q", "r", "b", "n"]) }).strict(),
  /** `implicit`: the offer crossed the opponent's (an accept). */
  draw_offered: z.object({ implicit: z.boolean() }).strict(),
  draw_answered: z.object({ accepted: z.boolean() }).strict(),
  resign_opened: z.object({ ply: PLY }).strict(),
  resign_confirmed: z.object({ ply: PLY }).strict(),
  resign_cancelled: z.object({ ply: PLY }).strict(),
  rematch_offered: z.object({}).strict(),
  rematch_answered: z.object({ accepted: z.boolean() }).strict(),
  reconnect: z
    .object({
      duration_ms: z.number().int().min(0),
      success: z.boolean(),
      cause: z.enum(["offline", "ping", "server_restart"]),
    })
    .strict(),
  server_restart_notice_shown: z.object({ in_game: z.boolean() }).strict(),
  in_game_auth_refresh: z.object({ result: z.enum(["ok", "failed"]) }).strict(),
  game_server_error: z.object({ code: CODE }).strict(),
  /** `result` from the viewer's side; spectators send `watched`. */
  game_over_viewed: z
    .object({
      method: z.enum([...END_METHODS, "aborted"]),
      result: z.enum(["win", "loss", "draw", "aborted", "watched"]),
    })
    .strict(),
  spectate_started: z.object({ source: z.enum(["link", "live_list"]) }).strict(),
  spectate_left: z.object({ duration_ms: z.number().int().min(0) }).strict(),
  /** Sampled 10 %. */
  shortcut_used: z.object({ key: z.string().regex(/^[a-z0-9_]{1,16}$/i) }).strict(),
} as const;

/**
 * Server events sent by the web app (posthog-node inside `after()`, `distinct_id` = the viewer's ref):
 * `bot_game_started` from POST /api/games, `bot_game_completed` from POST /api/games/[ref]/complete (first
 * completion only, never on an idempotent replay).
 */
export const gameServerEvents = {
  bot_game_started: z
    .object({
      elo: z.number().int().min(400).max(3_200),
      color: z.enum(["w", "b"]),
      start_kind: z.enum(["initial", "random_position", "legend", "position", "opening", "parent"]),
      reason: z.enum(["new", "rematch", "restart"]),
    })
    .strict(),
  bot_game_completed: z
    .object({
      result: z.enum(["win", "loss", "draw", "aborted"]),
      // EndMethod of @repo/contracts/socket/game (snake_case), or "aborted".
      method: z.string().regex(/^[a-z][a-z_]{0,31}$/),
      plies: z.number().int().min(0).max(10_000),
      hints: z.number().int().min(0).max(10_000),
      undos: z.number().int().min(0).max(10_000),
    })
    .strict(),
} as const;

/**
 * Socket server events (apps/web-socket, posthog-node; plan 10.1): the game-core reducer's `track` effects, sent once
 * per player with `distinct_id` = the user ref. `LiveSession.trackProps()` adds `mode` and `time_class` (and the
 * common `app_env`) to each.
 * regression: REGRESSION-2 — they were sent but unregistered, so the e2e telemetry audit failed every live game spec.
 */
const socketCommon = {
  mode: z.enum(["bot", "friend", "online", "tournament"]),
  time_class: z.enum(["bullet", "blitz", "rapid", "classical", "untimed"]),
};


export const gameSocketEvents = {
  game_started: z
    .object({
      ...socketCommon,
      rated: z.boolean(),
      // "<minutes>+<increment s>" or "untimed".
      tc: z.string().regex(/^(\d+(\.\d+)?\+\d+(\.\d+)?|untimed)$/),
      study_s: z.number().int().min(0).max(600),
      start: z.enum(["initial", "position", "opening"]),
    })
    .strict(),
  game_ended: z
    .object({
      ...socketCommon,
      method: z.enum(END_METHODS),
      result: z.enum(["win", "loss", "draw"]),
      plies: z.number().int().min(0).max(10_000),
      duration_ms: z.number().int().min(0),
      draw_offers: z.number().int().min(0).max(1_000),
      premoves: z.number().int().min(0).max(10_000),
    })
    .strict(),
  game_aborted: z
    .object({
      ...socketCommon,
      reason: z.enum(["timeout", "player", "stale"]),
      by: z.enum(["self", "opponent"]),
    })
    .strict(),
  rematch_expired: z
    .object({
      ...socketCommon,
      reason: z.enum(["timeout", "left"]),
    })
    .strict(),
} as const;

export const gameEvents = { ...gameClientEvents, ...gameServerEvents, ...gameSocketEvents } as const;
