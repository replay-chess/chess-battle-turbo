// The live controller over a fake tab connection: join/replace, moves and acks, ref filtering, gap → game:sync,
// three failed syncs → server_error, join failures, and the unbind (plan 5.2.2–5.2.4).
import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { absPly } from "@repo/game-core/client/reducer";
import { deriveViewState } from "@repo/game-core/client/viewState";
import { legalDests, peekChess } from "@repo/game-core/rules/chess";
import { replayTranscript } from "@repo/game-core/testing/harness";
import { buildTranscript } from "@repo/game-core/testing/scenarios";
import type { GameState } from "@repo/game-core/machine/types";
import type { BoardMove, Sq } from "@/components/board/types";
import type { ConnState, RealtimeConnection } from "@/lib/realtime/connection";
import { createLiveController, type JoinFailure } from "./useGameSocket";

type Ack = Record<string, unknown> & { ok: boolean };

class FakeRealtime {
  state: ConnState = "live";
  handlers = new Map<string, Set<(p: unknown) => void>>();
  listeners = new Set<() => void>();
  sent: { name: string; payload: Record<string, unknown> }[] = [];
  emitted: { name: string; payload: unknown }[] = [];
  holds = 0;
  rooms = new Map<string, () => Promise<void>>();
  respond: (name: string, payload: Record<string, unknown>) => Promise<Ack> = async () => ({ ok: true });

  acquire() {
    this.holds++;
    return () => {
      this.holds--;
    };
  }
  room(key: string, join: () => Promise<void>, leave: () => void) {
    this.rooms.set(key, join);
    if (this.state === "live") void join();
    return () => {
      this.rooms.delete(key);
      leave();
    };
  }
  on(event: string, fn: (p: unknown) => void) {
    const set = this.handlers.get(event) ?? new Set();
    set.add(fn);
    this.handlers.set(event, set);
    return () => set.delete(fn);
  }
  async command(name: string, payload: Record<string, unknown>) {
    this.sent.push({ name, payload });
    return this.respond(name, payload);
  }
  emit(name: string, payload: unknown) {
    this.emitted.push({ name, payload });
  }
  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };
  getState = () => this.state;
  isLive = () => this.state === "live";
  fire(event: string, payload: unknown) {
    for (const fn of this.handlers.get(event) ?? []) fn(payload);
  }
}

const detachers: (() => void)[] = [];
afterEach(() => {
  for (const d of detachers.splice(0)) d();
});

const flush = () => new Promise((r) => setTimeout(r, 0));

function livePosition(): GameState {
  return replayTranscript(buildTranscript("your_move")).store.state;
}

function setup(state = livePosition()) {
  const rt = new FakeRealtime();
  const failures: JoinFailure[] = [];
  const navigations: string[] = [];
  let refreshed = 0;
  rt.respond = async (name) => {
    if (name === "game:join" || name === "game:sync") return { ok: true, role: "player", color: "w", state };
    return { ok: true };
  };
  const controller = createLiveController(
    { ...state },
    {
      navigate: (to) => navigations.push(to),
      refresh: () => refreshed++,
      onJoinFailure: (c) => failures.push(c),
      realtime: () => rt as unknown as RealtimeConnection,
    },
  );
  return { rt, controller, failures, navigations, refreshed: () => refreshed, state };
}

function someLegalMove(fen: string): BoardMove {
  const [from, tos] = [...legalDests(peekChess(fen, []))][0]!;
  const to = tos[0]!;
  return { from: from as Sq, to: to as Sq, uci: `${from}${to}` };
}

test("attach holds the socket, joins the game room with lastSeq and replaces the RSC snapshot", async () => {
  const { rt, controller, state } = setup();
  assert.equal(controller.store.getState().joined, false);
  const detach = controller.attach();
  await flush();
  assert.equal(rt.holds, 1);
  const join = rt.sent.find((c) => c.name === "game:join");
  assert.deepEqual(join?.payload, { ref: state.ref, lastSeq: state.seq });
  const g = controller.store.getState();
  assert.equal(g.joined, true);
  assert.equal(deriveViewState(g, controller.serverNow()).primary, "your_move");
  detach();
  assert.equal(rt.holds, 0);
  assert.deepEqual(rt.emitted, [{ name: "game:leave", payload: { ref: state.ref } }]);
});

test("a move is applied optimistically and sent with the absolute ply and a short clientMoveId", async () => {
  const { rt, controller, state } = setup();
  detachers.push(controller.attach());
  await flush();
  const m = someLegalMove(state.fen);
  controller.move(m);
  const sent = rt.sent.find((c) => c.name === "game:move");
  assert.ok(sent, "game:move sent");
  assert.equal(sent.payload.ply, absPly(state));
  assert.equal(sent.payload.uci, m.uci);
  assert.match(String(sent.payload.clientMoveId), /^[A-Za-z0-9_-]{1,16}$/);
  assert.equal(controller.store.getState().state.moves.split(" ").at(-1), m.uci);
  await flush();
  assert.equal(controller.store.getState().pending, null, "the ok ack confirms the move");
});

