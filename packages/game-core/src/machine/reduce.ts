// Server-authoritative reducer (plan 8.1, transitions T1–T20). reduce(state, input, now) → {state, events,
// effects, ack}. Pure apart from the position cache in rules/chess.ts (an optimisation keyed by the full move line).
// Every event sent to a room carries that room's next seq (+1 per event); spectators get moves one ply late.

import { chargeMove, ewma, freezeClocks, remainingRaw, settle, startClocks } from "../clock/clock";
import { flagCredit } from "./timers";
import { applyUci, isPromotionMove, parseUci, putChess, sideToMove, takeChess } from "../rules/chess";
import { detectEnd } from "../rules/end";
import { flagOutcome } from "../rules/insufficient";
import { projectState } from "./create";
import type { JournalLine } from "./journal";
import {
  DEFAULT_MACHINE_CONFIG,
  type Effect,
  type MachineConfig,
  type MachineInput,
  type ReduceResult,
  type RoomEvent,
  type ServerGame,
  type TimerKind,
  type TrackEvent,
} from "./state";
import { nextTimer } from "./timers";
import {
  otherSide,
  type AbortedBy,
  type Ack,
  type AckError,
  type EndMethod,
  type ServerEvent,
  type Side,
  type SocketErrorCode,
} from "./types";

type Payload<N extends ServerEvent["name"]> = Extract<ServerEvent, { name: N }>["payload"];
type NoSeq<T> = T extends { seq: number } ? Omit<T, "seq"> : T;

/**
 * Copy-on-reduce: every field the handlers mutate is copied, the rest (seats, position, prefix: never mutated) is
 * shared. ~10× cheaper than structuredClone on the move path; the "reduce never mutates its input" test guards it.
 */
export function cloneGame(s: ServerGame): ServerGame {
  const presence = (p: ServerGame["presence"]["w"]) => ({ ...p, sockets: [...p.sockets], detaches: [...p.detaches] });
  return {
    ...s,
    moves: [...s.moves],
    sans: [...s.sans],
    clocksMs: [...s.clocksMs],
    spentMs: [...s.spentMs],
    study: s.study ? { endsAt: s.study.endsAt, ready: { ...s.study.ready } } : null,
    firstMove: s.firstMove ? { ...s.firstMove } : null,
    clocks: { ...s.clocks },
    frozen: s.frozen ? { ...s.frozen } : null,
    presence: { w: presence(s.presence.w), b: presence(s.presence.b) },
    rtt: { ...s.rtt },
    lagUsed: { ...s.lagUsed },
    drawOffer: s.drawOffer ? { ...s.drawOffer } : null,
    canOfferAtPly: { ...s.canOfferAtPly },
    rematch: s.rematch ? { ...s.rematch } : null,
    result: s.result ? { ...s.result } : null,
    stats: { drawOffers: { ...s.stats.drawOffers }, premoves: { ...s.stats.premoves } },
    withheld: s.withheld ? { ...s.withheld } : null,
    acks: [...s.acks],
    timer: s.timer ? { ...s.timer } : null,
  };
}

class Ctx {
  readonly s: ServerGame;
  readonly events: RoomEvent[] = [];
  readonly effects: Effect[] = [];
  ack: Ack<Record<string, unknown>> | undefined;

  constructor(
    prev: ServerGame,
    readonly now: number,
    readonly config: MachineConfig,
  ) {
    this.s = cloneGame(prev);
  }

  /** Emits to one or both rooms with that room's next seq. */
  emit<N extends ServerEvent["name"]>(
    rooms: "game" | "spectate" | "both",
    name: N,
    payload: NoSeq<Payload<N>>,
  ): number {
    let gameSeq = 0;
    const hasSeq = name !== "spectators:update" && name !== "game:error" && name !== "server:restarting";
    if (rooms !== "spectate") {
      const p = hasSeq ? { ...payload, seq: ++this.s.seq } : payload;
      gameSeq = this.s.seq;
      this.events.push({ room: "game", event: { name, payload: p } as ServerEvent });
    }
    if (rooms !== "game") {
      const p = hasSeq ? { ...payload, seq: ++this.s.spectSeq } : payload;
      this.events.push({ room: "spectate", event: { name, payload: p } as ServerEvent });
    }
    return gameSeq;
  }

