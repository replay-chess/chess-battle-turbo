// Game screen telemetry (phase-02 plan §10.1). The store's transitions decide most events, so one observer covers
// the live, bot and demo controllers (trackGame drops `/dev/**` routes): every `dispatch` hands it the previous and
// next ClientGame, the action and the reducer's outs. Lifecycle events (game_viewed, game_board_ready,
// spectate_started / _left) come from the controllers and the board. Properties never carry FEN, PGN, refs or move
// text. regression: FIX-A — these events were neither registered nor sent.

import { absPly, type ClientAction, type ClientGame, type Out } from "@repo/game-core/client/reducer";
import type { GameState } from "@repo/game-core/machine/types";
import { trackGame } from "@/lib/analytics/game-events";

/** Sampled events (plan §10.1); every event is kept in the e2e test app so the specs can assert them. */
function sampled(rate: number): boolean {
  if (process.env.NEXT_PUBLIC_APP_ENV === "test") return true;
  return Math.random() < rate;
}

const sent = (out: readonly Out[], cmd: string) => out.some((o) => o.type === "send" && o.cmd === cmd);
const PIECES = new Set(["q", "r", "b", "n"]);
const CODE = /^[a-z][a-z0-9_]{0,39}$/;
const code = (v: unknown, fallback: string) => (typeof v === "string" && CODE.test(v) ? v : fallback);
const inGame = (s: GameState) => s.phase === "study" || s.phase === "first_move" || s.phase === "playing";

/** The game_over_viewed props for the viewer of an ended state. */
function overProps(s: GameState) {
  const r = s.result;
  if (!r) return null;
  const method = r.method;
  if (method === "aborted") return { method, result: "aborted" as const };
  if (s.you.role !== "player" || !s.you.color) return { method, result: "watched" as const };
  const result = r.winner === null ? ("draw" as const) : r.winner === s.you.color ? ("win" as const) : ("loss" as const);
  return { method, result };
}

/** Games whose socket is in an in-game auth refresh (refused as unauthorized, not live again yet). */
const authRefresh = new Set<string>();

export function observeTransition(
  prev: ClientGame,
  next: ClientGame,
  action: ClientAction,
  out: readonly Out[],
  now: number = Date.now(),
): void {
  try {
    const ply = absPly(next.state);
    switch (action.type) {
      case "moveAck":
        if (!action.ack.ok) trackGame("move_rejected", { code: code(action.ack.code, "rejected") });
        break;
      case "move":
        // A move made while the promotion picker was open is the pick.
        if (prev.promotion && action.uci.length === 5 && PIECES.has(action.uci[4]!)) {
          trackGame("promotion_picked", { piece: action.uci[4] as "q" | "r" | "b" | "n" });
        }
        break;
      case "drawOffer":
        if (sent(out, "draw:offer")) trackGame("draw_offered", { implicit: prev.state.drawOffer !== null });
        break;
      case "drawAnswer":
        if (sent(out, action.accept ? "draw:accept" : "draw:decline")) trackGame("draw_answered", { accepted: action.accept });
        break;
      case "resign":
        if (action.open && !prev.resignOpen) trackGame("resign_opened", { ply });
        else if (!action.open && prev.resignOpen) trackGame("resign_cancelled", { ply });
        break;
      case "confirmResign":
        if (sent(out, "game:resign")) trackGame("resign_confirmed", { ply });
        break;
      case "rematchOffer":
        if (sent(out, "rematch:offer")) trackGame("rematch_offered", {});
        break;
      case "rematchAnswer":
        if (sent(out, action.accept ? "rematch:accept" : "rematch:decline")) {
          trackGame("rematch_answered", { accepted: action.accept });
        }
        break;
      default:
        break;
    }

    // Toast-led events.
    if (next.toast && next.toast !== prev.toast) {
      if (next.toast.code === "illegal" && sampled(0.1)) {
        trackGame("illegal_move", { reason: code(next.toast.params?.reason, "fallback") });
      }
    }

    // Premoves.
    if (next.premove && !prev.premove && sampled(0.1)) trackGame("premove_set", {});
    if (prev.premove && !next.premove && next.toast?.code === "premove_cancelled" && next.toast !== prev.toast) {
      trackGame("premove_dropped", { reason: next.toast.params?.reason === "illegal" ? "illegal" : "cancelled" });
    }

    // Connection. An in-game auth refresh starts when the socket is refused as unauthorized and ends when it is live
    // again (possibly through connecting/reconnecting), or fails when the store gives up (server_error).
    if (next.restarting && !prev.restarting) trackGame("server_restart_notice_shown", { in_game: inGame(next.state) });
    if (next.conn === "unauthorized" && prev.conn !== "unauthorized") authRefresh.add(next.state.ref);
    if (next.conn === "live" && prev.conn !== "live") {
      if (authRefresh.delete(next.state.ref)) trackGame("in_game_auth_refresh", { result: "ok" });
      else if (prev.disconnectedAt !== null && prev.conn !== "connecting") {
        const cause = prev.restarting ? "server_restart" : prev.conn === "offline" ? "offline" : "ping";
        trackGame("reconnect", { duration_ms: Math.max(0, now - prev.disconnectedAt), success: true, cause });
      }
    }
    if (next.serverError && !prev.serverError && authRefresh.delete(next.state.ref)) {
      trackGame("in_game_auth_refresh", { result: "failed" });
    }
    if (next.serverError && !prev.serverError) {
      trackGame("game_server_error", { code: "sync_failed" });
      if (prev.disconnectedAt !== null) {
        trackGame("reconnect", { duration_ms: Math.max(0, now - prev.disconnectedAt), success: false, cause: "ping" });
      }
    }

    // The end, seen in this view.
    if (prev.state.phase !== "ended" && next.state.phase === "ended") {
      const props = overProps(next.state);
      if (props) trackGame("game_over_viewed", props);
    }
  } catch {
    // Telemetry never breaks the game.
  }
}

