// Local runner for bot games (plan 5.3.2, 8.14): rules, clocks that start after two plies, end detection, resign,
// abort before two plies, draw answers, undo, hints bookkeeping, pause while hidden (owner Q6), the journal and the
// `complete` body. Pure; the WEB hook (useLocalGame) owns timers, the engine and storage.

import { chargeMove, remainingRaw, startClocks } from "../clock/clock";
import type { Clocks, EndMethod, GameState, Side } from "../machine/types";
import { otherSide } from "../machine/types";
import { applyUci, isPromotionMove, parseUci, replay, splitMoves, takeChess, putChess } from "../rules/chess";
import { detectEnd } from "../rules/end";
import { flagOutcome } from "../rules/insufficient";
import { advanceHint, type HintTracker } from "../bot/hints";
import type { BotJournal, CompleteBody } from "./journal";

export interface LocalGame {
  state: GameState;
  human: Side;
  rev: number;
  assists: { hints: number; undos: number };
  startedAt: number;
  /** Clocks before each ply (index = ply number − 1), for undo. */
  before: Clocks[];
  /** While the page is hidden on the human's turn, the human's clock is paused (owner Q6). */
  paused: { since: number } | null;
  hint: HintTracker | null;
  ended: boolean;
}

export type LocalResult =
  | { ok: true; game: LocalGame; san?: string; ended?: boolean }
  | { ok: false; reason: "not_your_turn" | "illegal" | "promotion_required" | "ended" | "not_allowed" };

/** Starts from a server snapshot (mode BOT, `you.color` = the human). */
export function createLocalGame(snapshot: GameState, now: number): LocalGame {
  const human = snapshot.you.color ?? "w";
  const plies = splitMoves(snapshot.moves).length;
  const clocks: Clocks = snapshot.tc
    ? { ...snapshot.clocks, run: plies >= 2 && snapshot.phase === "playing" ? snapshot.turn : null, at: now }
    : { w: 0, b: 0, run: null, at: now };
  return {
    state: {
      ...snapshot,
      phase: snapshot.phase === "ended" ? "ended" : "playing",
      study: null,
      firstMove: null,
      clocks,
    },
    human,
    rev: 0,
    assists: { hints: 0, undos: 0 },
    startedAt: now,
    before: [],
    paused: null,
    hint: null,
    ended: snapshot.phase === "ended",
  };
}

/** Rebuilds a local game from a journal newer than the snapshot (plan 5.3.2 resume order). */
export function resumeFromJournal(snapshot: GameState, journal: BotJournal, now: number): LocalGame | null {
  const r = replay(snapshot.startFen, journal.moves);
  if (!r.ok) return null;
  const g = createLocalGame({ ...snapshot, moves: "", clocksMs: [], fen: snapshot.startFen }, now);
  const first = r.history.length ? r.history[0]!.color : g.state.turn;
  const sideOf = (i: number): Side => (i % 2 === 0 ? first : otherSide(first));
  const initial = snapshot.tc?.initialMs ?? 0;
  // A side's clock before ply i is its last recorded value before i (the initial time if it has not moved).
  const before = (side: Side, i: number) => {
    for (let j = Math.min(i, journal.clocksMs.length) - 1; j >= 0; j--)
      if (sideOf(j) === side) return journal.clocksMs[j]!;
    return initial;
  };
  const plies = journal.moves.length;
  const fen = r.chess.fen();
  putChess(snapshot.startFen, journal.moves, r.chess);
  const turn = r.chess.turn();
  const clocks: Clocks = snapshot.tc
    ? { w: before("w", plies), b: before("b", plies), run: plies >= 2 ? turn : null, at: now }
    : g.state.clocks;
  return {
    ...g,
    rev: journal.rev,
    assists: { ...journal.assists },
    startedAt: journal.startedAt,
    before: journal.moves.map((_, i) => ({ w: before("w", i), b: before("b", i), run: null, at: now })),
    state: {
      ...g.state,
      moves: journal.moves.join(" "),
      clocksMs: [...journal.clocksMs],
      fen,
      turn,
      inCheck: r.chess.inCheck(),
      clocks,
    },
  };
}

const plyCount = (g: LocalGame) => splitMoves(g.state.moves).length;

