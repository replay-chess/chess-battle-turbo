// Building a ServerGame (new session or restore by replay) and projecting it to the wire GameState per viewer.

import { initialClocks } from "../clock/clock";
import { RTT_START_MS } from "../constants";
import { headerRight, initialsOf } from "../rules/describe";
import { Chess, putChess, replay, sideToMove, startPlyOf } from "../rules/chess";
import { tcLabel, timeClassOf, wireTimeClass } from "../rules/timeClass";
import type { FoldedJournal } from "./journal";
import type { Presence, Seat, ServerGame } from "./state";
import type { GameState, Phase, PlayerView, PositionCard, Prefix, Side } from "./types";

export interface CreateGameInput {
  ref: string;
  mode: ServerGame["mode"];
  rated?: boolean;
  /** null only for untimed games (live games are always timed). */
  tc: { initialMs: number; incrementMs: number } | null;
  startFen: string;
  studySeconds: number;
  startKind?: ServerGame["startKind"];
  headerLeft?: string;
  position?: PositionCard | null;
  prefix?: Prefix;
  seats: { w: Seat; b: Seat };
  rematchOf?: string | null;
  createdAt?: number;
}

const emptyPresence = (): Presence => ({ sockets: [], graceEndsAt: null, detaches: [] });

export function createGame(input: CreateGameInput, now: number): ServerGame {
  const chess = new Chess(input.startFen);
  const tcSeconds = input.tc
    ? { initialSeconds: input.tc.initialMs / 1000, incrementSeconds: input.tc.incrementMs / 1000 }
    : null;
  const fen = chess.fen();
  putChess(input.startFen, [], chess);
  return {
    v: 1,
    ref: input.ref,
    mode: input.mode,
    rated: input.rated ?? false,
    timeClass: wireTimeClass(timeClassOf(tcSeconds)),
    tc: input.tc,
    startFen: input.startFen,
    startPly: startPlyOf(input.startFen),
    studySeconds: input.studySeconds,
    startKind: input.startKind ?? "initial",
    headerLeft: input.headerLeft ?? "",
    position: input.position ?? null,
    prefix: input.prefix ?? { sans: "", startMoveNo: 1, startsBlack: false },
    seats: input.seats,
    rematchOf: input.rematchOf ?? null,
    createdAt: input.createdAt ?? now,
    startedAt: null,
    phase: "waiting",
    seq: 0,
    spectSeq: 0,
    moves: [],
    sans: [],
    clocksMs: [],
    spentMs: [],
    fen,
    turn: sideToMove(fen),
    inCheck: chess.inCheck(),
    study: null,
    firstMove: null,
    clocks: initialClocks(input.tc?.initialMs ?? 0, now),
    frozen: null,
    draining: false,
    presence: { w: emptyPresence(), b: emptyPresence() },
    rtt: { w: RTT_START_MS, b: RTT_START_MS },
    lagUsed: { w: 0, b: 0 },
    drawOffer: null,
    canOfferAtPly: { w: 0, b: 0 },
    rematch: null,
    rematchOffersUsed: 0,
    rematchDone: false,
    result: null,
    abortedBy: null,
    stats: { drawOffers: { w: 0, b: 0 }, premoves: { w: 0, b: 0 } },
    spectators: 0,
    withheld: null,
    acks: [],
    timer: null,
  };
}

/** Saved progress for a restore: the longer of the journal and the DB row (the caller picks; the journal wins ties). */
export interface RestoreProgress {
  moves: readonly string[];
  clocksMs: readonly number[];
  spentMs?: readonly number[];
  phase: Phase;
  /** Study end or first-move deadline at the time of the save. */
  phaseEndsAt: number | null;
  firstMoveSide?: Side | null;
  ready?: { w: boolean; b: boolean };
  /** Clock values at `savedAt` and the side that was running. */
  clocks: { w: number; b: number; run: Side | null };
  drawOffer?: { by: Side; ply: number } | null;
  canOfferAtPly?: { w: number; b: number };
  /** When the progress was taken (freeze line, or the last checkpoint's lastMoveAt). */
  savedAt: number;
  startedAt?: number | null;
}

export type RestoreResult = { ok: true; state: ServerGame } | { ok: false; reason: "corrupt"; index: number };

/**
 * Restores a live session (plan 7.6 step 3–5): replays every ply from the start FEN (threefold history intact),
 * restores phase, deadlines, the draw offer and clocks, with every player offline and the clocks frozen since
 * `savedAt`. It resumes when both players attach or at `now + resumeMaxWaitMs` (fed as a timer); the resume shifts
 * every deadline by the frozen time, so deadlines that passed during the downtime are extended by it.
 */
