// Client store reducer (plan 5.2, 4.3): protocol state from the socket plus local UI state, with optimistic moves,
// optimistic draw/rematch/ready (rolled back by a negative ack), one queued move while offline (outbox), one
// premove, and gap detection on `seq`. Pure: `reduceClient(store, action)` returns the next store and the
// side effects for the controller to run (`out`: socket commands, a sync request, a navigation).

import { ALREADY_ENDED_AFTER_MS, DRAW_COOLDOWN_PLIES, REMATCH_MS, SYNC_FAILURES_FOR_ERROR } from "../constants";
import { remaining } from "../clock/clock";
import { applyUci, isPromotionMove, parseUci, putChess, splitMoves, takeChess } from "../rules/chess";
import { explainIllegal, type IllegalReason } from "../rules/explainIllegal";
import type { Ack, AckError, GameState, MoveAck, ServerEvent, Side, SocketErrorCode } from "../machine/types";
import { otherSide } from "../machine/types";

export type ConnState =
  | "idle"
  | "connecting"
  | "live"
  | "reconnecting"
  | "offline"
  | "unauthorized"
  | "upgrade_required";

export type ToastKind = "good" | "warn" | "info" | "bad";
export type ToastCode =
  | "illegal"
  | "rejected"
  | "premove_set"
  | "premove_cancelled"
  | "draw_declined"
  | "draw_declined_self"
  | "draw_cooldown"
  | "rematch_declined"
  | "rematch_expired"
  | "rematch_accepted"
  | "rematch_paywall"
  | "opp_disconnected"
  | "opp_reconnected"
  | "reconnected"
  | "outbox_full"
  | "server_error"
  | "rate_limited"
  | "draining"
  | "took_back"
  | "engine_declined_draw"
  | "hint"
  // derived by viewState, never stored:
  | "already_ended"
  | "study_reconnect";

export interface Toast {
  code: ToastCode;
  kind: ToastKind;
  at: number;
  params?: Record<string, string | number>;
}

export const TOAST_KIND: Record<ToastCode, ToastKind> = {
  illegal: "bad",
  rejected: "bad",
  premove_set: "warn",
  premove_cancelled: "info",
  draw_declined: "info",
  draw_declined_self: "info",
  draw_cooldown: "info",
  rematch_declined: "info",
  rematch_expired: "info",
  rematch_accepted: "good",
  rematch_paywall: "info",
  opp_disconnected: "warn",
  opp_reconnected: "good",
  reconnected: "good",
  outbox_full: "warn",
  server_error: "bad",
  rate_limited: "info",
  draining: "info",
  took_back: "info",
  engine_declined_draw: "info",
  hint: "info",
  already_ended: "info",
  study_reconnect: "warn",
};

export interface QueuedMove {
  clientMoveId: string;
  uci: string;
  /** Absolute plies already played when the move was made (the move becomes ply + 1). */
  ply: number;
  san: string;
}

export interface BotView {
  thinking: boolean;
  hint: { level: 1 | 2; text: string; arrow: { from: string; to: string; color: string } | null } | null;
  engineError: boolean;
  otherTab: boolean;
  /** The engine files are still downloading (bytes so far / size, 0 = unknown): "loading", not an engine failure. */
  engineLoading?: { loaded: number; total: number } | null;
}

export interface ClientGame {
  state: GameState;
  /** False until the join/spectate ack (or a local game) replaced the RSC snapshot. */
  joined: boolean;
  conn: ConnState;
  /** When the connection last went down (null while live and after the rejoin). */
  disconnectedAt: number | null;
  lastServerMessageAt: number;
  restarting: { restartAt: number } | null;
  pending: QueuedMove | null;
  outbox: QueuedMove | null;
  premove: { uci: string; from: string; to: string } | null;
  needsSync: boolean;
  syncFailures: number;
  serverError: boolean;
  /** Absolute ply shown while browsing history (null = live). */
  view: number | null;
  flashBackToLive: boolean;
  selected: string | null;
  promotion: { from: string; to: string } | null;
  promotionCancelled: { square: string } | null;
  resignOpen: boolean;
  toast: Toast | null;
  /** The game ended while this store was live (vs `already_ended` when it was over on arrival). */
  sawEnd: boolean;
  alreadyEnded: boolean;
  rematchStarted: { newRef: string } | null;
  /** This viewer accepted the rematch that created this game (it, not the offerer, pressed Accept). */
  acceptedRematch: boolean;
  /** Rollback slots for optimistic commands. */
  optimistic: {
    draw?: { prev: GameState["drawOffer"] };
    drawAnswer?: { prev: GameState["drawOffer"] };
    rematch?: { prev: GameState["rematch"] };
    rematchAnswer?: { prev: GameState["rematch"] };
    ready?: true;
  };
  /** Board animation hint: false right after a snapshot replace (no slide storm). */
  animate: boolean;
  bot: BotView | null;
}

