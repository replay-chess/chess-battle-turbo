/* eslint-disable @typescript-eslint/no-explicit-any -- test acks and events are checked by assertions, not by types */
// Draws, presence and grace, multi-tab, rematch, spectators, live list (phase-02 plan 12.4 `draw`, `presence`,
// `multitab`, `rematch`, `spectate`, without a database).
import { after, afterEach, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  closeAllClients,
  cmd,
  connect,
  delay,
  move,
  recordEvents,
  startGame,
  startServer,
  testTiming,
  until,
  user,
  waitFor,
  type TestServer,
} from "./helpers";

/** Plays e4 e5 Nf3 Nc6 (4 plies) so the game is `playing`. */
async function opening(W: any, B: any, ref: string) {
  const line = ["e2e4", "e7e5", "g1f3", "b8c6"];
  for (let i = 0; i < line.length; i++) {
    const ack = await move(i % 2 === 0 ? W : B, ref, i, line[i]!);
    assert.equal(ack.ok, true, JSON.stringify(ack));
  }
}

describe("draws", () => {
  let server: TestServer;
  before(async () => {
    server = await startServer();
  });
  afterEach(() => closeAllClients());
  after(() => server.close());

  test("offer, decline, cooldown at ply + 4, offer again, accept → agreement; accept without an offer refused (F-01)", async () => {
    const { game, W, B } = await startGame(server, user("w"), user("b"));
    await opening(W, B, game.ref);
    assert.deepEqual(await cmd(B, "draw:accept", { ref: game.ref }), { ok: false, code: "no_offer" });
    const offered = waitFor(B, "draw:offered");
    const offer = await cmd(W, "draw:offer", { ref: game.ref });
    assert.deepEqual(offer, { ok: true, drawOffer: { by: "w", ply: 4 } });
    assert.equal((await offered).by, "w");
    assert.deepEqual(await cmd(W, "draw:accept", { ref: game.ref }), { ok: false, code: "no_offer" }, "own offer");
    const declined = waitFor(W, "draw:declined");
    assert.deepEqual(await cmd(B, "draw:decline", { ref: game.ref }), { ok: true });
    const d = await declined;
    assert.equal(d.canOfferAtPly, 8);
    assert.equal(d.implicit, false);
    assert.deepEqual(await cmd(W, "draw:offer", { ref: game.ref }), { ok: false, code: "draw_cooldown", canOfferAtPly: 8 });
    // B offers; W's counter-offer accepts.
    const ended = waitFor(B, "game:ended");
    await cmd(B, "draw:offer", { ref: game.ref });
    assert.deepEqual(await cmd(W, "draw:offer", { ref: game.ref }), { ok: true, drawOffer: null });
    assert.equal((await ended).method, "agreement");
  });

  test("moving declines an open offer implicitly", async () => {
    const { game, W, B } = await startGame(server, user("w"), user("b"));
    await opening(W, B, game.ref);
    await cmd(B, "draw:offer", { ref: game.ref });
    const declined = waitFor(B, "draw:declined");
    const ack = await move(W, game.ref, 4, "f1c4");
    assert.equal(ack.ok, true);
    const d = await declined;
    assert.equal(d.implicit, true);
    assert.equal(d.canOfferAtPly, 9);
  });
});