// regression: REGRESSION-2 — a move refused with rate_limited was rolled back silently (friend-full on next start).
test("a move refused with rate_limited is resent after retryAfterMs and confirmed, not rolled back", async () => {
  const { rt, controller, state } = setup();
  detachers.push(controller.attach());
  await flush();
  let moves = 0;
  rt.respond = async (name) => {
    if (name !== "game:move") return { ok: true };
    moves++;
    return moves === 1 ? { ok: false, code: "rate_limited", retryAfterMs: 20 } : { ok: true, seq: state.seq + 1, ply: absPly(state) + 1 };
  };
  const m = someLegalMove(state.fen);
  controller.move(m);
  await flush();
  assert.equal(controller.store.getState().pending?.uci, m.uci, "still pending while the limiter holds it");
  await new Promise((r) => setTimeout(r, 60));
  await flush();
  const sent = rt.sent.filter((c) => c.name === "game:move");
  assert.equal(sent.length, 2, "resent once");
  assert.equal(sent[1]!.payload.clientMoveId, sent[0]!.payload.clientMoveId, "same clientMoveId and ply");
  assert.equal(controller.store.getState().pending, null, "the second ack confirms it");
  assert.equal(controller.store.getState().state.moves.split(" ").at(-1), m.uci, "the move stays on the board");
});

test("events for another game are ignored; a seq gap asks game:sync", async () => {
  const { rt, controller, state } = setup();
  detachers.push(controller.attach());
  await flush();
  const before = controller.store.getState();
  rt.fire("draw:offered", { seq: state.seq + 1, ref: "cother000000000000000000001", by: "b" });
  assert.equal(controller.store.getState(), before);
  const syncsBefore = rt.sent.filter((c) => c.name === "game:sync").length;
  rt.fire("draw:offered", { seq: state.seq + 5, ref: state.ref, by: "b" });
  await flush();
  assert.equal(rt.sent.filter((c) => c.name === "game:sync").length, syncsBefore + 1);
});

test("three failed syncs put the store in server_error; Reload game falls back to a route refresh", async () => {
  const { rt, controller, refreshed } = setup();
  detachers.push(controller.attach());
  await flush();
  rt.respond = async () => ({ ok: false, code: "internal" });
  for (let i = 0; i < 3; i++) {
    controller.sync();
    await flush();
    await flush();
  }
  const g = controller.store.getState();
  assert.equal(g.serverError, true);
  assert.equal(deriveViewState(g, controller.serverNow()).primary, "server_error");
  assert.equal(refreshed(), 3);
});

test("join not_found is reported to the screen (the not-found view)", async () => {
  const { rt, controller, failures } = setup();
  rt.respond = async () => ({ ok: false, code: "not_found" });
  detachers.push(controller.attach());
  await flush();
  assert.deepEqual(failures, ["not_found"]);
});

test("rematch:started navigates to the new game", async () => {
  const { rt, controller, navigations, state } = setup();
  detachers.push(controller.attach());
  await flush();
  rt.fire("rematch:started", {
    seq: state.seq + 1,
    ref: state.ref,
    newRef: "cnewgame000000000000000001",
    colors: { w: "cuserwhite0000000000000001", b: "cuserblack0000000000000001" },
  });
  assert.deepEqual(navigations, ["/game/cnewgame000000000000000001"]);
});

test("the connection state flows into the store (reconnecting → zone reconnect)", async () => {
  const { rt, controller } = setup();
  detachers.push(controller.attach());
  await flush();
  rt.state = "reconnecting";
  for (const l of rt.listeners) l();
  const v = deriveViewState(controller.store.getState(), controller.serverNow());
  assert.equal(v.primary, "reconnecting");
  assert.equal(v.zone, "reconnect");
});

// ── G5: optimistic study-ready, draw and rematch with ack rollback (plan 5.2.8) ──