export type Command =
  | "game:move"
  | "game:sync"
  | "study:ready"
  | "game:abort"
  | "game:resign"
  | "draw:offer"
  | "draw:accept"
  | "draw:decline"
  | "rematch:offer"
  | "rematch:accept"
  | "rematch:decline"
  | "rematch:cancel";

export type Out =
  | { type: "send"; cmd: Command; payload: Record<string, unknown> }
  | { type: "sync" }
  /** `acceptedRematch`: this client accepted the rematch it navigates to (the new game shows no "X accepted" toast). */
  | { type: "navigate"; to: string; acceptedRematch?: true };

export type ClientAction =
  | { type: "replace"; state: GameState; reason: "join" | "sync" | "snapshot" | "local"; now: number }
  | { type: "event"; event: ServerEvent; now: number }
  | { type: "move"; uci: string; clientMoveId: string; now: number; serverNow: number }
  | { type: "moveAck"; clientMoveId: string; ack: Ack<Partial<MoveAck>>; now: number }
  | { type: "moveTimeout"; clientMoveId: string }
  | { type: "illegal"; from: string; to: string; now: number }
  | { type: "premove"; uci: string | null; now: number; reason?: "cancelled" }
  | { type: "conn"; conn: ConnState; now: number }
  | { type: "syncFailed"; now: number }
  | { type: "view"; ply: number | null }
  | { type: "select"; square: string | null }
  | { type: "promotion"; open: { from: string; to: string } | null; cancelled?: boolean }
  | { type: "resign"; open: boolean }
  | { type: "toastClear" }
  | { type: "toast"; code: ToastCode; now: number; params?: Record<string, string | number> }
  | { type: "drawOffer"; now: number }
  | { type: "drawAnswer"; accept: boolean; now: number }
  | { type: "rematchOffer"; now: number; serverNow: number }
  | { type: "rematchAnswer"; accept: boolean; now: number }
  | { type: "rematchCancel"; now: number }
  | { type: "ready"; now: number }
  | { type: "confirmResign"; now: number }
  | { type: "abort"; now: number }
  | { type: "cmdAck"; cmd: Command; ack: Ack<Record<string, unknown>>; now: number }
  | { type: "bot"; patch: Partial<BotView> };

export interface ClientResult {
  store: ClientGame;
  out: Out[];
}

export function createClientGame(
  state: GameState,
  opts: { joined?: boolean; conn?: ConnState; now?: number; bot?: boolean; acceptedRematch?: boolean } = {},
): ClientGame {
  return {
    state,
    joined: opts.joined ?? false,
    conn: opts.conn ?? "connecting",
    disconnectedAt: null,
    lastServerMessageAt: opts.now ?? 0,
    restarting: null,
    pending: null,
    outbox: null,
    premove: null,
    needsSync: false,
    syncFailures: 0,
    serverError: false,
    view: null,
    flashBackToLive: false,
    selected: null,
    promotion: null,
    promotionCancelled: null,
    resignOpen: false,
    toast: null,
    sawEnd: false,
    alreadyEnded: (opts.joined ?? false) && endedLongAgo(state, opts.now ?? 0),
    rematchStarted: null,
    acceptedRematch: opts.acceptedRematch ?? false,
    optimistic: {},
    animate: true,
    bot: opts.bot ? { thinking: false, hint: null, engineError: false, otherTab: false } : null,
  };
}

/** Ended before this page could have seen it (plan 5.1: endedAt older than 2 minutes, or no result time). */
export function endedLongAgo(state: GameState, now: number): boolean {
  if (state.phase !== "ended") return false;
  if (state.rematch) return false; // a live rematch offer means the players are still here
  const at = state.result?.endedAt;
  return at === undefined || now - at > ALREADY_ENDED_AFTER_MS;
}

const you = (g: ClientGame): Side | null => (g.state.you.role === "player" ? (g.state.you.color ?? null) : null);

/** The sticky "Premove set: …" toast ends with the premove it announced (fired, or dropped by a resync or disconnect): D10. */
function withoutPremoveToast(t: Toast | null): Toast | null {
  return t?.code === "premove_set" ? null : t;
}

function toast(code: ToastCode, now: number, params?: Record<string, string | number>): Toast {
  return params ? { code, kind: TOAST_KIND[code], at: now, params } : { code, kind: TOAST_KIND[code], at: now };
}

