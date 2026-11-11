// Server machine (plan 8.1): every transition T1–T20 with a fake `now`, plus the plan 12.1 cases.
import assert from "node:assert/strict";
import { test } from "node:test";
import { projectState, restoreGame, progressFromJournal } from "../src/machine/create";
import { foldJournal, type JournalLine } from "../src/machine/journal";
import { reduce } from "../src/machine/reduce";
import { DEFAULT_MACHINE_CONFIG, type Effect } from "../src/machine/state";
import { nextTimer } from "../src/machine/timers";
import type { MoveApplied } from "../src/machine/types";
import { INITIAL_FEN } from "../src/constants";
import { LEGEND_FEN, LEGEND_MOVES, Live, MAIN, T0, gameInput } from "./helpers";

const BLACK_START = "r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R b KQkq - 3 10";
const tracks = (effects: Effect[], event: string) => effects.filter((e) => e.type === "track" && e.event === event);

test("T1: both online → first_move for the side to move (no study on the initial position)", () => {
  const g = new Live();
  g.do({ type: "attach", side: "w", socketId: "w1" });
  assert.equal(g.s.phase, "waiting");
  assert.deepEqual(g.lastNames(), ["presence:update"]);
  g.do({ type: "attach", side: "b", socketId: "b1" }, 500);
  assert.equal(g.s.phase, "first_move");
  assert.deepEqual(g.s.firstMove, { side: "w", deadlineAt: T0 + 500 + 30_000 });
  assert.deepEqual(g.lastNames(), ["presence:update", "game:phase"]);
  assert.deepEqual(
    g.last.effects.find((e) => e.type === "armTimer"),
    { type: "armTimer", at: T0 + 30_500, kind: "first_move_deadline" },
  );
});

test("T1–T3: a legend start studies 30 s; both ready ends it early; the timer ends it otherwise", () => {
  const g = new Live({ startFen: LEGEND_FEN, studySeconds: 30, startKind: "position" }).join();
  assert.equal(g.s.phase, "study");
  assert.equal(g.s.study?.endsAt, T0 + 30_000);
  g.do({ type: "ready", side: "w" }, 2_000);
  assert.deepEqual(g.last.ack, { ok: true, ready: { w: true, b: false } });
  assert.deepEqual(g.lastNames(), ["study:ready"]);
  assert.equal(g.lastNames("spectate").length, 0, "study:ready goes to the game room only");
  g.do({ type: "ready", side: "w" });
  assert.equal(g.last.events.length, 0, "ready twice is idempotent");
  g.do({ type: "ready", side: "b" }, 1_000);
  assert.equal(g.s.phase, "first_move");
  assert.deepEqual(g.s.firstMove, { side: "w", deadlineAt: T0 + 3_000 + 30_000 });

  const t = new Live({ startFen: LEGEND_FEN, studySeconds: 30 }).join();
  t.do({ type: "timer" }, 29_999);
  assert.equal(t.s.phase, "study", "an early fire is a no-op");
  t.do({ type: "timer" }, 1);
  assert.equal(t.s.phase, "first_move");
  assert.equal(t.do({ type: "ready", side: "w" }).ack?.ok, false);
});

test("T4: first-move order for a Black-to-move start; clocks frozen until both have moved", () => {
  const g = new Live({ startFen: BLACK_START, studySeconds: 30 }).join();
  g.do({ type: "timer" }, 30_000);
  assert.equal(g.s.firstMove?.side, "b");
  assert.equal(g.move("w", "e1e2").ack?.ok, false);
  assert.equal(g.last.ack && !g.last.ack.ok && g.last.ack.code, "not_your_turn");
  g.move("b", "g8f6", 10_000);
  assert.equal(g.s.phase, "first_move");
  assert.equal(g.s.firstMove?.side, "w");
  assert.deepEqual([g.s.clocks.w, g.s.clocks.b, g.s.clocks.run], [300_000, 300_000, null]);
  assert.deepEqual(g.s.clocksMs, [300_000], "first moves record the untouched clock");
  g.move("w", "b1c3", 20_000);
  assert.equal(g.s.phase, "playing");
  assert.deepEqual(g.s.clocks, { w: 300_000, b: 300_000, run: "b", at: g.now });
  assert.deepEqual(g.lastNames(), ["move:applied", "game:phase"]);
  assert.equal(tracks(g.last.effects, "game_started").length, 2);
});