  journal(line: JournalLine) {
    this.effects.push({ type: "journal", line });
  }

  effect(e: Effect) {
    this.effects.push(e);
  }

  track(event: TrackEvent, side: Side, props: Record<string, string | number | boolean | null>) {
    this.effects.push({ type: "track", event, side, userRef: this.s.seats[side].ref, props });
  }

  fail(code: SocketErrorCode, withState = false, side?: Side, extra: Partial<AckError> = {}): void {
    const ack: AckError = { ok: false, code, ...extra };
    if (withState) ack.state = projectState(this.s, { role: "player", ...(side ? { color: side } : {}) }, this.now);
    this.ack = ack;
  }

  ok(result: Record<string, unknown> = {}) {
    this.ack = { ok: true, ...result };
  }
}

/** Applies one input. `now` is the server time in epoch ms. */
export function reduce(
  state: ServerGame,
  input: MachineInput,
  now: number,
  config: MachineConfig = DEFAULT_MACHINE_CONFIG,
): ReduceResult {
  const c = new Ctx(state, now, config);
  switch (input.type) {
    case "attach":
      attach(c, input.side, input.socketId);
      break;
    case "detach":
      detach(c, input.side, input.socketId);
      break;
    case "ready":
      ready(c, input.side);
      break;
    case "move":
      move(c, input.side, input.ply, input.uci, input.clientMoveId, input.premove === true);
      break;
    case "ping":
      c.s.rtt[input.side] = ewma(c.s.rtt[input.side], Math.max(0, input.rttMs));
      break;
    case "abort":
      abort(c, input.side);
      break;
    case "resign":
      resign(c, input.side);
      break;
    case "drawOffer":
      drawOffer(c, input.side);
      break;
    case "drawAccept":
      drawAccept(c, input.side);
      break;
    case "drawDecline":
      drawDecline(c, input.side);
      break;
    case "rematchOffer":
      rematchOffer(c, input.side, input.ent);
      break;
    case "rematchAccept":
      rematchAccept(c, input.side, input.ent);
      break;
    case "rematchDecline":
      rematchAnswer(c, input.side, "declined");
      break;
    case "rematchCancel":
      rematchAnswer(c, input.side, "cancelled");
      break;
    case "timer":
      timer(c, input.kind);
      break;
    case "freeze":
      freeze(c, input.reason);
      break;
    case "resume":
      resume(c);
      break;
    case "rematchCreated":
      rematchCreated(c, input.newRef);
      break;
    case "rematchFailed":
      rematchFailed(c, input.code);
      break;
    case "spectators":
      c.s.spectators = Math.max(0, input.count);
      break;
  }
  // One timer per game: tell the socket when the earliest deadline changed.
  const next = nextTimer(c.s, config);
  const prev = c.s.timer;
  if (!next && prev) c.effect({ type: "clearTimer" });
  else if (next && (!prev || prev.at !== next.at || prev.kind !== next.kind)) {
    c.effect({ type: "armTimer", at: next.at, kind: next.kind });
  }
  c.s.timer = next;
  const out: ReduceResult = { state: c.s, events: c.events, effects: c.effects };
  if (c.ack) out.ack = c.ack;
  return out;
}

// ── presence ──

const online = (c: Ctx, side: Side) => c.s.presence[side].sockets.length > 0;

function presenceEvent(c: Ctx, side: Side) {
  const p = c.s.presence[side];
  const payload: NoSeq<Payload<"presence:update">> = { ref: c.s.ref, side, online: p.sockets.length > 0 };
  if (p.graceEndsAt !== null) payload.graceEndsAt = p.graceEndsAt;
  c.emit("both", "presence:update", payload);
  c.journal({
    t: "pres",
    at: c.now,
    side,
    online: payload.online,
    ...(p.graceEndsAt !== null ? { grace: p.graceEndsAt } : {}),
  });
}

function graceFor(c: Ctx, side: Side): number {
  const recent = c.s.presence[side].detaches.filter((t) => c.now - t < c.config.flapWindowMs);
  return recent.length >= c.config.flapDetaches ? c.config.graceFlappingMs : c.config.graceMs;
}