/** Applies a UCI move to a GameState (moves/fen/turn/inCheck); returns null when illegal. */
export function applyMoveToState(
  state: GameState,
  uci: string,
): { state: GameState; san: string; captured: boolean } | null {
  const moves = splitMoves(state.moves);
  const chess = takeChess(state.startFen, moves);
  const mv = applyUci(chess, uci);
  if (!mv) {
    putChess(state.startFen, moves, chess);
    return null;
  }
  const next = [...moves, `${mv.from}${mv.to}${mv.promotion ?? ""}`];
  putChess(state.startFen, next, chess);
  return {
    state: { ...state, moves: next.join(" "), fen: chess.fen(), turn: chess.turn(), inCheck: chess.inCheck() },
    san: mv.san,
    captured: !!mv.captured,
  };
}

/** Absolute ply (startPly + plies played): the wire value of `game:move.ply`, `move:applied.ply`, offers, views. */
export const absPly = (s: GameState) => s.startPly + splitMoves(s.moves).length;

function canMoveNow(s: GameState, side: Side | null): boolean {
  if (!side) return false;
  if (s.frozen) return false;
  if (s.phase === "first_move") return s.firstMove?.side === side;
  if (s.phase === "playing") return s.turn === side;
  return false;
}

export function reduceClient(g: ClientGame, a: ClientAction): ClientResult {
  const out: Out[] = [];
  const next = reduceInner(g, a, out);
  return { store: next, out };
}

function reduceInner(g: ClientGame, a: ClientAction, out: Out[]): ClientGame {
  switch (a.type) {
    case "replace":
      return replace(g, a.state, a.reason, a.now, out);
    case "event":
      return onEvent(g, a.event, a.now, out);
    case "move":
      return localMove(g, a.uci, a.clientMoveId, a.now, a.serverNow, out);
    case "moveAck":
      return moveAck(g, a.clientMoveId, a.ack, a.now, out);
    case "moveTimeout":
      if (g.pending?.clientMoveId === a.clientMoveId) out.push({ type: "sync" });
      return g;
    case "illegal": {
      const side = you(g);
      const names = { w: g.state.players.w.displayName, b: g.state.players.b.displayName };
      const ex = explainIllegal(g.state.fen, a.from, a.to, side ? { mover: side, names } : { names });
      // The full sentence ("That move isn’t legal: …", plan 4.3 #15); `text` alone dropped the opening words (FIX-A).
      return { ...g, toast: toast("illegal", a.now, { text: ex.toast, reason: ex.reason satisfies IllegalReason }) };
    }
    case "premove":
      return setPremove(g, a.uci, a.now, a.reason);
    case "conn":
      return onConn(g, a.conn, a.now);
    case "syncFailed": {
      const failures = g.syncFailures + 1;
      const serverError = failures >= SYNC_FAILURES_FOR_ERROR;
      return { ...g, syncFailures: failures, serverError, toast: serverError ? toast("server_error", a.now) : g.toast };
    }
    case "view": {
      // `ply` is absolute; the earliest viewable position is the start position (startPly).
      const live = a.ply === null || a.ply >= absPly(g.state);
      return {
        ...g,
        view: live ? null : Math.max(g.state.startPly, a.ply!),
        flashBackToLive: false,
        premove: live ? g.premove : null,
      };
    }
    case "select":
      return { ...g, selected: a.square };
    case "promotion":
      return {
        ...g,
        promotion: a.open,
        promotionCancelled:
          a.cancelled && g.promotion ? { square: g.promotion.from } : a.open ? null : g.promotionCancelled,
      };
    case "resign":
      return { ...g, resignOpen: a.open };
    case "toastClear":
      return { ...g, toast: null, promotionCancelled: null };
    case "toast":
      return { ...g, toast: toast(a.code, a.now, a.params) };
    case "drawOffer":
      return drawOffer(g, a.now, out);
    case "drawAnswer":
      return drawAnswer(g, a.accept, a.now, out);
    case "rematchOffer":
      return rematchOffer(g, a.serverNow, out);
    case "rematchAnswer":
      return rematchAnswer(g, a.accept, out);
    case "rematchCancel": {
      const side = you(g);
      if (!side || g.state.rematch?.by !== side) return g;
      out.push({ type: "send", cmd: "rematch:cancel", payload: { ref: g.state.ref } });
      return {
        ...g,
        state: { ...g.state, rematch: null },
        optimistic: { ...g.optimistic, rematch: { prev: g.state.rematch } },
      };
    }
    case "ready":
      return studyReady(g, out);
    case "confirmResign":
      out.push({ type: "send", cmd: "game:resign", payload: { ref: g.state.ref } });
      return { ...g, resignOpen: false };
    case "abort":
      out.push({ type: "send", cmd: "game:abort", payload: { ref: g.state.ref } });
      return g;
    case "cmdAck":
      return cmdAck(g, a.cmd, a.ack, a.now, out);
    case "bot":
      return {
        ...g,
        bot: { ...(g.bot ?? { thinking: false, hint: null, engineError: false, otherTab: false }), ...a.patch },
      };
  }
}