test("T5: no first move within 30 s → aborted (unrated), persisted as an abort", () => {
  const g = new Live().join();
  g.do({ type: "timer" }, 30_000);
  assert.equal(g.s.phase, "ended");
  assert.deepEqual(g.s.result, { winner: null, method: "aborted", ply: 0, endedAt: g.now, abortedBy: "timeout" });
  const ab = g.last.effects.find((e) => e.type === "abortPersist");
  assert.deepEqual(ab && ab.type === "abortPersist" && ab.abortedBy, "timeout");
  assert.ok(!g.last.effects.some((e) => e.type === "finish"));
  assert.deepEqual(
    tracks(g.last.effects, "game_aborted").map((e) => e.type === "track" && e.props.reason),
    ["timeout", "timeout"],
  );
  // regression: REGRESSION-2 — `by` was "opponent" for both players; the side that did not move is `self`.
  assert.deepEqual(
    tracks(g.last.effects, "game_aborted").map((e) => e.type === "track" && [e.side, e.props.by]),
    [
      ["w", "self"],
      ["b", "opponent"],
    ],
  );
});

test("T6/T9b: abort by the side to move only; resign in first_move is an abort before your first move", () => {
  const g = new Live().join();
  assert.equal(g.do({ type: "abort", side: "b" }).ack?.ok, false);
  assert.equal(g.last.ack && !g.last.ack.ok && g.last.ack.code, "not_allowed");
  g.do({ type: "abort", side: "w" });
  assert.equal(g.s.result?.method, "aborted");
  assert.equal(g.s.result?.abortedBy, "w");

  const r = new Live().join();
  r.move("w", "e2e4", 1_000);
  assert.equal(r.do({ type: "resign", side: "w" }).ack?.ok, false, "white already moved");
  r.do({ type: "resign", side: "b" });
  assert.equal(r.s.result?.method, "aborted");
  assert.equal(r.s.result?.abortedBy, "b");
  assert.equal(
    r.do({ type: "resign", side: "w" }).ack && !r.last.ack!.ok && (r.last.ack as { code: string }).code,
    "ended",
  );
});

test("T7: a move charges the clock, adds the increment, records clockMs/spentMs and starts the opponent", () => {
  const g = new Live().join().firstMoves("e2e4", "e7e5");
  const t = g.now;
  g.move("w", "g1f3", 5_000);
  const ack = g.last.ack as { ok: true; seq: number; ply: number; san: string; clocks: unknown; clientMoveId: string };
  assert.equal(ack.ply, 3);
  assert.equal(ack.san, "Nf3");
  // RTT starts at 150 ms → 75 ms lag credit.
  assert.equal(g.s.spentMs.at(-1), 5_000 - 75);
  assert.equal(g.s.clocksMs.at(-1), 300_000 - 4_925 + 3_000);
  assert.deepEqual(g.s.clocks, { w: 298_075, b: 300_000, run: "b", at: t + 5_000 });
  const applied = g.last.events.find((e) => e.room === "game")!.event.payload as MoveApplied;
  assert.equal(applied.seq, ack.seq);
  assert.ok(
    !("check" in applied) && !("premove" in applied) && !("drawOfferCleared" in applied),
    "false booleans are omitted",
  );
});

test("ping updates the RTT EWMA used for lag credit; a premove gets none and costs ≥ 100 ms", () => {
  const g = new Live().join().firstMoves("e2e4", "e7e5");
  g.do({ type: "ping", side: "w", rttMs: 400 });
  assert.equal(g.s.rtt.w, 150 + 0.2 * 250);
  g.move("w", "g1f3", 1_000);
  assert.equal(g.s.spentMs.at(-1), 1_000 - 100);
  g.move("b", "b8c6", 0, { premove: true });
  assert.equal(g.s.spentMs.at(-1), 100);
  assert.equal(g.s.stats.premoves.b, 1);
  const applied = g.last.events.find((e) => e.room === "game")!.event.payload as MoveApplied;
  assert.equal(applied.premove, true);
});

test("T8: the flag timer ends on time; a flag against bare king is a draw", () => {
  const g = new Live({ tc: { initialMs: 10_000, incrementMs: 0 } }).join().firstMoves("e2e4", "e7e5");
  assert.equal(nextTimer(g.s)?.kind, "flag");
  // The flag waits for the lag credit a move sent now would get (RTT start 150 ms → 75 ms; FIX-A) plus the slack.
  assert.equal(nextTimer(g.s)?.at, g.now + 10_000 + 75 + 20);
  g.do({ type: "timer" }, 9_000);
  assert.equal(g.s.phase, "playing");
  g.do({ type: "timer" }, 1_020);
  assert.equal(g.s.phase, "playing", "within the lag credit");
  g.do({ type: "timer" }, 75);
  assert.deepEqual([g.s.result?.method, g.s.result?.winner], ["timeout", "b"]);
  assert.equal(g.s.clocks.w, 0);

  // White to move with only K+R vs bare K: White flags → timeout_vs_insufficient.
  const fen = "7R/8/4k3/8/8/2K5/8/7r b - - 0 79";
  const d = new Live({ startFen: fen, studySeconds: 0, tc: { initialMs: 10_000, incrementMs: 0 } }).join();
  d.move("b", "h1h2", 100);
  d.move("w", "h8h2", 100); // both first moves; Black to move, clocks start
  d.move("b", "e6d5", 1_000);
  d.do({ type: "timer" }, 20_000);
  assert.deepEqual([d.s.result?.method, d.s.result?.winner], ["timeout_vs_insufficient", null]);
});