function attach(c: Ctx, side: Side, socketId: string) {
  const p = c.s.presence[side];
  if (p.sockets.includes(socketId)) return;
  const wasOnline = p.sockets.length > 0;
  p.sockets.push(socketId);
  if (wasOnline) return;
  p.graceEndsAt = null;
  presenceEvent(c, side); // T11 (clears the grace) and every other phase
  const opp = otherSide(side);
  if (c.s.phase === "waiting" && online(c, opp)) {
    startGame(c); // T1
    return;
  }
  if (c.s.frozen) {
    // T20: both attached after a restore. Never during a drain: every clock stays frozen until this process exits
    // (plan 7.6 "freeze every running clock"; FIX-A: a reconnect during the drain used to unfreeze them).
    if (online(c, opp) && !c.s.draining) resume(c);
    return;
  }
  if (c.s.phase === "playing" && !online(c, opp) && c.s.presence[opp].graceEndsAt === null) {
    // T11: the opponent is offline too, so its grace starts fresh now that someone is waiting.
    c.s.presence[opp].graceEndsAt = c.now + graceFor(c, opp);
    presenceEvent(c, opp);
  }
}

function detach(c: Ctx, side: Side, socketId: string) {
  const p = c.s.presence[side];
  if (!p.sockets.includes(socketId)) return;
  p.sockets = p.sockets.filter((id) => id !== socketId);
  if (p.sockets.length > 0) return;
  p.detaches = [...p.detaches.filter((t) => c.now - t < c.config.flapWindowMs), c.now];
  const opp = otherSide(side);
  if (c.s.phase === "playing" && !c.s.frozen) {
    if (online(c, opp)) {
      p.graceEndsAt = c.now + graceFor(c, side); // T10
    } else {
      p.graceEndsAt = null; // T10b: both offline, clocks decide
      if (c.s.presence[opp].graceEndsAt !== null) {
        c.s.presence[opp].graceEndsAt = null;
        presenceEvent(c, opp);
      }
    }
  }
  presenceEvent(c, side); // T13 in study / first_move: no grace
  if (c.s.phase === "ended" && c.s.rematch && !c.s.rematch.creating) {
    const by = c.s.rematch.by;
    c.s.rematch = null; // T18: a player left
    c.emit("game", "rematch:expired", { ref: c.s.ref, by, reason: "left" });
    c.journal({ t: "rematch", at: c.now, by, what: "expired" });
    c.track("rematch_expired", by, { reason: "left" });
  }
}

// ── phases ──

function phasePayload(c: Ctx): NoSeq<Payload<"game:phase">> {
  const s = c.s;
  const payload: NoSeq<Payload<"game:phase">> = { ref: s.ref, phase: s.phase, clocks: { ...s.clocks } };
  if (s.study) payload.study = { endsAt: s.study.endsAt, ready: { ...s.study.ready } };
  if (s.firstMove) payload.firstMove = { ...s.firstMove };
  return payload;
}

function startGame(c: Ctx) {
  const s = c.s;
  if (s.studySeconds > 0) {
    s.phase = "study";
    s.study = {
      endsAt: c.now + Math.round(s.studySeconds * 1000 * c.config.studyScale),
      ready: { w: false, b: false },
    };
    c.emit("both", "game:phase", phasePayload(c));
    c.journal({ t: "phase", at: c.now, phase: "study", endsAt: s.study.endsAt });
    c.effect({ type: "checkpoint", reason: "phase" });
  } else toFirstMove(c, sideToMove(s.startFen));
}

function toFirstMove(c: Ctx, side: Side) {
  const s = c.s;
  s.phase = "first_move";
  s.study = null;
  s.firstMove = { side, deadlineAt: c.now + c.config.firstMoveMs };
  c.emit("both", "game:phase", phasePayload(c));
  c.journal({ t: "phase", at: c.now, phase: "first_move", endsAt: s.firstMove.deadlineAt, side });
  c.effect({ type: "checkpoint", reason: "phase" });
}