// ── snapshot replace and outbox flush (plan 5.2.2, 5.2.4) ──

function replace(
  g: ClientGame,
  state: GameState,
  reason: "join" | "sync" | "snapshot" | "local",
  now: number,
  out: Out[],
): ClientGame {
  let next: ClientGame = {
    ...g,
    state,
    needsSync: false,
    syncFailures: 0,
    serverError: false,
    animate: reason === "local",
    lastServerMessageAt: reason === "local" ? g.lastServerMessageAt : now,
    pending: null,
    premove: reason === "local" ? g.premove : null, // a resync clears the premove
    toast: reason === "local" ? g.toast : withoutPremoveToast(g.toast),
    optimistic: {},
  };
  if (reason === "join") {
    next.joined = true;
    if (!g.sawEnd && endedLongAgo(state, now)) next.alreadyEnded = true;
    if (g.disconnectedAt !== null || g.outbox) {
      next.disconnectedAt = null;
      next.restarting = null;
      const q = g.outbox;
      next.outbox = null;
      if (q) {
        const side = you(next);
        if (absPly(state) === q.ply && canMoveNow(state, side)) {
          const applied = applyMoveToState(state, q.uci);
          if (applied) {
            next = { ...next, state: applied.state, pending: q, toast: toast("reconnected", now, { san: q.san }) };
            out.push({
              type: "send",
              cmd: "game:move",
              payload: { ref: state.ref, ply: q.ply, uci: q.uci, clientMoveId: q.clientMoveId, premove: false },
            });
            return next;
          }
        }
        return { ...next, toast: toast("rejected", now) };
      }
      return { ...next, toast: g.joined ? toast("reconnected", now) : next.toast };
    }
  }
  if (reason === "local") next.joined = true;
  return next;
}

function onConn(g: ClientGame, conn: ConnState, now: number): ClientGame {
  if (conn === g.conn) return g;
  const down = conn === "reconnecting" || conn === "offline";
  return {
    ...g,
    conn,
    disconnectedAt: down ? (g.disconnectedAt ?? now) : g.disconnectedAt,
    premove: down ? null : g.premove,
    toast: down ? withoutPremoveToast(g.toast) : g.toast,
  };
}

// ── events (plan 5.2.2: seq === store.seq + 1, gap → game:sync, stale → ignored) ──

