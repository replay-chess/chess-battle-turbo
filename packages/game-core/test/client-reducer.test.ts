// Client store reducer (plan 5.2, 12.1): optimistic move then confirm (by ack or by broadcast), reject → replace +
// toast, gap → sync, duplicates ignored, premove fire/cancel, outbox send/drop on rejoin, optimistic draw /
// rematch / study-ready / decline / cancel rolled back by a negative ack.
import assert from "node:assert/strict";
import { test } from "node:test";
import { reduceClient, type ClientAction, type ClientGame } from "../src/client/reducer";
import { Harness } from "../src/testing/harness";
import { LEGEND_MOVES, T0, liveInput } from "../src/testing/scenarios";
import type { Ack, GameState } from "../src/machine/types";

function playing(): Harness {
  const g = new Harness(liveInput(), T0).joinAll();
  g.advance(1_000).command("w", { type: "ready", now: g.now }, "study:ready", { type: "ready", side: "w" });
  g.advance(1_000).command("b", { type: "ready", now: g.now }, "study:ready", { type: "ready", side: "b" });
  g.advance(1_000).move("w", LEGEND_MOVES[0]!);
  g.advance(1_000).move("b", LEGEND_MOVES[1]!);
  return g;
}

const run = (store: ClientGame, a: ClientAction) => reduceClient(store, a);

test("optimistic move, then confirmed by the ack (seq adopted; the later broadcast is ignored)", () => {
  const g = playing();
  const before = g.store("w");
  const r = run(before, { type: "move", uci: LEGEND_MOVES[2]!, clientMoveId: "c1", now: g.now, serverNow: g.now });
  assert.equal(r.store.pending?.clientMoveId, "c1");
  assert.equal(r.store.state.moves.split(" ").length, 3, "the board updates in the same frame");
  assert.equal(r.store.state.turn, "b");
  assert.deepEqual(r.out, [
    {
      type: "send",
      cmd: "game:move",
      payload: {
        ref: before.state.ref,
        ply: before.state.startPly + 2,
        uci: LEGEND_MOVES[2],
        clientMoveId: "c1",
        premove: false,
      },
    },
  ]);
  const srv = g.serve({
    type: "move",
    side: "w",
    ply: before.state.startPly + 2,
    uci: LEGEND_MOVES[2]!,
    clientMoveId: "c1",
  });
  const acked = run(r.store, { type: "moveAck", clientMoveId: "c1", ack: srv.ack!, now: g.now }).store;
  assert.equal(acked.pending, null);
  assert.equal(acked.state.seq, (srv.ack as unknown as { seq: number }).seq);
  const applied = srv.events.find((e) => e.room === "game" && e.event.name === "move:applied")!.event;
  const after = run(acked, { type: "event", event: applied, now: g.now });
  assert.equal(after.store.state.moves, acked.state.moves, "duplicate after the ack: ignored");
});

test("the mover matches its own move:applied on ply + uci before the ack (no clientMoveId in the broadcast)", () => {
  const g = playing();
  const r = run(g.store("w"), {
    type: "move",
    uci: LEGEND_MOVES[2]!,
    clientMoveId: "c2",
    now: g.now,
    serverNow: g.now,
  }).store;
  const srv = g.serve({
    type: "move",
    side: "w",
    ply: r.state.startPly + 2,
    uci: LEGEND_MOVES[2]!,
    clientMoveId: "c2",
  });
  const ev = srv.events.find((e) => e.room === "game" && e.event.name === "move:applied")!.event;
  const s = run(r, { type: "event", event: ev, now: g.now }).store;
  assert.equal(s.pending, null);
  assert.equal(s.state.moves.split(" ").length, 3, "not applied twice");
  assert.deepEqual(s.state.clocks, (ev.payload as { clocks: unknown }).clocks);
  const late = run(s, { type: "moveAck", clientMoveId: "c2", ack: srv.ack!, now: g.now }).store;
  assert.equal(late.state.moves, s.state.moves, "a late ack is idempotent");
});