function toPlaying(c: Ctx) {
  const s = c.s;
  s.phase = "playing";
  s.firstMove = null;
  s.startedAt = c.now;
  s.clocks = startClocks(s.clocks, s.tc ? s.turn : null, c.now);
  c.emit("both", "game:phase", phasePayload(c));
  c.journal({ t: "phase", at: c.now, phase: "playing" });
  c.effect({ type: "checkpoint", reason: "phase" });
  // T13 gives no grace in first_move, so a side that left then has none yet: start it now that play has begun, as
  // resume() does after a restore (FIX-A: the opponent otherwise waited out the absent side's whole clock).
  startAbsentGrace(c);
  const tc = s.tc ? `${s.tc.initialMs / 60_000}+${s.tc.incrementMs / 1000}` : "untimed";
  for (const side of ["w", "b"] as const) {
    c.track("game_started", side, { rated: s.rated, tc, study_s: s.studySeconds, start: s.startKind });
  }
}

function ready(c: Ctx, side: Side) {
  const s = c.s;
  if (s.phase !== "study" || !s.study) return c.fail(s.phase === "ended" ? "ended" : "phase");
  if (!s.study.ready[side]) {
    s.study.ready[side] = true;
    c.emit("game", "study:ready", { ref: s.ref, side });
    c.journal({ t: "ready", at: c.now, side });
  }
  c.ok({ ready: { ...s.study.ready } });
  if (s.study.ready.w && s.study.ready.b) toFirstMove(c, sideToMove(s.startFen)); // T3 early
}

// ── moves ──

function releaseWithheld(c: Ctx) {
  const w = c.s.withheld;
  if (!w) return;
  c.s.withheld = null;
  const payload: NoSeq<Payload<"move:applied">> = {
    ref: c.s.ref,
    ply: w.ply,
    uci: w.uci,
    san: w.san,
    by: w.by,
    // Spectators replay the clock timeline one move late: values at that ply, running for the side to move then.
    // Clocks run only after both first moves (ply ≥ 2) and until the end.
    clocks: {
      w: w.w,
      b: w.b,
      run: c.s.tc && w.ply - c.s.startPly >= 2 && c.s.phase !== "ended" ? otherSide(w.by) : null,
      at: c.now,
    },
  };
  if (w.check) payload.check = true;
  c.emit("spectate", "move:applied", payload);
}