function onEvent(g: ClientGame, ev: ServerEvent, now: number, out: Out[]): ClientGame {
  const base = { ...g, lastServerMessageAt: now };
  switch (ev.name) {
    case "spectators:update":
      return { ...base, state: { ...g.state, spectators: ev.payload.count } };
    case "server:restarting":
      return { ...base, restarting: { restartAt: ev.payload.restartAt } };
    case "game:error":
      return { ...base, serverError: true, toast: toast("server_error", now) };
    case "game:snapshot":
      return replace(base, ev.payload, "snapshot", now, out);
    default:
      break;
  }
  const seq = (ev.payload as { seq: number }).seq;
  if (seq <= g.state.seq) return base;
  if (seq > g.state.seq + 1) {
    if (!g.needsSync) out.push({ type: "sync" });
    return { ...base, needsSync: true };
  }
  const s: GameState = { ...g.state, seq };
  const next: ClientGame = { ...base, state: s, animate: true };
  const me = you(g);
  switch (ev.name) {
    case "game:phase": {
      const p = ev.payload;
      next.state = {
        ...s,
        phase: p.phase,
        study: p.study ? { endsAt: p.study.endsAt, ready: { ...p.study.ready } } : null,
        firstMove: p.firstMove ? { ...p.firstMove } : null,
        clocks: { ...p.clocks },
      };
      if (p.study) next.state.players = withReady(next.state, p.study.ready);
      return next;
    }
    case "study:ready": {
      const ready = { ...(s.study?.ready ?? { w: false, b: false }), [ev.payload.side]: true };
      next.state = { ...s, study: s.study ? { ...s.study, ready } : s.study, players: withReady(s, ready) };
      if (ev.payload.side === me) next.optimistic = { ...g.optimistic, ready: undefined };
      return next;
    }
    case "move:applied":
      return moveApplied(next, ev.payload, now, out);
    case "clock:sync":
      next.state = {
        ...s,
        clocks: { ...ev.payload.clocks },
        frozen: ev.payload.frozen ? { ...ev.payload.frozen } : null,
      };
      return next;
    case "presence:update": {
      const p = ev.payload;
      const player = { ...s.players[p.side], online: p.online, graceEndsAt: p.graceEndsAt ?? null };
      next.state = { ...s, players: { ...s.players, [p.side]: player } };
      // While the game is frozen by a server restart, presence changes are the restart itself, not the opponent
      // leaving or returning (D7): no "disconnected, N seconds to reconnect" toast.
      if (me && p.side !== me && s.phase === "playing" && !s.frozen) {
        const wasOnline = g.state.players[p.side].online;
        if (wasOnline && !p.online) next.toast = toast("opp_disconnected", now, { graceEndsAt: p.graceEndsAt ?? 0 });
        if (!wasOnline && p.online) next.toast = toast("opp_reconnected", now);
      }
      return next;
    }
    case "draw:offered":
      next.state = { ...s, drawOffer: { by: ev.payload.by, ply: absPly(s) } };
      if (ev.payload.by === me) next.optimistic = { ...g.optimistic, draw: undefined };
      return next;
    case "draw:declined": {
      const offerer = otherSide(ev.payload.by);
      next.state = {
        ...s,
        drawOffer: null,
        canOfferAtPly: { ...s.canOfferAtPly, [offerer]: ev.payload.canOfferAtPly },
      };
      if (offerer === me) next.toast = toast("draw_declined", now, { canOfferAtPly: ev.payload.canOfferAtPly });
      if (ev.payload.by === me) next.optimistic = { ...g.optimistic, drawAnswer: undefined };
      return next;
    }
    case "draw:cancelled":
      next.state = { ...s, drawOffer: null };
      return next;
    case "game:ended": {
      const p = ev.payload;
      next.state = {
        ...s,
        phase: "ended",
        result: {
          winner: p.winner,
          method: p.method,
          ply: p.ply,
          endedAt: p.endedAt,
          ...(p.abortedBy ? { abortedBy: p.abortedBy } : {}),
        },
        clocks: { ...p.clocks },
        drawOffer: null,
        study: null,
        firstMove: null,
        frozen: null,
      };
      return {
        ...next,
        sawEnd: true,
        toast: null, // in-game toasts (disconnects, offers) end with the game
        premove: null,
        outbox: null,
        promotion: null,
        resignOpen: false,
        optimistic: {},
      };
    }
    case "game:result":
      return next;
    case "rematch:offered": {
      const p = ev.payload;
      next.state = {
        ...s,
        rematch: {
          by: p.by,
          expiresAt: p.expiresAt ?? 0,
          offersUsed: (s.rematch?.offersUsed ?? 0) + (s.rematch?.by === p.by ? 0 : 1),
        },
      };
      if (p.by === me) next.optimistic = { ...g.optimistic, rematch: undefined };
      return next;
    }
    case "rematch:declined": {
      const mine = g.state.rematch?.by === me || g.optimistic.rematch !== undefined;
      next.state = { ...s, rematch: null };
      if (ev.payload.by !== me && mine) next.toast = toast("rematch_declined", now);
      next.optimistic = { ...g.optimistic, rematch: undefined, rematchAnswer: undefined };
      return next;
    }
    case "rematch:cancelled":
      next.state = { ...s, rematch: null };
      next.optimistic = { ...g.optimistic, rematch: undefined, rematchAnswer: undefined };
      return next;
    case "rematch:expired":
      next.state = { ...s, rematch: null };
      next.toast = toast("rematch_expired", now, { reason: ev.payload.reason });
      next.optimistic = { ...g.optimistic, rematch: undefined, rematchAnswer: undefined };
      return next;
    case "rematch:started":
      out.push({ type: "navigate", to: `/game/${ev.payload.newRef}` });
      return { ...next, rematchStarted: { newRef: ev.payload.newRef } };
  }
}

function withReady(s: GameState, ready: { w: boolean; b: boolean }): GameState["players"] {
  return { w: { ...s.players.w, ready: ready.w }, b: { ...s.players.b, ready: ready.b } };
}