// ── lifecycle ──

/** Board-ready marks of the game on screen (module state survives client navigations, so it is keyed by ref). */
let ready: { ref: string; boardAt: number | null; joinAckAt: number | null; done: boolean } = {
  ref: "",
  boardAt: null,
  joinAckAt: null,
  done: false,
};

function marksFor(ref: string) {
  if (ready.ref !== ref) ready = { ref, boardAt: null, joinAckAt: null, done: false };
  return ready;
}

function maybeBoardReady(bot: boolean) {
  const r = ready;
  if (r.done || r.boardAt === null || (!bot && r.joinAckAt === null)) return;
  r.done = true;
  if (!sampled(0.2)) return;
  trackGame("game_board_ready", { ms_to_board: r.boardAt, ms_to_join_ack: bot ? null : r.joinAckAt });
}

/** The board painted for the first time on this page view (GameBoardArea's mount effect). */
export function markBoardPainted(ref: string, bot: boolean, at: number = performance.now()): void {
  const r = marksFor(ref);
  if (r.boardAt !== null) return;
  r.boardAt = Math.round(at); // performance.now() counts from the navigation start
  maybeBoardReady(bot);
}

/** The socket's join ack arrived (live games). */
export function markJoinAck(ref: string, at: number = performance.now()): void {
  const r = marksFor(ref);
  if (r.joinAckAt !== null) return;
  r.joinAckAt = Math.round(at);
  maybeBoardReady(false);
}

function entryOf(s: GameState, acceptedRematch: boolean): "create" | "link" | "rematch" | "resume" | "reload" {
  try {
    const nav = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
    if (nav?.type === "reload") return "reload";
  } catch {
    // older browsers
  }
  if (s.rematchOf && (acceptedRematch || s.phase === "waiting" || s.phase === "study")) return "rematch";
  if (s.you.role === "player" && (s.phase === "playing" || s.phase === "first_move")) return "resume";
  if (s.you.role === "player" && s.phase === "waiting" && !s.players.w.ref !== !s.players.b.ref) {
    // The creator alone in the seat list; the friend arrives through the link.
    const mine = s.you.color ? s.players[s.you.color].ref : null;
    if (mine && typeof document !== "undefined" && /\/(play|challenge)/.test(document.referrer)) return "create";
  }
  return "link";
}

/** Once per page view (the controller's first attach). */
export function trackGameViewed(s: GameState, acceptedRematch = false): void {
  if (typeof window === "undefined") return;
  trackGame("game_viewed", {
    role: s.you.role === "spectator" ? "spectator" : "player",
    entry: entryOf(s, acceptedRematch),
    phase: s.phase,
  });
  if (s.phase === "ended") {
    const props = overProps(s);
    if (props) trackGame("game_over_viewed", props);
  }
}

/** A spectator's join succeeded; returns the matching `spectate_left` sender. */
export function trackSpectateStarted(): () => void {
  const params = typeof window !== "undefined" ? new URLSearchParams(window.location.search) : null;
  trackGame("spectate_started", { source: params?.get("from") === "live" ? "live_list" : "link" });
  const t0 = Date.now();
  let left = false;
  return () => {
    if (left) return;
    left = true;
    trackGame("spectate_left", { duration_ms: Math.max(0, Date.now() - t0) });
  };
}

/** A keyboard shortcut of the game screen (sampled 10 %). */
export function trackShortcut(key: string): void {
  if (!sampled(0.1)) return;
  const k = key.toLowerCase().replace(/[^a-z0-9_]/g, "_").slice(0, 16) || "key";
  trackGame("shortcut_used", { key: k });
}