function move(c: Ctx, side: Side, ply: number, uci: string, clientMoveId: string, premove: boolean) {
  const s = c.s;
  const dup = s.acks.find((a) => a.id === clientMoveId && a.side === side);
  if (dup) return c.ok({ ...dup.ack });
  if (s.phase === "ended") return c.fail("ended", true, side);
  if ((s.phase !== "first_move" && s.phase !== "playing") || s.frozen) return c.fail("phase");
  const toMove = s.phase === "first_move" ? s.firstMove!.side : s.turn;
  if (side !== toMove) return c.fail("not_your_turn");
  // Wire plies are absolute (startPly + plies played), as in @repo/contracts/socket.
  if (ply !== s.startPly + s.moves.length) return c.fail("stale_ply", true, side);
  const parsed = parseUci(uci);
  if (!parsed) return c.fail("illegal", true, side);
  if (isPromotionMove(s.fen, parsed.from, parsed.to) && !parsed.promotion) return c.fail("promotion_required");

  // The clock decides before the board: a move after the flag is a flag (T7 → T8).
  let charge: ReturnType<typeof chargeMove> | null = null;
  if (s.phase === "playing" && s.tc) {
    charge = chargeMove({
      clocks: s.clocks,
      mover: side,
      now: c.now,
      premove,
      rttMs: s.rtt[side],
      lagUsedMs: s.lagUsed[side],
      initialMs: s.tc.initialMs,
      incrementMs: s.tc.incrementMs,
      rules: c.config.clock,
    });
    if (charge.flagged) {
      flag(c, side);
      return c.fail("ended", true, side);
    }
  }

  const chess = takeChess(s.startFen, s.moves);
  const mv = applyUci(chess, uci);
  if (!mv) {
    putChess(s.startFen, s.moves, chess);
    return c.fail("illegal", true, side);
  }
  const normalized = `${mv.from}${mv.to}${mv.promotion ?? ""}`;
  s.moves.push(normalized);
  s.sans.push(mv.san);
  putChess(s.startFen, s.moves, chess);
  s.fen = chess.fen();
  s.turn = chess.turn();
  s.inCheck = chess.inCheck();
  const n = s.moves.length; // plies played in this game
  const newPly = s.startPly + n; // absolute ply of this move (the wire value)

  if (charge && !charge.flagged) {
    s.clocks = charge.clocks;
    s.clocksMs.push(charge.clockMs);
    s.spentMs.push(charge.spentMs);
    s.lagUsed[side] += charge.lagCreditMs;
  } else {
    if (s.tc) s.clocksMs.push(s.clocks[side]); // first moves: clocks frozen, no spend, no increment (T4)
    s.spentMs.push(0);
  }
  if (premove) s.stats.premoves[side]++;

  // Implicit decline: the receiver of an open offer moved (T7).
  let drawCleared = false;
  if (s.drawOffer && s.drawOffer.by !== side) {
    const offerer = s.drawOffer.by;
    s.drawOffer = null;
    s.canOfferAtPly[offerer] = newPly + c.config.drawCooldownPlies;
    drawCleared = true;
  }

  const payload: NoSeq<Payload<"move:applied">> = {
    ref: s.ref,
    ply: newPly,
    uci: normalized,
    san: mv.san,
    by: side,
    clocks: { ...s.clocks },
  };
  if (s.inCheck) payload.check = true;
  if (premove) payload.premove = true;
  if (drawCleared) payload.drawOfferCleared = true;
  const seq = c.emit("game", "move:applied", payload);
  releaseWithheld(c);
  s.withheld = {
    ply: newPly,
    uci: normalized,
    san: mv.san,
    by: side,
    w: s.clocks.w,
    b: s.clocks.b,
    check: s.inCheck,
    at: c.now,
  };
  c.journal({
    t: "ply",
    n,
    uci: normalized,
    san: mv.san,
    clk: s.tc ? s.clocksMs[s.clocksMs.length - 1]! : null,
    spent: s.spentMs[s.spentMs.length - 1]!,
    at: c.now,
    ...(premove ? { pm: 1 as const } : {}),
  });
  if (drawCleared) {
    const offerer = otherSide(side);
    c.emit("game", "draw:declined", { ref: s.ref, by: side, canOfferAtPly: s.canOfferAtPly[offerer], implicit: true });
    c.journal({ t: "drawx", at: c.now, by: side, canAt: s.canOfferAtPly[offerer], implicit: 1 });
  }
  const ack = { seq, ply: newPly, san: mv.san, clocks: { ...s.clocks }, clientMoveId };
  s.acks = [...s.acks, { id: clientMoveId, side, ack }].slice(-c.config.ackMemory);
  c.ok({ ...ack });
  c.effect({ type: "checkpoint", reason: "move" });

  const end = detectEnd(chess); // plan 8.5, after every move including first moves
  if (end) return endGame(c, end.winner, end.method);
  if (s.phase === "first_move") {
    if (n === 1) toFirstMove(c, otherSide(side));
    else toPlaying(c);
  }
}

// ── endings ──

/**
 * `culprit`: for a timeout abort, the side whose move or presence was missing (the first-move side, or the absent
 * player under two plies); `game_aborted.by` is `self` for it and `opponent` for the other side (plan 10.1).
 */