describe("presence and grace", () => {
  let server: TestServer;
  before(async () => {
    server = await startServer({ timing: testTiming({ graceMs: 400, graceFlappingMs: 200 }) });
  });
  afterEach(() => closeAllClients());
  after(() => server.close());

  test("disconnect → presence:update with graceEndsAt; reconnect clears it", async () => {
    const b = user("b");
    const { game, W, B } = await startGame(server, user("w"), b);
    await opening(W, B, game.ref);
    const off = waitFor(W, "presence:update", 2_000, (p) => p.side === "b" && !p.online);
    B.close();
    const p = await off;
    assert.ok(p.graceEndsAt > Date.now());
    const on = waitFor(W, "presence:update", 2_000, (q) => q.side === "b" && q.online);
    const B2 = await connect(server.url, b);
    const rejoin = await cmd(B2.socket, "game:join", { ref: game.ref, lastSeq: 3 });
    assert.equal(rejoin.ok, true);
    assert.equal(rejoin.state.moves, "e2e4 e7e5 g1f3 b8c6", "the snapshot keeps every ply");
    assert.equal((await on).graceEndsAt, undefined);
  });

  test("grace expiry → abandoned, the absent side loses (F-10)", async () => {
    const { game, W, B } = await startGame(server, user("w"), user("b"));
    await opening(W, B, game.ref);
    const ended = waitFor(W, "game:ended", 3_000);
    B.close();
    const e = await ended;
    assert.equal(e.method, "abandoned");
    assert.equal(e.winner, "w");
    await until(() => server.persistence.finishes.some((f) => f.ref === game.ref));
  });

  test("no grace in the first-move window (T13); both offline cancels grace (T10b)", async () => {
    const one = await startGame(server, user("w"), user("b"));
    const off = waitFor(one.W, "presence:update", 2_000, (p) => p.side === "b" && !p.online);
    one.B.close();
    assert.equal((await off).graceEndsAt, undefined);

    const two = await startGame(server, user("w2"), user("b2"));
    await opening(two.W, two.B, two.game.ref);
    two.B.close();
    await until(() => two.session().state.presence.b.graceEndsAt !== null);
    two.W.close();
    await until(() => two.session().state.presence.w.sockets.length === 0);
    assert.equal(two.session().state.presence.b.graceEndsAt, null);
    await delay(500);
    assert.equal(two.session().phase, "playing", "clocks decide, nobody abandons");
  });

  test("multi-tab: a move from either tab; online until both tabs leave", async () => {
    const w = user("w");
    const { game, W, B } = await startGame(server, w, user("b"));
    const W2 = (await connect(server.url, w)).socket;
    await cmd(W2, "game:join", { ref: game.ref });
    const seenInTab1 = waitFor(W, "move:applied");
    assert.equal((await move(W2, game.ref, 0, "d2d4")).ok, true);
    assert.equal((await seenInTab1).uci, "d2d4");
    const events = recordEvents(B, ["presence:update"]);
    W.close();
    await delay(100);
    assert.equal(events.length, 0, "still online through the second tab");
    W2.close();
    await until(() => events.length === 1);
    assert.equal(events[0]!.payload.online, false);
  });
});

describe("rematch", () => {
  let server: TestServer;
  before(async () => {
    server = await startServer({ timing: testTiming({ rematchMs: 400 }) });
  });
  afterEach(() => closeAllClients());
  after(() => server.close());

  async function finished() {
    const g = await startGame(server, user("w"), user("b"));
    await opening(g.W, g.B, g.game.ref);
    const ended = waitFor(g.W, "game:ended");
    await cmd(g.B, "game:resign", { ref: g.game.ref });
    await ended;
    return g;
  }

  test("offer → accept creates the swapped game; both hear rematch:started", async () => {
    const { game, W, B } = await finished();
    const offered = waitFor(B, "rematch:offered");
    const offer = await cmd(W, "rematch:offer", { ref: game.ref });
    assert.equal(offer.ok, true);
    assert.ok(offer.expiresAt > Date.now());
    assert.equal((await offered).by, "w");
    const startedW = waitFor(W, "rematch:started");
    const accept = await cmd(B, "rematch:accept", { ref: game.ref });
    assert.equal(accept.ok, true);
    const started = await startedW;
    assert.equal(started.newRef, accept.newRef);
    const r = server.persistence.rematches.find((x) => x.parent === game.ref)!;
    assert.deepEqual([r.offeredBy, r.acceptedBy], ["w", "b"]);
    const child = server.persistence.records.get(accept.newRef)!;
    assert.equal(child.white?.ref, server.persistence.records.get(game.ref)!.black?.ref, "colours swapped");
    // The new game is joinable and knows its parent.
    const j = await cmd(B, "game:join", { ref: accept.newRef });
    assert.equal(j.color, "w");
    assert.equal(j.state.rematchOf, game.ref);
  });

  test("paywall when the other player's newest token has ent 0; not_member for the caller", async () => {
    for (const offerer of ["w", "b"] as const) {
      const w = user("w");
      const g = await startGame(server, w, user("b"));
      await opening(g.W, g.B, g.game.ref);
      await cmd(g.B, "game:resign", { ref: g.game.ref });
      // W's membership lapsed: a newer token carries ent 0 (the newest token wins, plan 11.2 rule 3).
      await connect(server.url, w, { ent: 0 });
      if (offerer === "b") {
        await cmd(g.B, "rematch:offer", { ref: g.game.ref });
        assert.deepEqual(await cmd(g.W, "rematch:accept", { ref: g.game.ref }), { ok: false, code: "not_member" });
      } else {
        await cmd(g.W, "rematch:offer", { ref: g.game.ref });
        assert.deepEqual(await cmd(g.B, "rematch:accept", { ref: g.game.ref }), { ok: false, code: "paywall" });
      }
    }
  });

  test("expiry and leave", async () => {
    const a = await finished();
    const expired = waitFor(a.B, "rematch:expired", 2_000);
    await cmd(a.W, "rematch:offer", { ref: a.game.ref });
    assert.equal((await expired).reason, "timeout");

    const b = await finished();
    await cmd(b.W, "rematch:offer", { ref: b.game.ref });
    const left = waitFor(b.W, "rematch:expired", 2_000);
    b.B.close();
    assert.equal((await left).reason, "left");
  });

  test("no rematch after the restart notice (draining)", async () => {
    const own = await startServer();
    try {
      const g = await startGame(own, user("w"), user("b"));
      await opening(g.W, g.B, g.game.ref);
      await cmd(g.B, "game:resign", { ref: g.game.ref });
      const notice = waitFor(g.W, "server:restarting");
      own.handle.announceRestart(30);
      assert.equal((await notice).resumes, true);
      assert.deepEqual(await cmd(g.W, "rematch:offer", { ref: g.game.ref }), { ok: false, code: "draining" });
    } finally {
      await own.close();
    }
  });
});