function applyLocal(g: LocalGame, side: Side, uci: string, now: number): LocalResult {
  if (g.ended) return { ok: false, reason: "ended" };
  const s = g.state;
  if (s.turn !== side) return { ok: false, reason: "not_your_turn" };
  const parsed = parseUci(uci);
  if (!parsed) return { ok: false, reason: "illegal" };
  if (isPromotionMove(s.fen, parsed.from, parsed.to) && !parsed.promotion)
    return { ok: false, reason: "promotion_required" };
  const plies = plyCount(g);
  const live = settledClocks(g, now);

  // Clocks run only after two plies (plan 5.3.2); the human flags only on tick, a late move still flags.
  let clocks: Clocks = live;
  let clockMs: number | null = null;
  if (s.tc && plies >= 2) {
    const charge = chargeMove({
      clocks: live,
      mover: side,
      now,
      premove: false,
      rttMs: 0,
      lagUsedMs: 0,
      initialMs: s.tc.initialMs,
      incrementMs: s.tc.incrementMs,
    });
    if (charge.flagged) {
      const o = flagOutcome(s.fen, side);
      return {
        ok: true,
        game: endLocal({ ...g, state: { ...s, clocks: { ...live, [side]: 0 } } }, o.winner, o.method, now),
        ended: true,
      };
    }
    clocks = charge.clocks;
    clockMs = charge.clockMs;
  } else if (s.tc) clockMs = live[side];

  const moves = splitMoves(s.moves);
  const chess = takeChess(s.startFen, moves);
  const mv = applyUci(chess, uci);
  if (!mv) {
    putChess(s.startFen, moves, chess);
    return { ok: false, reason: "illegal" };
  }
  const next = [...moves, `${mv.from}${mv.to}${mv.promotion ?? ""}`];
  putChess(s.startFen, next, chess);
  if (s.tc && next.length === 2) clocks = startClocks(clocks, chess.turn(), now);
  const state: GameState = {
    ...s,
    moves: next.join(" "),
    clocksMs: clockMs === null ? s.clocksMs : [...s.clocksMs, clockMs],
    fen: chess.fen(),
    turn: chess.turn(),
    inCheck: chess.inCheck(),
    clocks,
    drawOffer: null,
  };
  let game: LocalGame = { ...g, state, before: [...g.before, live], rev: g.rev + 1 };
  const end = detectEnd(chess);
  if (end) game = endLocal(game, end.winner, end.method, now);
  return { ok: true, game, san: mv.san, ended: !!end };
}

/** Clocks with the human's hidden time removed while paused. */
function settledClocks(g: LocalGame, now: number): Clocks {
  if (!g.paused) return g.state.clocks;
  return { ...g.state.clocks, at: g.state.clocks.at + (now - g.paused.since) };
}

export function humanMove(g: LocalGame, uci: string, now: number): LocalResult {
  return applyLocal(g, g.human, uci, now);
}

export function botMove(g: LocalGame, uci: string, now: number): LocalResult {
  return applyLocal(g, otherSide(g.human), uci, now);
}

function endLocal(g: LocalGame, winner: Side | null, method: EndMethod, now: number): LocalGame {
  const c = g.state.clocks;
  const clocks: Clocks = c.run
    ? { w: Math.max(0, remainingRaw(c, "w", now)), b: Math.max(0, remainingRaw(c, "b", now)), run: null, at: now }
    : { ...c, run: null, at: now };
  return {
    ...g,
    ended: true,
    paused: null,
    state: {
      ...g.state,
      phase: "ended",
      clocks,
      drawOffer: null,
      result: { winner, method, ply: g.state.startPly + plyCount(g), endedAt: now }, // absolute, as on the wire
    },
  };
}

/** Flag check, called by the hook's timer; a no-op until the running clock reaches zero. */
export function tick(g: LocalGame, now: number): LocalGame {
  if (g.ended || g.paused) return g;
  const c = g.state.clocks;
  if (!g.state.tc || !c.run || remainingRaw(c, c.run, now) > 0) return g;
  const o = flagOutcome(g.state.fen, c.run);
  return endLocal({ ...g, state: { ...g.state, clocks: { ...c, [c.run]: 0 } } }, o.winner, o.method, now);
}

export function resign(g: LocalGame, now: number): LocalResult {
  if (g.ended) return { ok: false, reason: "ended" };
  return { ok: true, game: endLocal(g, otherSide(g.human), "resignation", now), ended: true };
}

/** Abort is available before two plies (no first-move timer against the bot). */
export function abort(g: LocalGame, now: number): LocalResult {
  if (g.ended) return { ok: false, reason: "ended" };
  if (plyCount(g) >= 2) return { ok: false, reason: "not_allowed" };
  const ended = endLocal(g, null, "aborted", now);
  return {
    ok: true,
    game: { ...ended, state: { ...ended.state, result: { ...ended.state.result!, abortedBy: g.human } } },
    ended: true,
  };
}