function moveApplied(
  g: ClientGame,
  p: Extract<ServerEvent, { name: "move:applied" }>["payload"],
  now: number,
  out: Out[],
): ClientGame {
  const s = g.state;
  const me = you(g);
  const ply = absPly(s);
  // clocksMs[i] is the mover's clock after ply i + 1 (first moves record the untouched initial value).
  const withClocks = (st: GameState): GameState => ({
    ...st,
    clocks: { ...p.clocks },
    clocksMs: st.tc ? [...st.clocksMs.slice(0, p.ply - st.startPly - 1), p.clocks[p.by]] : st.clocksMs,
    drawOffer: p.drawOfferCleared ? null : st.drawOffer,
  });
  // Our own optimistic move confirmed by the broadcast (matched on ply + uci; no clientMoveId in the broadcast).
  if (g.pending && g.pending.ply + 1 === p.ply && g.pending.uci === p.uci && ply === p.ply) {
    return { ...g, pending: null, state: withClocks(s) };
  }
  if (p.ply !== ply + 1) {
    // Our optimistic line diverged (or a ply is missing): the snapshot decides.
    if (!g.needsSync) out.push({ type: "sync" });
    return { ...g, needsSync: true };
  }
  const applied = applyMoveToState(s, p.uci);
  if (!applied) {
    if (!g.needsSync) out.push({ type: "sync" });
    return { ...g, needsSync: true };
  }
  let next: ClientGame = { ...g, pending: null, state: withClocks(applied.state) };
  if (g.view !== null && p.by !== me) next.flashBackToLive = true; // owner Q9: stay on the viewed ply
  // Premove fires in the same task when legal, else it is cancelled (plan 5.2.5).
  if (g.premove && me && p.by !== me && next.state.phase === "playing" && next.state.turn === me) {
    const pm = g.premove;
    next.premove = null;
    const fired = applyMoveToState(next.state, pm.uci);
    if (fired) {
      const clientMoveId = `pm-${p.seq}-${pm.uci}`;
      const q: QueuedMove = { clientMoveId, uci: pm.uci, ply: absPly(next.state), san: fired.san };
      out.push({
        type: "send",
        cmd: "game:move",
        payload: { ref: s.ref, ply: q.ply, uci: pm.uci, clientMoveId, premove: true },
      });
      next = {
        ...next,
        state: { ...fired.state, clocks: { ...next.state.clocks, run: otherSide(me), at: next.state.clocks.at } },
        pending: q,
        toast: withoutPremoveToast(next.toast),
      };
    } else {
      next.toast = toast("premove_cancelled", now, { reason: "illegal" });
    }
  }
  return next;
}

// ── own moves (plan 5.2.3) ──

function localMove(
  g: ClientGame,
  uci: string,
  clientMoveId: string,
  now: number,
  serverNow: number,
  out: Out[],
): ClientGame {
  const s = g.state;
  const me = you(g);
  if (!me || g.pending) return g;
  const parsed = parseUci(uci);
  if (!parsed) return g;
  if (!canMoveNow(s, me)) return g;
  if (isPromotionMove(s.fen, parsed.from, parsed.to) && !parsed.promotion) {
    return { ...g, promotion: { from: parsed.from, to: parsed.to } };
  }
  const applied = applyMoveToState(s, uci);
  if (!applied) return reduceInner(g, { type: "illegal", from: parsed.from, to: parsed.to, now }, out);
  const q: QueuedMove = {
    clientMoveId,
    uci: splitMoves(applied.state.moves).slice(-1)[0]!,
    ply: absPly(s),
    san: applied.san,
  };
  const base = { ...g, promotion: null, selected: null, view: null, flashBackToLive: false };
  if (g.conn !== "live") {
    // At most one move waits while the connection is down; it is shown as a ghost, not applied (plan 5.2.4).
    if (g.outbox) return { ...base, toast: toast("outbox_full", now) };
    return { ...base, outbox: q };
  }
  let state = applied.state;
  if (s.phase === "playing" && s.tc && s.clocks.run === me) {
    const left = remaining(s.clocks, me, serverNow);
    state = {
      ...state,
      clocks: { ...s.clocks, [me]: left + s.tc.incrementMs, run: otherSide(me), at: serverNow },
      clocksMs: [...s.clocksMs, left + s.tc.incrementMs],
    };
  }
  // Implicit decline of the opponent's open offer happens on the server; mirror it locally.
  if (state.drawOffer && state.drawOffer.by !== me) state = { ...state, drawOffer: null };
  out.push({
    type: "send",
    cmd: "game:move",
    payload: { ref: s.ref, ply: q.ply, uci: q.uci, clientMoveId, premove: false },
  });
  return { ...base, state, pending: q, animate: true };
}