function deferred() {
  let resolve!: (a: Ack) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<Ack>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function stateOf(name: Parameters<typeof buildTranscript>[0]): GameState {
  return replayTranscript(buildTranscript(name)).store.state;
}

/** A game that just ended (the transcripts are stamped in 2023; an old end reads as already_ended). */
function justEnded(): GameState {
  const s = stateOf("over_checkmate_win");
  return { ...s, serverNow: Date.now(), result: s.result ? { ...s.result, endedAt: Date.now() } : s.result };
}

/** Joins, then holds the next command named `cmd` until the test answers it. */
async function holdNext(state: GameState, cmd: string) {
  const s = setup(state);
  detachers.push(s.controller.attach());
  await flush();
  const d = deferred();
  const base = s.rt.respond;
  s.rt.respond = (name, payload) => (name === cmd ? d.promise : base(name, payload));
  return { ...s, d };
}

test("draw offer: draw_sent renders before the ack; a draw_cooldown ack rolls it back with the cooldown toast", async () => {
  const state = stateOf("your_move");
  const { controller, d } = await holdNext(state, "draw:offer");
  controller.offerDraw();
  let v = deriveViewState(controller.store.getState(), controller.serverNow());
  assert.equal(v.primary, "draw_sent", "optimistic before the ack");
  assert.equal(v.draw.label, "sent");
  d.resolve({ ok: false, code: "draw_cooldown", canOfferAtPly: absPly(state) + 4 });
  await flush();
  const g = controller.store.getState();
  v = deriveViewState(g, controller.serverNow());
  assert.equal(g.state.drawOffer, null, "rolled back");
  assert.equal(g.toast?.code, "draw_cooldown");
  assert.notEqual(v.primary, "draw_sent");
});

test("draw offer: a lost ack (rejection) rolls back too and asks one game:sync while live", async () => {
  const { rt, controller, d } = await holdNext(stateOf("your_move"), "draw:offer");
  controller.offerDraw();
  const syncs = rt.sent.filter((c) => c.name === "game:sync").length;
  d.reject(new Error("timeout"));
  await flush();
  assert.equal(controller.store.getState().state.drawOffer, null);
  assert.equal(rt.sent.filter((c) => c.name === "game:sync").length, syncs + 1);
});

test("a command that fails while the socket is down rolls back without counting a failed sync", async () => {
  const { rt, controller, d } = await holdNext(stateOf("your_move"), "draw:offer");
  controller.offerDraw();
  rt.state = "reconnecting";
  d.reject(new Error("not_connected"));
  await flush();
  const g = controller.store.getState();
  assert.equal(g.state.drawOffer, null);
  assert.equal(g.syncFailures, 0);
  assert.equal(rt.sent.filter((c) => c.name === "game:sync").length, 0);
});

test("study ready: the own bar flips to ready before the ack; a phase ack rolls it back", async () => {
  const state = stateOf("study");
  const { controller, d } = await holdNext(state, "study:ready");
  const me = state.you.color!;
  controller.ready();
  assert.equal(controller.store.getState().state.study?.ready[me], true, "optimistic");
  assert.equal(controller.store.getState().state.players[me].ready, true);
  d.resolve({ ok: false, code: "phase" });
  await flush();
  assert.equal(controller.store.getState().state.study?.ready[me], false, "rolled back");
});

test("rematch offer: over_rematch_sent before the ack; the ack's expiresAt replaces the local estimate", async () => {
  const { controller, d } = await holdNext(justEnded(), "rematch:offer");
  controller.offerRematch();
  const g = controller.store.getState();
  assert.equal(deriveViewState(g, controller.serverNow()).primary, "over_rematch_sent");
  const expiresAt = (g.state.rematch?.expiresAt ?? 0) + 1234;
  d.resolve({ ok: true, expiresAt });
  await flush();
  assert.equal(controller.store.getState().state.rematch?.expiresAt, expiresAt);
});

test("rematch offer: a negative ack removes the sent bar", async () => {
  const { controller, d } = await holdNext(justEnded(), "rematch:offer");
  controller.offerRematch();
  assert.equal(deriveViewState(controller.store.getState(), controller.serverNow()).primary, "over_rematch_sent");
  d.resolve({ ok: false, code: "expired" });
  await flush();
  const g = controller.store.getState();
  assert.equal(g.state.rematch, null);
  assert.notEqual(deriveViewState(g, controller.serverNow()).primary, "over_rematch_sent");
});

// regression (INTEGRATE-2 restart smoke): after a server restart the re-join waited for the boot restore longer than
// the 5 s command timeout; `joined` was still true from the first join, so the retry never ran and the player kept
// the pre-restart state ("Disconnected", frozen clocks) until a reload.
test("a re-join after a reconnect that times out is retried until it is answered", async () => {
  const { rt, controller, state } = setup();
  detachers.push(controller.attach());
  await flush();
  assert.equal(controller.store.getState().joined, true);
  const joins = () => rt.sent.filter((c) => c.name === "game:join").length;
  assert.equal(joins(), 1);

  let failNext = true;
  const later = { ...state, seq: state.seq + 5 };
  rt.respond = async (name) => {
    if (name === "game:join") {
      if (failNext) {
        failNext = false;
        throw new Error("timeout");
      }
      return { ok: true, role: "player", color: "w", state: later };
    }
    return { ok: true };
  };
  const rejoin = [...rt.rooms.values()][0]!;
  await rejoin();
  assert.equal(joins(), 2);
  assert.equal(controller.store.getState().state.seq, state.seq);
  await new Promise((r) => setTimeout(r, 2_100));
  await flush();
  assert.equal(joins(), 3);
  assert.equal(controller.store.getState().state.seq, later.seq);
  await new Promise((r) => setTimeout(r, 2_100));
  assert.equal(joins(), 3, "no retry once the round is answered");
});