test("a move that arrives after the flag time is a flag, not a move", () => {
  const g = new Live({ tc: { initialMs: 5_000, incrementMs: 0 } }).join().firstMoves("e2e4", "e7e5");
  g.do({ type: "ping", side: "w", rttMs: 0 });
  g.do({ type: "ping", side: "w", rttMs: 0 });
  g.move("w", "g1f3", 6_000);
  assert.equal(g.last.ack && !g.last.ack.ok && g.last.ack.code, "ended");
  assert.equal(g.s.result?.method, "timeout");
  assert.equal(g.s.moves.length, 2);
});

test("move validation: duplicate clientMoveId is a no-op; stale_ply, illegal and promotion_required", () => {
  const g = new Live().join();
  g.move("w", "e2e4", 1_000, { clientMoveId: "dup" });
  const first = g.last.ack;
  const seq = g.s.seq;
  g.do({ type: "move", side: "w", ply: 0, uci: "e2e4", clientMoveId: "dup" });
  assert.deepEqual(g.last.ack, first);
  assert.equal(g.last.events.length, 0);
  assert.equal(g.s.seq, seq);
  g.do({ type: "move", side: "b", ply: 0, uci: "e7e5", clientMoveId: "x" });
  const stale = g.last.ack as { ok: false; code: string; state?: { moves: string } };
  assert.equal(stale.code, "stale_ply");
  assert.equal(stale.state?.moves, "e2e4");
  g.do({ type: "move", side: "b", ply: 1, uci: "e7e4", clientMoveId: "y" });
  assert.equal((g.last.ack as { code: string }).code, "illegal");
  assert.ok((g.last.ack as { state?: unknown }).state);
  assert.equal(g.s.moves.length, 1);

  const p = new Live({ startFen: "8/1P5k/8/8/8/8/6K1/8 w - - 0 41" }).join();
  p.do({ type: "move", side: "w", ply: p.s.startPly, uci: "b7b8", clientMoveId: "p1" });
  assert.equal((p.last.ack as { code: string }).code, "promotion_required");
  p.do({ type: "move", side: "w", ply: p.s.startPly, uci: "b7b8n", clientMoveId: "p2" });
  assert.equal(p.s.sans[0], "b8=N");
});

test("T10/T11/T12: grace 30 s, abandoned with the right winner; reattach clears it", () => {
  const g = new Live().join().firstMoves("e2e4", "e7e5");
  g.do({ type: "detach", side: "b", socketId: "b1" }, 1_000);
  assert.equal(g.s.presence.b.graceEndsAt, g.now + 30_000);
  const pres = g.last.events.find((e) => e.room === "game")!.event.payload as { online: boolean; graceEndsAt?: number };
  assert.deepEqual([pres.online, pres.graceEndsAt], [false, g.now + 30_000]);
  g.do({ type: "attach", side: "b", socketId: "b2" }, 5_000);
  assert.equal(g.s.presence.b.graceEndsAt, null);
  g.do({ type: "detach", side: "b", socketId: "b2" }, 1_000);
  g.do({ type: "timer" }, 30_000);
  assert.deepEqual([g.s.result?.method, g.s.result?.winner], ["abandoned", "w"]);
});

test("T10: a flapping player (≥ 3 detaches in 120 s) gets 10 s", () => {
  const g = new Live().join().firstMoves("e2e4", "e7e5");
  for (let i = 0; i < 2; i++) {
    g.do({ type: "detach", side: "b", socketId: `b${i === 0 ? 1 : "x" + i}` }, 1_000);
    g.do({ type: "attach", side: "b", socketId: `bx${i + 1}` }, 1_000);
  }
  g.do({ type: "detach", side: "b", socketId: "bx2" }, 1_000);
  assert.equal(g.s.presence.b.graceEndsAt, g.now + 10_000);
});

test("T10b/T11: both offline cancels grace (clocks decide); the first to return starts the other's grace", () => {
  const g = new Live().join().firstMoves("e2e4", "e7e5");
  g.do({ type: "detach", side: "b", socketId: "b1" }, 1_000);
  g.do({ type: "detach", side: "w", socketId: "w1" }, 1_000);
  assert.equal(g.s.presence.b.graceEndsAt, null);
  assert.equal(g.s.presence.w.graceEndsAt, null);
  assert.equal(nextTimer(g.s)?.kind, "flag");
  g.do({ type: "attach", side: "w", socketId: "w2" }, 1_000);
  assert.equal(g.s.presence.b.graceEndsAt, g.now + 30_000);
});