function moveAck(g: ClientGame, clientMoveId: string, ack: Ack<Partial<MoveAck>>, now: number, out: Out[]): ClientGame {
  const mine = g.pending?.clientMoveId === clientMoveId;
  if (ack.ok) {
    if (!mine) return { ...g, state: { ...g.state, seq: Math.max(g.state.seq, ack.seq ?? 0) } };
    const s = g.state;
    const by = s.you.color!;
    const clocks = ack.clocks ?? s.clocks;
    const clocksMs = s.tc && ack.ply ? [...s.clocksMs.slice(0, ack.ply - s.startPly - 1), clocks[by]] : s.clocksMs;
    return {
      ...g,
      pending: null,
      state: { ...s, seq: Math.max(s.seq, ack.seq ?? 0), clocks: { ...clocks }, clocksMs },
    };
  }
  if (!mine) return g;
  const err = ack as AckError;
  const next: ClientGame = { ...g, pending: null };
  if (err.state) {
    const replaced = replace(next, err.state, "sync", now, out);
    return err.code === "ended" ? replaced : { ...replaced, toast: toast("rejected", now, { code: err.code }) };
  }
  out.push({ type: "sync" });
  const quiet: SocketErrorCode[] = ["rate_limited", "phase", "ended"];
  return quiet.includes(err.code) ? next : { ...next, toast: toast("rejected", now, { code: err.code }) };
}

function setPremove(g: ClientGame, uci: string | null, now: number, reason?: "cancelled"): ClientGame {
  if (uci === null) {
    if (!g.premove) return g;
    return {
      ...g,
      premove: null,
      toast: reason === "cancelled" ? toast("premove_cancelled", now, { reason: "cancelled" }) : g.toast,
    };
  }
  const me = you(g);
  const s = g.state;
  // Live human games only, on the opponent's turn, while playing and live (plan 5.2.5, owner Q10).
  if (!me || s.mode === "BOT" || s.phase !== "playing" || s.turn === me || g.view !== null) return g;
  const m = parseUci(uci);
  if (!m) return g;
  return { ...g, premove: { uci, from: m.from, to: m.to }, toast: toast("premove_set", now, { uci }) };
}

// ── optimistic offers (plan 5.2.8, G5) ──

function drawOffer(g: ClientGame, now: number, out: Out[]): ClientGame {
  const me = you(g);
  const s = g.state;
  if (!me || s.phase !== "playing" || s.drawOffer?.by === me) return g;
  if (absPly(s) < s.canOfferAtPly[me])
    return { ...g, toast: toast("draw_cooldown", now, { canOfferAtPly: s.canOfferAtPly[me] }) };
  out.push({ type: "send", cmd: "draw:offer", payload: { ref: s.ref } });
  if (s.drawOffer) return g; // crossing offer = accept; the server ends the game
  return {
    ...g,
    state: { ...s, drawOffer: { by: me, ply: absPly(s) } },
    optimistic: { ...g.optimistic, draw: { prev: s.drawOffer } },
  };
}

function drawAnswer(g: ClientGame, accept: boolean, now: number, out: Out[]): ClientGame {
  const me = you(g);
  const s = g.state;
  if (!me || !s.drawOffer || s.drawOffer.by === me) return g;
  out.push({ type: "send", cmd: accept ? "draw:accept" : "draw:decline", payload: { ref: s.ref } });
  if (accept) return g;
  return {
    ...g,
    state: {
      ...s,
      drawOffer: null,
      canOfferAtPly: { ...s.canOfferAtPly, [otherSide(me)]: absPly(s) + DRAW_COOLDOWN_PLIES },
    },
    // Feedback for the one who declined (V3Game declineDraw: "You declined the draw."; FIX-A).
    toast: toast("draw_declined_self", now),
    optimistic: { ...g.optimistic, drawAnswer: { prev: s.drawOffer } },
  };
}

function rematchOffer(g: ClientGame, serverNow: number, out: Out[]): ClientGame {
  const me = you(g);
  const s = g.state;
  if (!me || s.phase !== "ended" || s.rematch?.by === me) return g;
  out.push({ type: "send", cmd: "rematch:offer", payload: { ref: s.ref } });
  if (s.rematch) return g; // crossing offers accept
  return {
    ...g,
    state: { ...s, rematch: { by: me, expiresAt: serverNow + REMATCH_MS, offersUsed: 1 } },
    optimistic: { ...g.optimistic, rematch: { prev: s.rematch } },
  };
}

function rematchAnswer(g: ClientGame, accept: boolean, out: Out[]): ClientGame {
  const me = you(g);
  const s = g.state;
  if (!me || !s.rematch || s.rematch.by === me) return g;
  out.push({ type: "send", cmd: accept ? "rematch:accept" : "rematch:decline", payload: { ref: s.ref } });
  if (accept) return g;
  return { ...g, state: { ...s, rematch: null }, optimistic: { ...g.optimistic, rematchAnswer: { prev: s.rematch } } };
}