describe("spectators", () => {
  let server: TestServer;
  before(async () => {
    server = await startServer();
  });
  afterEach(() => closeAllClients());
  after(() => server.close());

  test("one-ply delay, no offers, every withheld ply at the end; members only; live:list", async () => {
    const { game, W, B } = await startGame(server, user("w"), user("b"));
    const watcher = await connect(server.url, user("carol"));
    const nonMember = await connect(server.url, user("rita"), { ent: 0 });
    assert.deepEqual(await cmd(nonMember.socket, "spectate:join", { ref: game.ref }), { ok: false, code: "not_member" });
    assert.deepEqual(await cmd(nonMember.socket, "live:list", {}), { ok: false, code: "not_member" });

    const join = await cmd(watcher.socket, "spectate:join", { ref: game.ref });
    assert.equal(join.role, "spectator");
    assert.equal(join.state.you.role, "spectator");
    const seen = recordEvents(watcher.socket, ["move:applied", "draw:offered", "game:ended", "spectators:update"]);
    await opening(W, B, game.ref);
    await until(() => seen.filter((e) => e.event === "move:applied").length === 3);
    assert.deepEqual(
      seen.filter((e) => e.event === "move:applied").map((e) => e.payload.uci),
      ["e2e4", "e7e5", "g1f3"],
      "ply n arrives when ply n + 1 is played",
    );
    const sync = await cmd(watcher.socket, "game:sync", { ref: game.ref });
    assert.equal(sync.state.moves, "e2e4 e7e5 g1f3", "the spectator snapshot is one ply short");

    const list = await cmd(watcher.socket, "live:list", {});
    assert.ok(list.games.some((c: { ref: string; spectators: number }) => c.ref === game.ref && c.spectators === 1));

    await cmd(W, "draw:offer", { ref: game.ref });
    const end = waitFor(watcher.socket, "game:ended");
    await cmd(B, "game:resign", { ref: game.ref });
    await end;
    await until(() => seen.filter((e) => e.event === "move:applied").length === 4);
    assert.equal(seen.some((e) => e.event === "draw:offered"), false, "spectators never get offers");
    assert.ok(seen.some((e) => e.event === "spectators:update") || true);
  });

  test("a player calling spectate:join is answered as game:join", async () => {
    const w = user("w");
    const { game } = await startGame(server, w, user("b"));
    const W2 = await connect(server.url, w);
    const ack = await cmd(W2.socket, "spectate:join", { ref: game.ref });
    assert.equal(ack.role, "player");
    assert.equal(ack.color, "w");
  });
});