test("T13: a disconnect during study or the first-move window has no grace", () => {
  const g = new Live({ startFen: LEGEND_FEN, studySeconds: 30 }).join();
  g.do({ type: "detach", side: "b", socketId: "b1" }, 1_000);
  assert.equal(g.s.presence.b.graceEndsAt, null);
  g.do({ type: "timer" }, 29_000);
  assert.equal(g.s.phase, "first_move", "the study timer keeps running");
});

test("T14/T15: draw offer, decline with cooldown at ply + 4, accept, accept without an offer (F-01)", () => {
  const g = new Live().join().firstMoves("e2e4", "e7e5");
  assert.equal((g.do({ type: "drawAccept", side: "b" }).ack as { code: string }).code, "no_offer");
  g.do({ type: "drawOffer", side: "w" });
  assert.deepEqual(g.s.drawOffer, { by: "w", ply: 2 });
  assert.deepEqual(g.lastNames(), ["draw:offered"]);
  assert.equal(g.lastNames("spectate").length, 0, "spectators never see offers");
  assert.equal(
    (g.do({ type: "drawAccept", side: "w" }).ack as { code: string }).code,
    "no_offer",
    "the offerer cannot accept",
  );
  g.do({ type: "drawDecline", side: "b" });
  assert.equal(g.s.canOfferAtPly.w, 6);
  assert.equal(
    (g.do({ type: "drawOffer", side: "w" }).ack as { code: string; canOfferAtPly: number }).canOfferAtPly,
    6,
  );
  g.move("w", "g1f3");
  g.move("b", "b8c6");
  g.move("w", "f1c4");
  g.move("b", "g8f6");
  assert.equal(g.do({ type: "drawOffer", side: "w" }).ack?.ok, true);
  g.do({ type: "drawAccept", side: "b" });
  assert.deepEqual([g.s.result?.method, g.s.result?.winner], ["agreement", null]);
});

test("T7/T14: the receiver moving declines implicitly; crossing offers accept", () => {
  const g = new Live().join().firstMoves("e2e4", "e7e5");
  g.do({ type: "drawOffer", side: "w" });
  g.move("w", "g1f3"); // the offerer's own move keeps the offer
  assert.ok(g.s.drawOffer);
  g.move("b", "b8c6");
  assert.equal(g.s.drawOffer, null);
  assert.equal(g.s.canOfferAtPly.w, 4 + 4);
  assert.deepEqual(g.lastNames(), ["move:applied", "draw:declined"]);
  const applied = g.last.events[0]!.event.payload as MoveApplied;
  assert.equal(applied.drawOfferCleared, true);
  const dec = g.last.events.find((e) => e.event.name === "draw:declined")!.event.payload as { implicit: boolean };
  assert.equal(dec.implicit, true);

  const c = new Live().join().firstMoves("e2e4", "e7e5");
  c.do({ type: "drawOffer", side: "b" });
  c.do({ type: "drawOffer", side: "w" });
  assert.equal(c.s.result?.method, "agreement");
});

test("T9: resignation; the end reaches both rooms and persists with finish", () => {
  const g = new Live().join().firstMoves("e2e4", "e7e5");
  g.do({ type: "resign", side: "w" }, 3_000);
  assert.deepEqual([g.s.result?.method, g.s.result?.winner], ["resignation", "b"]);
  assert.ok(g.lastNames().includes("game:ended"));
  assert.ok(g.lastNames("spectate").includes("game:ended"));
  assert.ok(g.last.effects.some((e) => e.type === "finish"));
  const ended = tracks(g.last.effects, "game_ended").map((e) => e.type === "track" && e.props.result);
  assert.deepEqual(ended, ["loss", "win"]);
});

test("the Opera Game from the legend position: study, first moves, 15 plies to mate; seq +1 per event per room", () => {
  const g = new Live({ startFen: LEGEND_FEN, studySeconds: 30, startKind: "position" }).join();
  g.do({ type: "ready", side: "w" }, 1_000);
  g.do({ type: "ready", side: "b" }, 1_000);
  for (const uci of LEGEND_MOVES) g.move(g.s.phase === "first_move" ? g.s.firstMove!.side : g.s.turn, uci, 2_000);
  assert.equal(g.s.phase, "ended");
  assert.deepEqual(
    [g.s.result?.method, g.s.result?.winner, g.s.result?.ply],
    ["checkmate", "w", 33],
    "result.ply is absolute",
  );
  assert.equal(g.s.sans.at(-1), "Rd8#");
  const fin = g.effects.find((e) => e.type === "finish");
  assert.ok(fin);
  for (const room of ["game", "spectate"] as const) {
    const seqs = g.events
      .filter((e) => e.room === room && "seq" in (e.event.payload as object))
      .map((e) => (e.event.payload as { seq: number }).seq);
    assert.deepEqual(
      seqs,
      seqs.map((_, i) => i + 1),
      `${room} seq`,
    );
  }
  // Spectators got every ply exactly once and in order, the last one released at the end.
  const spectPlies = g.events
    .filter((e) => e.room === "spectate" && e.event.name === "move:applied")
    .map((e) => (e.event.payload as MoveApplied).ply);
  assert.deepEqual(
    spectPlies,
    Array.from({ length: 15 }, (_, i) => MAIN.gameStartsAtPly + i + 1),
    "absolute plies",
  );
  const lastTwo = g.names("spectate").slice(-2);
  assert.deepEqual(lastTwo, ["move:applied", "game:ended"]);
  assert.equal(g.effects.filter((e) => e.type === "journal" && e.line.t === "ply").length, 15);
});