export function restoreGame(
  input: CreateGameInput,
  progress: RestoreProgress,
  now: number,
  resumeMaxWaitMs: number,
): RestoreResult {
  const r = replay(input.startFen, progress.moves);
  if (!r.ok) return { ok: false, reason: "corrupt", index: r.index };
  const base = createGame(input, now);
  const moves = [...progress.moves];
  putChess(input.startFen, moves, r.chess);
  const fen = r.chess.fen();
  const state: ServerGame = {
    ...base,
    phase: progress.phase,
    moves,
    sans: r.sans,
    clocksMs: [...progress.clocksMs],
    spentMs: progress.spentMs ? [...progress.spentMs] : progress.clocksMs.map(() => 0),
    fen,
    turn: sideToMove(fen),
    inCheck: r.chess.inCheck(),
    study:
      progress.phase === "study" && progress.phaseEndsAt !== null
        ? { endsAt: progress.phaseEndsAt, ready: progress.ready ?? { w: false, b: false } }
        : null,
    firstMove:
      progress.phase === "first_move" && progress.phaseEndsAt !== null
        ? { side: progress.firstMoveSide ?? sideToMove(fen), deadlineAt: progress.phaseEndsAt }
        : null,
    clocks: { w: progress.clocks.w, b: progress.clocks.b, run: null, at: progress.savedAt },
    frozen:
      progress.phase === "ended"
        ? null
        : { since: progress.savedAt, reason: "restart", run: progress.clocks.run, resumeBy: now + resumeMaxWaitMs },
    drawOffer: progress.drawOffer ?? null,
    canOfferAtPly: progress.canOfferAtPly ?? { w: 0, b: 0 },
    startedAt: progress.startedAt ?? null,
    withheld: null,
  };
  // Spectators stay one ply behind after a restore too (plan 8.10, rule 11.2.12; FIX-A): the last ply is withheld
  // again, and released to them by the next move or the end, as in a session that never restarted.
  if (progress.phase !== "ended" && moves.length > 0) {
    const n = moves.length;
    const first = sideToMove(input.startFen);
    const by: Side = (n - 1) % 2 === 0 ? first : first === "w" ? "b" : "w";
    const last = lastClocks(state.clocksMs, first, n, input.tc?.initialMs ?? 0);
    state.withheld = {
      ply: state.startPly + n,
      uci: moves[n - 1]!,
      san: r.sans[n - 1] ?? moves[n - 1]!,
      by,
      w: last.w,
      b: last.b,
      check: state.inCheck,
      at: progress.savedAt,
    };
  }
  return { ok: true, state };
}

/** Each side's last recorded clock among the first `plies` plies (clocksMs[i] is the mover's clock after ply i). */
function lastClocks(clocksMs: readonly number[], first: Side, plies: number, initialMs: number): { w: number; b: number } {
  const out = { w: initialMs, b: initialMs };
  const seen = { w: false, b: false };
  for (let i = Math.min(plies, clocksMs.length) - 1; i >= 0 && !(seen.w && seen.b); i--) {
    const side: Side = i % 2 === 0 ? first : first === "w" ? "b" : "w";
    if (seen[side]) continue;
    out[side] = clocksMs[i]!;
    seen[side] = true;
  }
  return out;
}

/** Restore progress from a folded journal (clock values come from the last plies and the open line). */
export function progressFromJournal(f: FoldedJournal, initialMs: number): RestoreProgress {
  const first: Side = f.open ? sideToMove(f.open.startFen) : "w";
  const sideOfPly = (i: number): Side => (i % 2 === 0 ? first : first === "w" ? "b" : "w");
  // clocksMs[i] is the mover's clock after ply i; a side's clock is its last recorded value.
  const clockOf = (side: Side): number => {
    for (let i = f.clocksMs.length - 1; i >= 0; i--) if (sideOfPly(i) === side) return f.clocksMs[i]!;
    return initialMs;
  };
  const toMove = sideOfPly(f.moves.length);
  const clocks = {
    w: f.frozenClocks?.w ?? f.turnBaseClocks?.w ?? clockOf("w"),
    b: f.frozenClocks?.b ?? f.turnBaseClocks?.b ?? clockOf("b"),
  };
  // Without a freeze line (a crash), the side to move's clock is its value when its turn started: charge the time
  // its turn had already run by the last journal line (or the end line), so a later draw-offer or presence line does
  // not refund it (FIX-A). The time after the last line is unknown and not charged (plan 7.6).
  const timed = initialMs > 0 && f.clocksMs.length > 0;
  if (!f.frozenClocks && timed && f.playingAt !== null && f.turnStartAt !== null && (f.phase === "playing" || f.end)) {
    const until = f.end?.at ?? f.lastAt;
    clocks[toMove] = Math.max(0, clocks[toMove] - Math.max(0, until - f.turnStartAt));
  }
  // A timeout ends with the flagged side (always the side to move) at 0; the end line carries no clocks (FIX-A).
  if (f.end && (f.end.method === "timeout" || f.end.method === "timeout_vs_insufficient")) clocks[toMove] = 0;
  return {
    moves: f.moves,
    clocksMs: f.clocksMs,
    spentMs: f.spentMs,
    phase: f.phase,
    phaseEndsAt: f.phaseEndsAt,
    firstMoveSide: f.firstMoveSide,
    ready: f.ready,
    clocks: {
      w: clocks.w,
      b: clocks.b,
      run: f.phase === "playing" ? toMove : null,
    },
    drawOffer: f.drawOffer,
    canOfferAtPly: f.canOfferAtPly,
    savedAt: f.frozenAt ?? f.lastAt,
    startedAt: f.playingAt,
  };
}