function endGame(
  c: Ctx,
  winner: Side | null,
  method: EndMethod,
  abortedBy: AbortedBy | null = null,
  culprit: Side | null = null,
) {
  const s = c.s;
  if (s.phase === "ended") return;
  s.phase = "ended";
  if (s.frozen) {
    s.clocks = { ...s.clocks, run: null };
    s.frozen = null;
  } else {
    const settled = settle(s.clocks, c.now);
    s.clocks = { w: Math.max(0, settled.w), b: Math.max(0, settled.b), run: null, at: c.now };
  }
  s.study = null;
  s.firstMove = null;
  s.drawOffer = null;
  s.presence.w.graceEndsAt = null;
  s.presence.b.graceEndsAt = null;
  s.abortedBy = abortedBy;
  const absPly = s.startPly + s.moves.length;
  s.result = { winner, method, ply: absPly, endedAt: c.now, ...(abortedBy ? { abortedBy } : {}) };
  releaseWithheld(c);
  c.emit("both", "game:ended", {
    ref: s.ref,
    winner,
    method,
    ply: absPly,
    endedAt: c.now,
    finalFen: s.fen,
    clocks: { ...s.clocks },
    rated: false,
    ...(abortedBy ? { abortedBy } : {}),
  });
  c.journal({ t: "end", at: c.now, method, winner, ply: s.moves.length, ...(abortedBy ? { by: abortedBy } : {}) });
  if (method === "aborted") {
    c.effect({ type: "abortPersist", result: { ...s.result }, abortedBy: abortedBy ?? "timeout" });
    for (const side of ["w", "b"] as const) {
      c.track("game_aborted", side, {
        reason: abortedBy === "timeout" || abortedBy === "stale" ? abortedBy : "player",
        by: abortedBy === side || culprit === side ? "self" : "opponent",
      });
    }
  } else {
    c.effect({ type: "finish", result: { ...s.result } });
    for (const side of ["w", "b"] as const) {
      c.track("game_ended", side, {
        method,
        result: winner === null ? "draw" : winner === side ? "win" : "loss",
        plies: s.moves.length,
        duration_ms: s.startedAt === null ? 0 : c.now - s.startedAt,
        draw_offers: s.stats.drawOffers[side],
        premoves: s.stats.premoves[side],
      });
    }
  }
}

function flag(c: Ctx, side: Side) {
  const s = c.s;
  s.clocks = { ...settle(s.clocks, c.now), [side]: 0 } as typeof s.clocks;
  const o = flagOutcome(s.fen, side); // T8: timeout vs insufficient (plan 8.9)
  endGame(c, o.winner, o.method);
}

function abort(c: Ctx, side: Side) {
  const s = c.s;
  if (s.phase === "ended") return c.fail("ended");
  if (s.phase !== "first_move" || !s.firstMove) return c.fail("phase");
  if (s.firstMove.side !== side) return c.fail("not_allowed"); // T6 (owner Q2 default)
  c.ok();
  endGame(c, null, "aborted", side);
}

function resign(c: Ctx, side: Side) {
  const s = c.s;
  if (s.phase === "ended") return c.fail("ended");
  if (s.phase === "first_move") {
    // T9b: before your first move, resigning is aborting; after it, not allowed.
    const firstMover = sideToMove(s.startFen);
    const moved = s.moves.length >= 1 && side === firstMover;
    if (moved) return c.fail("not_allowed");
    c.ok();
    return endGame(c, null, "aborted", side);
  }
  if (s.phase !== "playing") return c.fail("phase");
  c.ok();
  endGame(c, otherSide(side), "resignation"); // T9
}

// ── draws ──

function drawOffer(c: Ctx, side: Side) {
  const s = c.s;
  if (s.phase === "ended") return c.fail("ended");
  if (s.phase !== "playing") return c.fail("phase");
  if (s.drawOffer?.by === side) return c.ok({ drawOffer: { ...s.drawOffer } });
  if (s.drawOffer && s.drawOffer.by !== side) {
    c.ok({ drawOffer: null }); // T14: a counter-offer is an accept
    return endGame(c, null, "agreement");
  }
  const ply = s.startPly + s.moves.length;
  if (ply < s.canOfferAtPly[side]) {
    return c.fail("draw_cooldown", false, side, { canOfferAtPly: s.canOfferAtPly[side] });
  }
  s.drawOffer = { by: side, ply };
  s.stats.drawOffers[side]++;
  c.emit("game", "draw:offered", { ref: s.ref, by: side });
  c.journal({ t: "draw", at: c.now, by: side, ply });
  c.ok({ drawOffer: { ...s.drawOffer } });
}

function drawAccept(c: Ctx, side: Side) {
  const s = c.s;
  if (s.phase === "ended") return c.fail("ended");
  if (s.phase !== "playing" || !s.drawOffer || s.drawOffer.by === side) return c.fail("no_offer"); // socket F-01
  c.ok();
  endGame(c, null, "agreement"); // T15
}