test("reject → the ack's state replaces the store and the `rejected` toast shows", () => {
  const g = playing();
  const r = run(g.store("w"), {
    type: "move",
    uci: LEGEND_MOVES[2]!,
    clientMoveId: "c3",
    now: g.now,
    serverNow: g.now,
  }).store;
  const state = g.store("b").state; // any server-side state works as the authority
  const ack: Ack = { ok: false, code: "stale_ply", state: { ...state, you: { role: "player", color: "w" } } };
  const s = run(r, { type: "moveAck", clientMoveId: "c3", ack, now: g.now }).store;
  assert.equal(s.pending, null);
  assert.equal(s.state.moves, state.moves);
  assert.equal(s.toast?.code, "rejected");
  assert.equal(s.animate, false, "no slide storm after a replace");
  const noState = run(r, { type: "moveAck", clientMoveId: "c3", ack: { ok: false, code: "internal" }, now: g.now });
  assert.deepEqual(noState.out, [{ type: "sync" }]);
});

test("a seq gap requests one game:sync; duplicates and stale events are ignored", () => {
  const g = playing();
  const w = g.store("w");
  const ev = { name: "draw:cancelled" as const, payload: { seq: w.state.seq + 2, ref: w.state.ref } };
  const r = run(w, { type: "event", event: ev, now: g.now });
  assert.deepEqual(r.out, [{ type: "sync" }]);
  assert.ok(r.store.needsSync);
  const again = run(r.store, {
    type: "event",
    event: { ...ev, payload: { ...ev.payload, seq: w.state.seq + 3 } },
    now: g.now,
  });
  assert.deepEqual(again.out, [], "only one sync while one is pending");
  const stale = run(w, {
    type: "event",
    event: { name: "draw:cancelled", payload: { seq: w.state.seq, ref: w.state.ref } },
    now: g.now,
  });
  assert.equal(stale.store.state, w.state);
});

test("illegal drop: toast with the explainIllegal reason, nothing sent", () => {
  const g = playing();
  const r = run(g.store("w"), { type: "move", uci: "e1e3", clientMoveId: "c4", now: g.now, serverNow: g.now });
  assert.deepEqual(r.out, []);
  assert.equal(r.store.toast?.code, "illegal");
  assert.equal(r.store.toast?.params?.text, "That move isn’t legal: the king moves one square at a time.");
  const promo = run(g.store("w"), { type: "move", uci: "a2a3", clientMoveId: "c5", now: g.now, serverNow: g.now });
  assert.equal(promo.out.length, 1);
});

test("premove fires in the same task when legal, else it is cancelled", () => {
  const g = playing();
  g.advance(1_000).move("w", LEGEND_MOVES[2]!); // 11.Bxb5+, Black to move
  // White premoves O-O-O while Black thinks; after 11…Nbd7 it is legal and fires.
  const w0 = run(g.store("w"), { type: "premove", uci: "e1c1", now: g.now }).store;
  assert.equal(w0.premove?.uci, "e1c1");
  assert.equal(w0.toast?.code, "premove_set");
  // Qb3-b7 is a queen pattern, but the bishop on b5 blocks it after the reply: cancelled.
  const blocked = run(g.store("w"), { type: "premove", uci: "b3b7", now: g.now }).store;
  const srv = g.serve({
    type: "move",
    side: "b",
    ply: g.server.startPly + 3,
    uci: LEGEND_MOVES[3]!,
    clientMoveId: "b1",
  });
  const ev = srv.events.find((e) => e.room === "game" && e.event.name === "move:applied")!.event;
  const fired = run(w0, { type: "event", event: ev, now: g.now });
  assert.equal(fired.store.premove, null);
  assert.equal(fired.out.length, 1);
  const send = fired.out[0] as unknown as { cmd: string; payload: { premove: boolean; uci: string } };
  assert.deepEqual([send.cmd, send.payload.premove, send.payload.uci], ["game:move", true, "e1c1"]);
  assert.equal(fired.store.pending?.uci, "e1c1");

  const cancelled = run(blocked, { type: "event", event: ev, now: g.now });
  assert.equal(cancelled.store.premove, null);
  assert.equal(cancelled.store.toast?.code, "premove_cancelled");
  assert.deepEqual(cancelled.out, []);
});

test("premove is refused on your own turn, against the bot and while viewing history", () => {
  const g = playing();
  const own = run(g.store("w"), { type: "premove", uci: "e1c1", now: g.now }).store;
  assert.equal(own.premove, null);
  const bot = { ...g.store("b"), state: { ...g.store("b").state, mode: "BOT" as const } };
  assert.equal(run(bot, { type: "premove", uci: "e8d8", now: g.now }).store.premove, null);
});