/** The bot answered a draw offer (drawPolicy decides). */
export function drawAnswered(g: LocalGame, accepted: boolean, now: number): LocalResult {
  if (g.ended) return { ok: false, reason: "ended" };
  if (!accepted) return { ok: true, game: { ...g, state: { ...g.state, drawOffer: null } } };
  return { ok: true, game: endLocal(g, null, "agreement", now), ended: true };
}

export interface UndoResult {
  game: LocalGame;
  /** SANs taken back, oldest first ("11.Bxb5+", "11…Nbd7" in the toast). */
  sans: string[];
  firstPly: number;
}

/**
 * Undo (plan 8.14): on your turn, takes back your last move and the bot's reply; while the bot is thinking, only
 * your move. Clocks return to the values recorded before your move. Not after the end.
 */
export function undo(g: LocalGame, now: number, opts: { botThinking: boolean }): UndoResult | null {
  if (g.ended) return null;
  const moves = splitMoves(g.state.moves);
  const humanTurn = g.state.turn === g.human;
  const take = opts.botThinking || !humanTurn ? 1 : 2;
  if (moves.length < take) return null;
  const keep = moves.slice(0, moves.length - take);
  // The last of the removed plies must be the human's move (index keep.length).
  const r = replay(g.state.startFen, moves);
  if (!r.ok) return null;
  const humanIdx = keep.length;
  if (r.history[humanIdx]?.color !== g.human) return null;
  const back = replay(g.state.startFen, keep);
  if (!back.ok) return null;
  putChess(g.state.startFen, keep, back.chess);
  const restored = g.before[humanIdx] ?? g.state.clocks;
  const clocks: Clocks = g.state.tc ? { ...restored, run: keep.length >= 2 ? g.human : null, at: now } : g.state.clocks;
  return {
    sans: r.sans.slice(humanIdx),
    firstPly: humanIdx + 1,
    game: {
      ...g,
      rev: g.rev + 1,
      assists: { ...g.assists, undos: g.assists.undos + 1 },
      before: g.before.slice(0, humanIdx),
      paused: null,
      state: {
        ...g.state,
        moves: keep.join(" "),
        clocksMs: g.state.clocksMs.slice(0, Math.min(g.state.clocksMs.length, keep.length)),
        fen: back.chess.fen(),
        turn: back.chess.turn(),
        inCheck: back.chess.inCheck(),
        clocks,
        drawOffer: null,
      },
    },
  };
}

/** Records a shown hint (both levels count). */
export function hintShown(g: LocalGame, level: 1 | 2): LocalGame {
  return {
    ...g,
    assists: { ...g.assists, hints: g.assists.hints + 1 },
    hint: advanceHint(g.hint, g.state.fen, level),
    rev: g.rev + 1,
  };
}

/** Page hidden: the human's clock pauses on their turn (owner Q6); the bot never moves while hidden (hook). */
export function hide(g: LocalGame, now: number): LocalGame {
  if (g.ended || g.paused || g.state.clocks.run !== g.human) return g;
  return { ...g, paused: { since: now } };
}

export function show(g: LocalGame, now: number): LocalGame {
  if (!g.paused) return g;
  return { ...g, paused: null, state: { ...g.state, clocks: settledClocks(g, now) } };
}

export function toJournal(g: LocalGame, now: number): BotJournal {
  return {
    v: 1,
    rev: g.rev,
    moves: splitMoves(g.state.moves),
    clocksMs: [...g.state.clocksMs],
    startedAt: g.startedAt,
    assists: { ...g.assists },
    updatedAt: now,
  };
}

/** The `POST /api/games/[ref]/complete` body once the game ended. */
export function completeBody(g: LocalGame, now: number): CompleteBody | null {
  const r = g.state.result;
  if (!g.ended || !r) return null;
  return {
    rev: g.rev,
    moves: splitMoves(g.state.moves),
    clocksMs: [...g.state.clocksMs],
    result: r.method === "aborted" ? "aborted" : r.winner === null ? "draw" : r.winner,
    method: r.method,
    assists: { ...g.assists },
    endedAtClient: now,
  };
}

/** The checkpoint body (plan 7.1.3). */
export function checkpointBody(g: LocalGame): {
  rev: number;
  moves: string[];
  clocksMs: number[];
  assists: { hints: number; undos: number };
} {
  return {
    rev: Math.max(1, g.rev),
    moves: splitMoves(g.state.moves),
    clocksMs: [...g.state.clocksMs],
    assists: { ...g.assists },
  };
}