test("spectators: ply n is released when ply n + 1 is played; the snapshot is one ply behind", () => {
  const g = new Live().join();
  g.move("w", "e2e4", 1_000);
  assert.deepEqual(g.lastNames("spectate"), ["game:phase"], "the phase change, but not the move yet");
  assert.equal(g.view().moves, "");
  assert.equal(g.view("w").moves, "e2e4");
  g.move("b", "e7e5", 1_000);
  const rel = g.last.events.filter((e) => e.room === "spectate" && e.event.name === "move:applied");
  assert.equal((rel[0]!.event.payload as MoveApplied).uci, "e2e4");
  assert.equal(g.view().moves, "e2e4");
  assert.equal(g.view().you.role, "spectator");
  assert.equal(g.view().drawOffer, null);
});

test("T16–T18: rematch offer, decline, cancel, expiry, leave, max 3, crossing, paywall, created", () => {
  const ent = { w: T0 / 1000 + 3600, b: T0 / 1000 + 3600 };
  const ended = () => {
    const g = new Live().join().firstMoves("e2e4", "e7e5");
    g.do({ type: "resign", side: "b" });
    return g;
  };
  const g = ended();
  assert.equal((g.do({ type: "rematchAccept", side: "b", ent }).ack as { code: string }).code, "no_offer");
  g.do({ type: "rematchOffer", side: "w" });
  assert.deepEqual(g.last.ack, { ok: true, expiresAt: g.now + 30_000 });
  assert.deepEqual(g.lastNames(), ["rematch:offered"]);
  g.do({ type: "rematchDecline", side: "b" });
  assert.equal(g.s.rematch, null);
  g.do({ type: "rematchOffer", side: "w" });
  assert.equal((g.do({ type: "rematchCancel", side: "b" }).ack as { code: string }).code, "no_offer");
  g.do({ type: "rematchCancel", side: "w" });
  assert.deepEqual(g.lastNames(), ["rematch:cancelled"]);
  g.do({ type: "rematchOffer", side: "b" });
  g.do({ type: "timer" }, 30_000);
  assert.deepEqual(g.lastNames(), ["rematch:expired"]);
  assert.equal((g.last.events[0]!.event.payload as { reason: string }).reason, "timeout");
  assert.equal(
    (g.do({ type: "rematchOffer", side: "w" }).ack as { code: string }).code,
    "not_allowed",
    "max 3 offers per game",
  );

  const left = ended();
  left.do({ type: "rematchOffer", side: "w" });
  left.do({ type: "detach", side: "b", socketId: "b1" });
  const exp = left.last.events.find((e) => e.event.name === "rematch:expired")!.event.payload as { reason: string };
  assert.equal(exp.reason, "left");
  assert.equal(
    (left.do({ type: "rematchOffer", side: "w" }).ack as { code: string }).code,
    "not_allowed",
    "both must be on the page",
  );

  const pay = ended();
  pay.do({ type: "rematchOffer", side: "w" });
  assert.equal(
    (pay.do({ type: "rematchAccept", side: "b", ent: { w: 0, b: ent.b } }).ack as { code: string }).code,
    "paywall",
  );
  assert.equal(
    (pay.do({ type: "rematchAccept", side: "b", ent: { w: ent.w, b: 0 } }).ack as { code: string }).code,
    "not_member",
  );
  pay.do({ type: "rematchAccept", side: "b", ent });
  assert.equal(pay.last.ack, undefined, "the accept is acked after rematchCreated");
  assert.deepEqual(
    pay.last.effects.find((e) => e.type === "createRematch"),
    { type: "createRematch", offeredBy: "w", acceptedBy: "b" },
  );
  pay.do({ type: "rematchCreated", newRef: "cnewgame000000000000000001" });
  assert.deepEqual(pay.last.ack, { ok: true, newRef: "cnewgame000000000000000001" });
  const started = pay.last.events[0]!.event.payload as { colors: { w: string; b: string } };
  assert.deepEqual(started.colors, { w: "cuserblack0000000000000001", b: "cuserwhite0000000000000001" });
  assert.equal((pay.do({ type: "rematchOffer", side: "w" }).ack as { code: string }).code, "not_allowed");

  const cross = ended();
  cross.do({ type: "rematchOffer", side: "w" });
  cross.do({ type: "rematchOffer", side: "b", ent });
  assert.ok(
    cross.last.effects.some((e) => e.type === "createRematch"),
    "crossing offers accept",
  );
  cross.do({ type: "rematchFailed" });
  assert.equal((cross.last.ack as { code: string }).code, "internal");

  const aborted = new Live().join();
  aborted.do({ type: "abort", side: "w" });
  assert.equal((aborted.do({ type: "rematchOffer", side: "w" }).ack as { code: string }).code, "not_allowed");
  const tour = new Live({ mode: "TOURNAMENT" }).join().firstMoves("e2e4", "e7e5");
  tour.do({ type: "resign", side: "w" });
  assert.equal((tour.do({ type: "rematchOffer", side: "w" }).ack as { code: string }).code, "not_allowed");
});