export interface Viewer {
  role: "player" | "spectator";
  color?: Side;
}

function playerView(s: ServerGame, side: Side): PlayerView {
  const seat = s.seats[side];
  const p = s.presence[side];
  const view: PlayerView = {
    ref: seat.ref,
    displayName: seat.name,
    initials: initialsOf(seat.name || "?"),
    avatarUrl: seat.avatarUrl,
    rating: seat.rating,
    isBot: false,
    online: p.sockets.length > 0,
    graceEndsAt: p.graceEndsAt,
  };
  if (s.study) view.ready = s.study.ready[side];
  return view;
}

/** The wire GameState for one viewer (plan 7.4.6). Spectators get the one-ply-delayed view without offers. */
export function projectState(s: ServerGame, viewer: Viewer, now: number): GameState {
  const spectator = viewer.role === "spectator";
  let moves = s.moves;
  let clocksMs = s.clocksMs;
  let fen = s.fen;
  let turn = s.turn;
  let inCheck = s.inCheck;
  let clocks: GameState["clocks"] = { ...s.clocks };
  if (spectator && s.withheld && moves.length > 0) {
    // Spectator clocks are one move late too (plan 8.10, FIX-A): the values recorded at the shown ply, running for
    // the side to move in the shown position from the time the withheld ply was played (as releaseWithheld sends).
    const shown = moves.length - 1;
    const first = sideToMove(s.startFen);
    const last = lastClocks(s.clocksMs, first, shown, s.tc?.initialMs ?? 0);
    clocks = {
      w: last.w,
      b: last.b,
      run: s.tc && shown >= 2 && !s.frozen && s.phase === "playing" ? s.withheld.by : null,
      at: s.frozen ? s.clocks.at : s.withheld.at,
    };
    moves = moves.slice(0, -1);
    clocksMs = clocksMs.slice(0, Math.min(clocksMs.length, moves.length));
    const r = replay(s.startFen, moves);
    if (r.ok) {
      fen = r.chess.fen();
      turn = r.chess.turn();
      inCheck = r.chess.inCheck();
    }
  }
  const tcSeconds = s.tc ? { initialSeconds: s.tc.initialMs / 1000, incrementSeconds: s.tc.incrementMs / 1000 } : null;
  const state: GameState = {
    v: 2,
    ref: s.ref,
    seq: spectator ? s.spectSeq : s.seq,
    serverNow: now,
    mode: s.mode,
    rated: s.rated,
    timeClass: s.timeClass,
    tc: s.tc ? { initialMs: s.tc.initialMs, incrementMs: s.tc.incrementMs, label: tcLabel(tcSeconds) } : null,
    header: {
      left: s.headerLeft,
      right: headerRight({ mode: s.mode, tc: tcSeconds, role: viewer.role, rematch: !!s.rematchOf }),
    },
    position: s.position,
    startFen: s.startFen,
    startPly: s.startPly,
    prefix: s.prefix,
    moves: moves.join(" "),
    clocksMs: [...clocksMs],
    fen,
    turn,
    inCheck,
    phase: s.phase,
    study: s.study ? { endsAt: s.study.endsAt, ready: { ...s.study.ready } } : null,
    firstMove: s.firstMove ? { ...s.firstMove } : null,
    clocks,
    frozen: s.frozen ? { since: s.frozen.since, reason: "restart" } : null,
    players: { w: playerView(s, "w"), b: playerView(s, "b") },
    you: spectator ? { role: "spectator" } : { role: "player", ...(viewer.color ? { color: viewer.color } : {}) },
    drawOffer: spectator ? null : s.drawOffer ? { ...s.drawOffer } : null,
    canOfferAtPly: { ...s.canOfferAtPly },
    rematch:
      spectator || !s.rematch
        ? null
        : { by: s.rematch.by, expiresAt: s.rematch.expiresAt, offersUsed: s.rematchOffersUsed },
    spectators: s.spectators,
    result: s.result ? { ...s.result } : null,
  };
  if (s.rematchOf) state.rematchOf = s.rematchOf;
  return state;
}