test("outbox: one move queued while offline; sent on rejoin when the ply still matches, else dropped", () => {
  const g = playing();
  let w = run(g.store("w"), { type: "conn", conn: "reconnecting", now: g.now }).store;
  const q = run(w, { type: "move", uci: LEGEND_MOVES[2]!, clientMoveId: "q1", now: g.now, serverNow: g.now });
  assert.deepEqual(q.out, [], "nothing is sent while offline");
  w = q.store;
  assert.equal(w.outbox?.uci, LEGEND_MOVES[2]);
  assert.equal(w.state.moves.split(" ").length, 2, "shown as a ghost, not applied");
  assert.equal(
    run(w, { type: "move", uci: "a2a3", clientMoveId: "q2", now: g.now, serverNow: g.now }).store.toast?.code,
    "outbox_full",
  );
  const joinState: GameState = { ...g.store("w").state };
  const back = run(run(w, { type: "conn", conn: "live", now: g.now }).store, {
    type: "replace",
    state: joinState,
    reason: "join",
    now: g.now,
  });
  assert.equal(back.out.length, 1);
  assert.equal(back.store.toast?.code, "reconnected");
  assert.equal(back.store.toast?.params?.san, "Bxb5+");
  assert.equal(back.store.pending?.clientMoveId, "q1");

  // The opponent moved meanwhile (a different ply): the queued move is dropped with the rejected toast.
  g.advance(1_000).move("w", LEGEND_MOVES[2]!);
  g.advance(1_000).move("b", LEGEND_MOVES[3]!);
  const moved: GameState = { ...g.store("w").state, moves: g.store("b").state.moves };
  const dropped = run(w, { type: "replace", state: moved, reason: "join", now: g.now });
  assert.deepEqual(dropped.out, []);
  assert.equal(dropped.store.toast?.code, "rejected");
  assert.equal(dropped.store.outbox, null);
});

test("optimistic draw offer: shown at once, confirmed by the ack, rolled back by draw_cooldown", () => {
  const g = playing();
  const w = g.store("w");
  const r = run(w, { type: "drawOffer", now: g.now });
  assert.deepEqual(r.store.state.drawOffer, { by: "w", ply: w.state.startPly + 2 });
  assert.equal(r.out[0]?.type === "send" && r.out[0].cmd, "draw:offer");
  const ok = run(r.store, { type: "cmdAck", cmd: "draw:offer", ack: { ok: true }, now: g.now }).store;
  assert.equal(ok.optimistic.draw, undefined);
  assert.ok(ok.state.drawOffer);
  const no = run(r.store, {
    type: "cmdAck",
    cmd: "draw:offer",
    ack: { ok: false, code: "draw_cooldown", canOfferAtPly: 30 },
    now: g.now,
  }).store;
  assert.equal(no.state.drawOffer, null);
  assert.equal(no.state.canOfferAtPly.w, 30);
  assert.equal(no.toast?.code, "draw_cooldown");
  const phase = run(r.store, {
    type: "cmdAck",
    cmd: "draw:offer",
    ack: { ok: false, code: "phase" },
    now: g.now,
  }).store;
  assert.equal(phase.state.drawOffer, null, "phase also rolls back");
});

test("optimistic decline removes the bar and re-inserts it on a negative ack (not on no_offer)", () => {
  const g = playing();
  g.command("b", { type: "drawOffer", now: g.now }, "draw:offer", { type: "drawOffer", side: "b" });
  const w = g.store("w");
  assert.equal(w.state.drawOffer?.by, "b");
  const r = run(w, { type: "drawAnswer", accept: false, now: g.now });
  assert.equal(r.store.state.drawOffer, null);
  // regression: FIX-A — the one who declined gets "You declined the draw." (V3Game declineDraw).
  assert.equal(r.store.toast?.code, "draw_declined_self");
  const back = run(r.store, {
    type: "cmdAck",
    cmd: "draw:decline",
    ack: { ok: false, code: "internal" },
    now: g.now,
  }).store;
  assert.equal(back.state.drawOffer?.by, "b");
  const gone = run(r.store, {
    type: "cmdAck",
    cmd: "draw:decline",
    ack: { ok: false, code: "no_offer" },
    now: g.now,
  }).store;
  assert.equal(gone.state.drawOffer, null);
});

test("optimistic study ready rolls back on `phase`", () => {
  const g = new Harness(liveInput(), T0).joinAll();
  const r = run(g.store("w"), { type: "ready", now: g.now });
  assert.equal(r.store.state.players.w.ready, true);
  assert.equal(r.store.state.study?.ready.w, true);
  const back = run(r.store, {
    type: "cmdAck",
    cmd: "study:ready",
    ack: { ok: false, code: "phase" },
    now: g.now,
  }).store;
  assert.equal(back.state.players.w.ready, false);
});