function drawDecline(c: Ctx, side: Side) {
  const s = c.s;
  if (s.phase !== "playing" || !s.drawOffer || s.drawOffer.by === side) return c.fail("no_offer");
  const offerer = s.drawOffer.by;
  s.drawOffer = null;
  s.canOfferAtPly[offerer] = s.startPly + s.moves.length + c.config.drawCooldownPlies;
  c.emit("game", "draw:declined", { ref: s.ref, by: side, canOfferAtPly: s.canOfferAtPly[offerer], implicit: false });
  c.journal({ t: "drawx", at: c.now, by: side, canAt: s.canOfferAtPly[offerer] });
  c.ok();
}

// ── rematch ──

function rematchAllowed(c: Ctx): SocketErrorCode | null {
  const s = c.s;
  if (s.phase !== "ended") return "phase";
  if (s.mode !== "FRIEND" && s.mode !== "ONLINE") return "not_allowed";
  if (s.result?.method === "aborted") return "not_allowed";
  if (s.rematchDone) return "not_allowed";
  if (s.draining) return "draining";
  if (!online(c, "w") || !online(c, "b")) return "not_allowed";
  return null;
}

function rematchOffer(c: Ctx, side: Side, ent?: { w: number; b: number }) {
  const s = c.s;
  const err = rematchAllowed(c);
  if (err) return c.fail(err);
  if (s.rematch?.by === side) return c.ok({ expiresAt: s.rematch.expiresAt });
  if (s.rematch && !s.rematch.creating && c.now < s.rematch.expiresAt) {
    // Crossing offers accept (plan 8.8).
    return rematchAccept(c, side, ent ?? { w: Number.MAX_SAFE_INTEGER, b: Number.MAX_SAFE_INTEGER });
  }
  if (s.rematch?.creating) return c.fail("not_allowed");
  if (s.rematchOffersUsed >= c.config.rematchMaxOffers) return c.fail("not_allowed");
  s.rematchOffersUsed++;
  s.rematch = { by: side, expiresAt: c.now + c.config.rematchMs, creating: false };
  c.emit("game", "rematch:offered", { ref: s.ref, by: side, expiresAt: s.rematch.expiresAt, youPlay: side });
  c.journal({ t: "rematch", at: c.now, by: side, what: "offered" });
  c.ok({ expiresAt: s.rematch.expiresAt });
}

function rematchAccept(c: Ctx, side: Side, ent: { w: number; b: number }) {
  const s = c.s;
  if (s.phase !== "ended") return c.fail("phase");
  if (!s.rematch || s.rematch.by === side || s.rematch.creating) return c.fail("no_offer");
  if (c.now >= s.rematch.expiresAt) return c.fail("expired");
  if (s.draining) return c.fail("draining");
  const nowSec = c.now / 1000;
  if (!(ent[side] > nowSec)) return c.fail("not_member");
  if (!(ent[otherSide(side)] > nowSec)) return c.fail("paywall");
  s.rematch.creating = true;
  c.effect({ type: "createRematch", offeredBy: s.rematch.by, acceptedBy: side }); // T17; ack after rematchCreated
}

function rematchCreated(c: Ctx, newRef: string) {
  const s = c.s;
  if (!s.rematch?.creating) return;
  const by = s.rematch.by;
  s.rematch = null;
  s.rematchDone = true;
  c.emit("game", "rematch:started", { ref: s.ref, newRef, colors: { w: s.seats.b.ref ?? "", b: s.seats.w.ref ?? "" } });
  c.journal({ t: "rematch", at: c.now, by, what: "started", newRef });
  c.ok({ newRef });
}

function rematchFailed(c: Ctx, code: SocketErrorCode = "internal") {
  const s = c.s;
  if (!s.rematch?.creating) return;
  const by = s.rematch.by;
  s.rematch = null;
  c.emit("game", "rematch:cancelled", { ref: s.ref, by });
  c.journal({ t: "rematch", at: c.now, by, what: "cancelled" });
  c.fail(code);
}

function rematchAnswer(c: Ctx, side: Side, what: "declined" | "cancelled") {
  const s = c.s;
  const r = s.rematch;
  const mine = what === "cancelled";
  if (!r || r.creating || (mine ? r.by !== side : r.by === side)) return c.fail("no_offer");
  s.rematch = null;
  c.emit("game", what === "declined" ? "rematch:declined" : "rematch:cancelled", { ref: s.ref, by: side });
  c.journal({ t: "rematch", at: c.now, by: side, what });
  c.ok();
}