function studyReady(g: ClientGame, out: Out[]): ClientGame {
  const me = you(g);
  const s = g.state;
  if (!me || s.phase !== "study" || !s.study || s.study.ready[me]) return g;
  out.push({ type: "send", cmd: "study:ready", payload: { ref: s.ref } });
  const ready = { ...s.study.ready, [me]: true };
  return {
    ...g,
    state: { ...s, study: { ...s.study, ready }, players: withReady(s, ready) },
    optimistic: { ...g.optimistic, ready: true },
  };
}

function cmdAck(g: ClientGame, cmd: Command, ack: Ack<Record<string, unknown>>, now: number, out: Out[]): ClientGame {
  const s = g.state;
  const me = you(g);
  if (ack.ok) {
    switch (cmd) {
      case "draw:offer":
        return { ...g, optimistic: { ...g.optimistic, draw: undefined } };
      case "draw:decline":
        return { ...g, optimistic: { ...g.optimistic, drawAnswer: undefined } };
      case "rematch:offer": {
        const expiresAt = typeof ack.expiresAt === "number" ? ack.expiresAt : null;
        const rematch =
          s.rematch && expiresAt !== null && s.rematch.by === me ? { ...s.rematch, expiresAt } : s.rematch;
        return { ...g, state: { ...s, rematch }, optimistic: { ...g.optimistic, rematch: undefined } };
      }
      case "rematch:accept":
        if (typeof ack.newRef === "string") out.push({ type: "navigate", to: `/game/${ack.newRef}`, acceptedRematch: true });
        return g;
      case "rematch:decline":
      case "rematch:cancel":
        return { ...g, optimistic: { ...g.optimistic, rematchAnswer: undefined, rematch: undefined } };
      case "study:ready":
        return { ...g, optimistic: { ...g.optimistic, ready: undefined } };
      default:
        return g;
    }
  }
  const err = ack as AckError;
  const o = g.optimistic;
  const withToast = (base: ClientGame): ClientGame => {
    if (err.code === "draw_cooldown") {
      const cap = err.canOfferAtPly ?? (me ? s.canOfferAtPly[me] : 0);
      return {
        ...base,
        state: me ? { ...base.state, canOfferAtPly: { ...base.state.canOfferAtPly, [me]: cap } } : base.state,
        toast: toast("draw_cooldown", now, { canOfferAtPly: cap }),
      };
    }
    if (err.code === "expired") return { ...base, toast: toast("rematch_expired", now, { reason: "timeout" }) };
    if (err.code === "paywall") return { ...base, toast: toast("rematch_paywall", now) };
    if (err.code === "draining") return { ...base, toast: toast("draining", now) };
    if (err.code === "rate_limited") return { ...base, toast: toast("rate_limited", now) };
    if (err.code === "internal") out.push({ type: "sync" });
    return base;
  };
  switch (cmd) {
    case "draw:offer":
      return withToast(
        o.draw ? { ...g, state: { ...s, drawOffer: o.draw.prev }, optimistic: { ...o, draw: undefined } } : g,
      );
    case "draw:decline":
      // no_offer: the offer is gone anyway; anything else puts the bar back.
      if (o.drawAnswer && err.code !== "no_offer") {
        return withToast({
          ...g,
          state: { ...s, drawOffer: o.drawAnswer.prev },
          optimistic: { ...o, drawAnswer: undefined },
        });
      }
      return withToast({ ...g, optimistic: { ...o, drawAnswer: undefined } });
    case "rematch:offer":
      return withToast(
        o.rematch ? { ...g, state: { ...s, rematch: o.rematch.prev }, optimistic: { ...o, rematch: undefined } } : g,
      );
    case "rematch:decline":
      if (o.rematchAnswer && err.code !== "no_offer" && err.code !== "expired") {
        return withToast({
          ...g,
          state: { ...s, rematch: o.rematchAnswer.prev },
          optimistic: { ...o, rematchAnswer: undefined },
        });
      }
      return { ...g, optimistic: { ...o, rematchAnswer: undefined } };
    case "rematch:cancel":
      if (o.rematch && err.code !== "no_offer") {
        return withToast({ ...g, state: { ...s, rematch: o.rematch.prev }, optimistic: { ...o, rematch: undefined } });
      }
      return { ...g, optimistic: { ...o, rematch: undefined } };
    case "study:ready": {
      if (!o.ready || !me || !s.study) return g;
      const ready = { ...s.study.ready, [me]: false };
      return withToast({
        ...g,
        state: { ...s, study: { ...s.study, ready }, players: withReady(s, ready) },
        optimistic: { ...o, ready: undefined },
      });
    }
    case "rematch:accept":
    case "game:resign":
    case "game:abort":
    case "draw:accept":
      if (err.code === "ended" || err.code === "phase") out.push({ type: "sync" });
      return withToast(g);
    default:
      return withToast(g);
  }
}