test("T19/T20: freeze stops the clocks and suspends deadlines; resume shifts them by the frozen time", () => {
  const g = new Live().join().firstMoves("e2e4", "e7e5");
  g.do({ type: "detach", side: "b", socketId: "b1" }, 1_000);
  const grace = g.s.presence.b.graceEndsAt!;
  const wBefore = g.s.clocks.w;
  g.do({ type: "freeze", reason: "drain" }, 4_000);
  assert.deepEqual([g.s.clocks.run, g.s.clocks.w], [null, wBefore - 5_000]);
  assert.ok(g.s.frozen && g.s.draining);
  assert.deepEqual(g.lastNames(), ["clock:sync"]);
  assert.equal((g.move("w", "g1f3").ack as { code: string }).code, "phase", "no moves while frozen");
  assert.equal(nextTimer(g.s), null, "a drain freeze has no resume deadline");
  g.do({ type: "resume" }, 10_000);
  assert.equal(g.s.presence.b.graceEndsAt, grace + 10_000);
  assert.deepEqual([g.s.clocks.run, g.s.clocks.at], ["w", g.now]);
});

test("a drain closing the sockets tells nobody that the other side left (D7)", () => {
  const g = new Live().join().firstMoves("e2e4", "e7e5");
  g.do({ type: "freeze", reason: "drain" }, 1_000);
  g.do({ type: "detach", side: "w", socketId: "w1" }, 1_010);
  assert.deepEqual(g.lastNames(), [], "no presence:update while draining");
  assert.equal(g.s.presence.w.sockets.length, 0, "the presence state still follows the sockets");
  assert.equal(g.s.presence.w.graceEndsAt, null, "no grace");
  g.do({ type: "detach", side: "b", socketId: "b1" }, 1_020);
  assert.deepEqual(g.lastNames(), []);
  assert.equal(g.s.phase, "playing");
  // The 30 s notice before the drain is ordinary play: a real disconnect there is still reported.
  const n = new Live().join().firstMoves("e2e4", "e7e5");
  n.do({ type: "detach", side: "w", socketId: "w1" }, 1_000);
  assert.deepEqual(n.lastNames(), ["presence:update"]);
});

test("restore: replay keeps threefold history, clocks frozen, resume when both attach or after 60 s", () => {
  const moves = ["g1f3", "g8f6", "f3g1", "f6g8", "g1f3", "g8f6", "f3g1"];
  const r = restoreGame(
    gameInput(),
    {
      moves,
      clocksMs: moves.map(() => 290_000),
      phase: "playing",
      phaseEndsAt: null,
      clocks: { w: 290_000, b: 280_000, run: "b" },
      savedAt: T0,
    },
    T0 + 50_000,
    DEFAULT_MACHINE_CONFIG.resumeMaxWaitMs,
  );
  assert.ok(r.ok);
  if (!r.ok) return;
  let s = r.state;
  assert.deepEqual(s.frozen, { since: T0, reason: "restart", run: "b", resumeBy: T0 + 110_000 });
  s = reduce(s, { type: "attach", side: "w", socketId: "w9" }, T0 + 51_000).state;
  assert.ok(s.frozen, "one player is not enough");
  const res = reduce(s, { type: "attach", side: "b", socketId: "b9" }, T0 + 52_000);
  s = res.state;
  assert.equal(s.frozen, null);
  assert.deepEqual(s.clocks, { w: 290_000, b: 280_000, run: "b", at: T0 + 52_000 });
  const fin = reduce(s, { type: "move", side: "b", ply: 7, uci: "f6g8", clientMoveId: "z" }, T0 + 53_000).state;
  assert.equal(fin.result?.method, "threefold", "threefold history survived the restore");

  const timed = reduce(r.state, { type: "timer" }, T0 + 110_000).state;
  assert.equal(timed.frozen, null, "resume after RESUME_MAX_WAIT_MS");

  const bad = restoreGame(
    gameInput(),
    {
      moves: ["e2e4", "e2e4"],
      clocksMs: [],
      phase: "playing",
      phaseEndsAt: null,
      clocks: { w: 1, b: 1, run: "w" },
      savedAt: T0,
    },
    T0,
    60_000,
  );
  assert.deepEqual(bad, { ok: false, reason: "corrupt", index: 1 });
});