test("optimistic rematch offer: local expiry replaced by the ack; cancel and decline roll back", () => {
  const g = playing();
  g.command("b", { type: "confirmResign", now: g.now }, "game:resign", { type: "resign", side: "b" });
  const w = g.store("w");
  assert.equal(w.state.phase, "ended");
  const r = run(w, { type: "rematchOffer", now: g.now, serverNow: g.now + 100 });
  assert.equal(r.store.state.rematch?.by, "w");
  assert.equal(r.store.state.rematch?.expiresAt, g.now + 100 + 30_000, "local estimate");
  const acked = run(r.store, {
    type: "cmdAck",
    cmd: "rematch:offer",
    ack: { ok: true, expiresAt: 123 },
    now: g.now,
  }).store;
  assert.equal(acked.state.rematch?.expiresAt, 123);
  const refused = run(r.store, {
    type: "cmdAck",
    cmd: "rematch:offer",
    ack: { ok: false, code: "draining" },
    now: g.now,
  }).store;
  assert.equal(refused.state.rematch, null);
  assert.equal(refused.toast?.code, "draining");
  const cancel = run(acked, { type: "rematchCancel", now: g.now });
  assert.equal(cancel.store.state.rematch, null);
  const undo = run(cancel.store, {
    type: "cmdAck",
    cmd: "rematch:cancel",
    ack: { ok: false, code: "internal" },
    now: g.now,
  }).store;
  assert.equal(undo.state.rematch?.by, "w");
  const started = run(acked, { type: "cmdAck", cmd: "rematch:accept", ack: { ok: true, newRef: "cnew" }, now: g.now });
  assert.deepEqual(started.out, [{ type: "navigate", to: "/game/cnew", acceptedRematch: true }]);
});

test("game:ended clears in-game state; rematch:started navigates", () => {
  const g = playing();
  g.advance(1_000).move("w", LEGEND_MOVES[2]!);
  g.apply("w", { type: "premove", uci: "e1c1", now: g.now });
  assert.ok(g.store("w").premove);
  g.command("b", { type: "confirmResign", now: g.now }, "game:resign", { type: "resign", side: "b" });
  const b = g.store("b");
  assert.equal(g.store("w").premove, null, "the premove ends with the game");
  assert.ok(b.sawEnd && !b.alreadyEnded);
  g.command("w", { type: "rematchOffer", now: g.now, serverNow: g.now }, "rematch:offer", {
    type: "rematchOffer",
    side: "w",
  });
  g.command("b", { type: "rematchAnswer", accept: true, now: g.now }, "rematch:accept", {
    type: "rematchAccept",
    side: "b",
    ent: { w: T0 / 1000 + 3600, b: T0 / 1000 + 3600 },
  });
  const out = g.apply("w", {
    type: "event",
    event: {
      name: "rematch:started",
      payload: { seq: g.store("w").state.seq + 1, ref: g.server.ref, newRef: "cnext", colors: { w: "x", b: "y" } },
    },
    now: g.now,
  });
  assert.deepEqual(out, [{ type: "navigate", to: "/game/cnext" }]);
});

test("three failed syncs enter server_error", () => {
  const g = playing();
  let w = g.store("w");
  for (let i = 0; i < 3; i++) w = run(w, { type: "syncFailed", now: g.now }).store;
  assert.ok(w.serverError);
  assert.equal(w.toast?.code, "server_error");
});

test("regression: FIX-A — the illegal toast carries the full sentence", () => {
  const g = playing();
  const w = g.store("w");
  const r = run(w, { type: "illegal", from: "e1", to: "e5", now: g.now });
  assert.match(String(r.store.toast?.params?.text), /^That move isn’t legal: /);
});

test("regression: FIX-A — the accept ack's navigation is marked, so the new game shows no 'X accepted' toast", () => {
  const g = playing();
  const w = g.store("w");
  const r = run(w, { type: "cmdAck", cmd: "rematch:accept", ack: { ok: true, newRef: "cnewgame000000000000000001" }, now: g.now });
  assert.deepEqual(r.out, [{ type: "navigate", to: "/game/cnewgame000000000000000001", acceptedRematch: true }]);
});