// ── timers, freeze, resume ──

function timer(c: Ctx, kind?: TimerKind) {
  const s = c.s;
  const due = (k: TimerKind) => kind === undefined || kind === k;
  if (due("resume") && s.frozen?.resumeBy != null && c.now >= s.frozen.resumeBy && !s.draining) resume(c);
  if (s.frozen) return;
  if (due("study_end") && s.phase === "study" && s.study && c.now >= s.study.endsAt) {
    toFirstMove(c, sideToMove(s.startFen)); // T3
  }
  if (due("first_move_deadline") && s.phase === "first_move" && s.firstMove && c.now >= s.firstMove.deadlineAt) {
    endGame(c, null, "aborted", "timeout", s.firstMove.side); // T5
  }
  if (
    due("flag") &&
    s.phase === "playing" &&
    s.tc &&
    s.clocks.run &&
    remainingRaw(s.clocks, s.clocks.run, c.now) + flagCredit(s, s.clocks.run, c.config) <= 0
  ) {
    flag(c, s.clocks.run); // T8
  }
  if (due("grace") && s.phase === "playing") {
    for (const side of ["w", "b"] as const) {
      const g = s.presence[side].graceEndsAt;
      if (s.phase !== "playing" || g === null || c.now < g || online(c, side)) continue;
      // T12: fewer than two plies → aborted, else the absent side loses.
      if (s.moves.length < 2) endGame(c, null, "aborted", "timeout", side);
      else endGame(c, otherSide(side), "abandoned");
    }
  }
  if (due("rematch") && s.phase === "ended" && s.rematch && !s.rematch.creating && c.now >= s.rematch.expiresAt) {
    const by = s.rematch.by;
    s.rematch = null; // T18
    c.emit("game", "rematch:expired", { ref: s.ref, by, reason: "timeout" });
    c.journal({ t: "rematch", at: c.now, by, what: "expired" });
    c.track("rematch_expired", by, { reason: "timeout" });
  }
}

function freeze(c: Ctx, reason: "drain" | "restore") {
  const s = c.s;
  if (reason === "drain") s.draining = true;
  if (s.phase === "ended" || s.frozen) return;
  const f = freezeClocks(s.clocks, c.now); // T19
  s.clocks = f.clocks;
  s.frozen = {
    since: c.now,
    reason: "restart",
    run: f.run,
    resumeBy: reason === "restore" ? c.now + c.config.resumeMaxWaitMs : null,
  };
  c.emit("both", "clock:sync", { ref: s.ref, clocks: { ...s.clocks }, frozen: { since: c.now, reason: "restart" } });
  c.journal({ t: "freeze", at: c.now, w: s.clocks.w, b: s.clocks.b });
  c.effect({ type: "checkpoint", reason: "freeze" });
}

function resume(c: Ctx) {
  const s = c.s;
  const f = s.frozen;
  if (!f) return;
  const d = c.now - f.since; // T20: every deadline moves by the frozen time
  if (s.study) s.study.endsAt += d;
  if (s.firstMove) s.firstMove.deadlineAt += d;
  for (const side of ["w", "b"] as const) {
    const p = s.presence[side];
    if (p.graceEndsAt !== null) p.graceEndsAt += d;
  }
  if (s.rematch) s.rematch.expiresAt += d;
  s.clocks = startClocks(s.clocks, s.phase === "playing" && s.tc ? f.run : null, c.now);
  s.frozen = null;
  c.emit("both", "clock:sync", { ref: s.ref, clocks: { ...s.clocks } });
  c.journal({ t: "resume", at: c.now });
  // After a restore, the normal presence rules apply: grace for an absent side while the other is here.
  startAbsentGrace(c);
}

/** In `playing`: a side that is offline while its opponent is online gets its reconnect grace (T10). */
function startAbsentGrace(c: Ctx) {
  const s = c.s;
  if (s.phase !== "playing" || s.frozen) return;
  for (const side of ["w", "b"] as const) {
    const opp = otherSide(side);
    if (!online(c, side) && online(c, opp) && s.presence[side].graceEndsAt === null) {
      s.presence[side].graceEndsAt = c.now + graceFor(c, side);
      presenceEvent(c, side);
    }
  }
}