test("journal lines fold back into restore progress", () => {
  const g = new Live({ startFen: LEGEND_FEN, studySeconds: 30 }).join();
  g.do({ type: "timer" }, 30_000);
  for (const uci of LEGEND_MOVES.slice(0, 5))
    g.move(g.s.phase === "first_move" ? g.s.firstMove!.side : g.s.turn, uci, 3_000);
  g.do({ type: "drawOffer", side: g.s.turn });
  g.do({ type: "freeze", reason: "drain" }, 1_000);
  const lines = g.effects
    .filter((e): e is Extract<Effect, { type: "journal" }> => e.type === "journal")
    .map((e) => e.line as JournalLine);
  const folded = foldJournal(lines);
  assert.deepEqual(folded.moves, g.s.moves);
  assert.equal(folded.phase, "playing");
  assert.deepEqual(folded.drawOffer, g.s.drawOffer);
  const p = progressFromJournal(folded, 300_000);
  assert.deepEqual([p.clocks.w, p.clocks.b, p.clocks.run], [g.s.clocks.w, g.s.clocks.b, g.s.turn]);
  assert.equal(p.savedAt, g.now);
  const restored = restoreGame(gameInput({ startFen: LEGEND_FEN, studySeconds: 30 }), p, g.now + 5_000, 60_000);
  assert.ok(restored.ok && restored.state.fen === g.s.fen);
});

test("armTimer / clearTimer effects follow the earliest deadline", () => {
  const g = new Live().join();
  assert.equal(g.s.timer?.kind, "first_move_deadline");
  g.firstMoves("e2e4", "e7e5");
  assert.equal(g.s.timer?.kind, "flag");
  g.do({ type: "resign", side: "w" });
  assert.ok(g.last.effects.some((e) => e.type === "clearTimer"));
  assert.equal(g.s.timer, null);
});

test("the projection carries the PlayerView, header and readiness per viewer", () => {
  const g = new Live({ startFen: LEGEND_FEN, studySeconds: 30, rematchOf: "cparent00000000000000000001" }).join();
  g.do({ type: "ready", side: "b" });
  const v = g.view("w");
  assert.equal(v.header.right, "Rematch · Blitz 5+3");
  assert.equal(v.players.b.ready, true);
  assert.equal(v.players.w.initials, "KN");
  assert.equal(v.players.b.online, true);
  assert.equal(v.rematchOf, "cparent00000000000000000001");
  assert.equal(v.you.color, "w");
  assert.equal(g.view().header.right, "Watching · Blitz 5+3");
  assert.equal(v.startPly, MAIN.gameStartsAtPly);
  assert.equal(v.timeClass, "blitz");
  assert.notEqual(v.startFen, INITIAL_FEN);
});

test("reduce never mutates its input state", () => {
  const g = new Live({ startFen: LEGEND_FEN, studySeconds: 30 }).join();
  const inputs = [
    { type: "ready", side: "w" },
    { type: "ready", side: "b" },
    { type: "move", side: "w", ply: g.s.startPly, uci: LEGEND_MOVES[0]!, clientMoveId: "a" },
  ] as const;
  for (const input of inputs) {
    const before = JSON.stringify(g.s);
    const snapshot = g.s;
    g.do(input, 1_000);
    assert.equal(JSON.stringify(snapshot), before, input.type);
  }
  g.move("b", LEGEND_MOVES[1]!, 1_000);
  for (const input of [
    { type: "drawOffer", side: "w" },
    { type: "detach", side: "b", socketId: "b1" },
    { type: "freeze", reason: "drain" },
    { type: "resume" },
    { type: "resign", side: "w" },
    { type: "rematchOffer", side: "w" },
  ] as const) {
    const snapshot = g.s;
    const before = JSON.stringify(snapshot);
    g.do(input, 1_000);
    assert.equal(JSON.stringify(snapshot), before, input.type);
  }
});

// ── FIX-A regressions (review-rules probes B, D, E, F, L and the spectator delay after a restore) ──

test("regression: FIX-A — a move in flight within its lag credit is not beaten by the flag timer", () => {
  const g = new Live({ tc: { initialMs: 60_000, incrementMs: 0 } }).join().firstMoves("e2e4", "e7e5");
  for (let i = 0; i < 30; i++) g.do({ type: "ping", side: "w", rttMs: 400 }); // credit = min(200, 250)
  const start = g.now;
  const flagAt = nextTimer(g.s)!.at;
  assert.ok(flagAt - start >= 60_000 + 190, `flag armed at +${flagAt - start}`);
  g.move("w", "g1f3", 60_050);
  assert.equal(g.s.phase, "playing");
});

test("regression: FIX-A — a reconnect during a drain does not unfreeze the clocks", () => {
  const g = new Live().join().firstMoves("e2e4", "e7e5");
  g.do({ type: "freeze", reason: "drain" }, 1000);
  g.do({ type: "detach", side: "b", socketId: "b1" }, 100);
  g.do({ type: "attach", side: "b", socketId: "b2" }, 100);
  g.move("w", "g1f3", 500);
  assert.ok(g.s.frozen, "still frozen");
  assert.equal(g.s.clocks.run, null);
});

test("regression: FIX-A — a side that left during the first-move window gets its grace when play starts", () => {
  const g = new Live({ tc: { initialMs: 1_800_000, incrementMs: 0 } }).join();
  g.move("w", "e2e4", 2_000);
  g.do({ type: "detach", side: "w", socketId: "w1" }, 1_000);
  assert.equal(g.s.presence.w.graceEndsAt, null, "T13: no grace in first_move");
  g.move("b", "e7e5", 3_000);
  assert.equal(g.s.phase, "playing");
  assert.equal(g.s.presence.w.graceEndsAt, g.now + DEFAULT_MACHINE_CONFIG.graceMs);
  assert.equal(nextTimer(g.s)?.kind, "grace");
});

const journalOf = (g: Live, initialMs: number): JournalLine[] => {
  const open: JournalLine = {
    t: "open",
    v: 1,
    at: T0,
    ref: g.s.ref,
    startFen: INITIAL_FEN,
    tc: { i: initialMs, inc: 0 },
    colors: { w: "a", b: "b" },
    studyS: 0,
  };
  return [open, ...g.effects.filter((e) => e.type === "journal").map((e) => (e as { line: JournalLine }).line)];
};

test("regression: FIX-A — a journal timeout restores the flagged side at 0", () => {
  const g = new Live({ tc: { initialMs: 60_000, incrementMs: 0 } }).join().firstMoves("e2e4", "e7e5");
  g.move("w", "g1f3", 5_000);
  g.do({ type: "timer" }, 61_000);
  assert.equal(g.s.result?.method, "timeout");
  const p = progressFromJournal(foldJournal(journalOf(g, 60_000)), 60_000);
  const r = restoreGame(gameInput({ tc: { initialMs: 60_000, incrementMs: 0 } }), { ...p, phase: "ended" }, g.now + 10_000, 60_000);
  assert.ok(r.ok);
  assert.equal(r.ok && r.state.clocks.b, 0);
  assert.equal(r.ok && r.state.clocks.w, g.s.clocks.w);
});

test("regression: FIX-A — a crash restore charges the running side's think time up to the last journal line", () => {
  const g = new Live({ tc: { initialMs: 300_000, incrementMs: 0 } }).join().firstMoves("e2e4", "e7e5");
  g.move("w", "g1f3", 1_000);
  g.move("b", "b8c6", 1_000);
  g.do({ type: "drawOffer", side: "b" }, 120_000);
  const wLive = g.s.clocks.w - (g.now - g.s.clocks.at);
  const p = progressFromJournal(foldJournal(journalOf(g, 300_000)), 300_000);
  const r = restoreGame(gameInput({ tc: { initialMs: 300_000, incrementMs: 0 } }), p, g.now + 5_000, 60_000);
  assert.ok(r.ok);
  assert.ok(r.ok && Math.abs(r.state.clocks.w - wLive) < 50, `restored ${r.ok && r.state.clocks.w} vs live ${wLive}`);
});

test("regression: FIX-A — spectators stay one ply behind after a restore, with clocks of the shown ply", () => {
  const g = new Live({ tc: { initialMs: 300_000, incrementMs: 0 } }).join().firstMoves("e2e4", "e7e5");
  g.move("w", "g1f3", 4_000);
  const p = progressFromJournal(foldJournal(journalOf(g, 300_000)), 300_000);
  const r = restoreGame(gameInput({ tc: { initialMs: 300_000, incrementMs: 0 } }), p, g.now + 1_000, 60_000);
  assert.ok(r.ok);
  if (!r.ok) return;
  const spect = projectState(r.state, { role: "spectator" }, g.now + 1_000);
  assert.equal(spect.moves, "e2e4 e7e5");
  const player = projectState(r.state, { role: "player", color: "w" }, g.now + 1_000);
  assert.equal(player.moves, "e2e4 e7e5 g1f3");
  // Live too: the spectator snapshot's clock runs for the side to move in the SHOWN position, one move late.
  const live = projectState(g.s, { role: "spectator" }, g.now);
  assert.equal(live.turn, "w");
  assert.equal(live.clocks.run, "w", "the shown position (after 1…e5) has White to move, while the real clock runs for Black");
  assert.equal(g.s.clocks.run, "b");
  g.move("b", "b8c6", 2_000);
  const later = projectState(g.s, { role: "spectator" }, g.now);
  assert.equal(later.moves, "e2e4 e7e5 g1f3");
  assert.equal(later.turn, "b");
  assert.equal(later.clocks.run, "b");
  assert.equal(later.clocks.w, g.s.clocksMs[2]);
});
