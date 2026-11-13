// Join and play (phase-02 plan 12.4 `join` / `play`, without a database): join from the store, a second join hits
// memory, roles from the server, the Opera Game to mate with seq + 1 per event, clocks after both first moves, the
// final move in the finish, game:result after the commit, move refusals.
import { after, afterEach, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  OPERA_START_FEN,
  OPERA_UCI,
  closeAllClients,
  cmd,
  connect,
  delay,
  move,
  moveId,
  record,
  recordEvents,
  startGame,
  startServer,
  until,
  user,
  waitFor,
  type TestServer,
} from "./helpers";

describe("game:join", () => {
  let server: TestServer;
  before(async () => {
    server = await startServer();
  });
  afterEach(() => closeAllClients());
  after(() => server.close());

  test("a player joins from the store; a second join hits memory (no second load)", async () => {
    const [a, b] = [user("alice"), user("bob")];
    const game = server.persistence.add(record({ white: a, black: null }));
    const loadsBefore = server.persistence.loads;
    const A = await connect(server.url, a);
    const ack = await cmd(A.socket, "game:join", { ref: game.ref });
    assert.equal(ack.ok, true);
    assert.equal(ack.role, "player");
    assert.equal(ack.color, "w");
    assert.equal(ack.state.phase, "waiting");
    assert.equal(ack.state.you.color, "w");
    const A2 = await connect(server.url, a);
    const ack2 = await cmd(A2.socket, "game:join", { ref: game.ref });
    assert.equal(ack2.ok, true);
    assert.equal(server.persistence.loads - loadsBefore, 1, "the reconnect makes no query");
    void b;
  });

  test("concurrent first joins share one load", async () => {
    const [a, b] = [user("a"), user("b")];
    const game = server.persistence.add(record({ white: a, black: b }));
    server.persistence.loadDelayMs = 50;
    const before = server.persistence.loads;
    const A = await connect(server.url, a);
    const B = await connect(server.url, b);
    const [ja, jb] = await Promise.all([
      cmd(A.socket, "game:join", { ref: game.ref }),
      cmd(B.socket, "game:join", { ref: game.ref }),
    ]);
    server.persistence.loadDelayMs = 0;
    assert.equal(ja.ok && jb.ok, true);
    assert.equal(server.persistence.loads - before, 1);
  });

  // regression (INTEGRATE-2 restart smoke): joins released together (one load, or the boot restore gate) attach one
  // after the other before the first ack is sent; that ack must not carry a state older than the room events its
  // socket already received (the client ignores events at or below its seq and kept the stale snapshot).
  test("concurrent joins: the first ack is not older than the room events delivered before it", async () => {
    const [a, b] = [user("a"), user("b")];
    const game = server.persistence.add(record({ white: a, black: b }));
    server.persistence.loadDelayMs = 50;
    const A = await connect(server.url, a);
    const B = await connect(server.url, b);
    const seen: number[] = [];
    let ackSeq = -1;
    for (const ev of ["presence:update", "game:phase", "clock:sync"]) {
      A.socket.on(ev, (p: { seq?: number }) => {
        if (ackSeq < 0 && typeof p.seq === "number") seen.push(p.seq);
      });
    }
    const [ja, jb] = await Promise.all([
      cmd(A.socket, "game:join", { ref: game.ref }).then((r) => {
        ackSeq = r.state.seq;
        return r;
      }),
      cmd(B.socket, "game:join", { ref: game.ref }),
    ]);
    server.persistence.loadDelayMs = 0;
    assert.equal(ja.ok && jb.ok, true);
    assert.ok(seen.every((s) => s <= ja.state.seq), `events before the ack ${JSON.stringify(seen)} vs ack seq ${ja.state.seq}`);
    assert.equal(ja.state.players.b.online, true, "the first player's snapshot already shows the second one online");
  });

  test("a non-player gets forbidden; an unknown ref not_found; a bad payload internal", async () => {
    const [a, b, c] = [user("a"), user("b"), user("carol")];
    const game = server.persistence.add(record({ white: a, black: b }));
    const C = await connect(server.url, c);
    assert.deepEqual(await cmd(C.socket, "game:join", { ref: game.ref }), { ok: false, code: "forbidden" });
    assert.deepEqual(await cmd(C.socket, "game:join", { ref: "cnotarealgame0000000000000" }), { ok: false, code: "not_found" });
    assert.deepEqual(await cmd(C.socket, "game:join", { ref: "x" }), { ok: false, code: "internal" });
    assert.equal(server.metrics.counts.get("ws.invalid_payload{event=game:join}"), 1);
  });

  test("bot games never use the socket", async () => {
    const a = user("a");
    const game = server.persistence.add(record({ white: a, black: null, mode: "BOT", status: "IN_PROGRESS" }));
    const A = await connect(server.url, a);
    assert.deepEqual(await cmd(A.socket, "game:join", { ref: game.ref }), { ok: false, code: "forbidden" });
  });

  test("a friend who joined through the web after the session loaded is seated by one re-read", async () => {
    const [a, b] = [user("a"), user("b")];
    const game = server.persistence.add(record({ white: a, black: null }));
    const A = await connect(server.url, a);
    await cmd(A.socket, "game:join", { ref: game.ref });
    // POST /api/chess/join fills the empty colour in the DB.
    const row = server.persistence.records.get(game.ref)!;
    row.black = { userId: b.id, ref: b.ref, name: b.name, rating: 1500, title: null, avatarUrl: null };
    row.status = "IN_PROGRESS";
    const B = await connect(server.url, b);
    const phase = waitFor(A.socket, "game:phase");
    // regression (INTEGRATE-2 smoke): the creator also gets the new player's name (own projection, game:snapshot).
    const snapshot = waitFor(A.socket, "game:snapshot");
    const jb = await cmd(B.socket, "game:join", { ref: game.ref });
    assert.equal(jb.ok, true);
    assert.equal(jb.color, "b");
    assert.equal((await phase).phase, "first_move");
    const snap = await snapshot;
    assert.equal(snap.players.b.displayName, b.name);
    assert.equal(snap.you.color, "w");
  });
});

describe("play", () => {
  let server: TestServer;
  before(async () => {
    server = await startServer();
  });
  afterEach(() => closeAllClients());
  after(() => server.close());

  test("regression: socket-start-game-attach-race — startGame returns after White has every event of Black's join", async () => {
    for (let round = 0; round < 5; round++) {
      const [w, b] = [user(`race-w${round}`), user(`race-b${round}`)];
      const { W, jb } = await startGame(server, w, b);
      const late: number[] = [];
      W.onAny((_event: string, payload: { seq?: unknown } | null) => {
        if (typeof payload?.seq === "number" && payload.seq <= jb.state.seq) late.push(payload.seq);
      });
      await delay(60);
      assert.deepEqual(late, [], "no room event at or below the join seq reaches White after startGame");
    }
  });

  test("the Opera Game to 17.Rd8#: first moves, clocks after both, seq + 1, finish with every ply, game:result", async () => {
    const [w, b] = [user("morphy"), user("duke")];
    const { game, W, B, jw, jb } = await startGame(server, w, b);
    assert.equal(jb.state.phase, "first_move");
    assert.equal(jb.state.firstMove.side, "w");
    assert.equal(jw.state.clocks.run, null);

    const seen = recordEvents(W, ["move:applied", "game:phase", "game:ended", "game:result", "draw:declined", "presence:update"]);
    const ended = waitFor(B, "game:ended");
    const result = waitFor(W, "game:result");
    let lastSeq = jb.state.seq; // B's join ack already includes the attach events
    for (let i = 0; i < OPERA_UCI.length; i++) {
      const mover = i % 2 === 0 ? W : B;
      if (i > 0) await delay(55); // ≤ 10 moves a second per socket (plan 7.4.4)
      const ack = await move(mover, game.ref, i, OPERA_UCI[i]!);
      assert.equal(ack.ok, true, `ply ${i + 1}: ${JSON.stringify(ack)}`);
      assert.equal(ack.ply, i + 1);
      if (i === 0) assert.equal(ack.clocks.run, null, "clocks stay frozen after White's first move");
    }
    const playing = seen.find((e) => e.event === "game:phase" && e.payload.phase === "playing");
    assert.equal(playing?.payload.clocks.run, "w", "clocks start after both first moves");
    const end = await ended;
    assert.equal(end.method, "checkmate");
    assert.equal(end.winner, "w");
    assert.equal(end.ply, 33);
    const res = await result;
    // P3: the in-memory persistence has no jobs table, so the session's own eligibility rule answers (33 plies ≥ 6).
    assert.deepEqual(res.review, { status: "queued", etaSec: null });
    await until(() => seen.some((e) => e.event === "game:result"));
    for (const { payload } of seen) {
      assert.equal(payload.seq, lastSeq + 1, `every game-room event carries seq + 1: ${JSON.stringify(seen.map((e) => [e.event, e.payload.seq]))}`);
      lastSeq = payload.seq;
    }
    assert.equal(server.persistence.finishes.length, 1);
    assert.equal(server.persistence.finishes[0]!.moves, OPERA_UCI.join(" "), "the mating move is in the finish (F-07)");
    const started = server.telemetry.events.filter((e) => e.event === "game_started");
    const endedEv = server.telemetry.events.filter((e) => e.event === "game_ended");
    assert.equal(started.length, 2);
    assert.equal(endedEv.length, 2);
    assert.equal(endedEv[0]!.props.method, "checkmate");
    assert.equal(endedEv[0]!.props.mode, "friend");
  });

  test("refusals: not_your_turn, stale_ply (+state), illegal (+state), promotion_required, duplicate clientMoveId", async () => {
    const [w, b] = [user("w"), user("b")];
    const { game, W, B } = await startGame(server, w, b);
    assert.deepEqual(await move(B, game.ref, 0, "e7e5"), { ok: false, code: "not_your_turn" });
    const stale = await move(W, game.ref, 3, "e2e4");
    assert.equal(stale.code, "stale_ply");
    assert.equal(stale.state.moves, "");
    const illegal = await move(W, game.ref, 0, "e2e5");
    assert.equal(illegal.code, "illegal");
    assert.ok(illegal.state);
    const id = moveId();
    const first = await cmd(W, "game:move", { ref: game.ref, ply: 0, uci: "e2e4", clientMoveId: id });
    const again = await cmd(W, "game:move", { ref: game.ref, ply: 0, uci: "e2e4", clientMoveId: id });
    assert.deepEqual(again, first, "a resend with the same clientMoveId replays the ack");
    assert.equal(server.handle.registry.get(game.ref)!.state.moves.length, 1);
  });

  test("promotion needs an explicit piece", async () => {
    const [w, b] = [user("w"), user("b")];
    const { game, W } = await startGame(server, w, b, { startingFen: "8/1P5k/8/8/8/8/6K1/8 w - - 0 41" });
    assert.deepEqual(await move(W, game.ref, 80, "b7b8"), { ok: false, code: "promotion_required" });
    const ok = await move(W, game.ref, 80, "b7b8n");
    assert.equal(ok.ok, true);
    assert.equal(ok.san, "b8=N");
  });

  test("a study start: study phase, both ready ends it early", async () => {
    const [w, b] = [user("w"), user("b")];
    const { game, W, B, jb } = await startGame(server, w, b, { startingFen: OPERA_START_FEN, studySeconds: 30 });
    assert.equal(jb.state.phase, "study");
    assert.ok(jb.state.study.endsAt > Date.now());
    assert.deepEqual(await move(W, game.ref, 18, "c3b5"), { ok: false, code: "phase" });
    const readyEv = waitFor(B, "study:ready");
    const r1 = await cmd(W, "study:ready", { ref: game.ref });
    assert.deepEqual(r1, { ok: true, ready: { w: true, b: false } });
    assert.equal((await readyEv).side, "w");
    const phase = waitFor(W, "game:phase", 3_000, (p) => p.phase === "first_move");
    await cmd(B, "study:ready", { ref: game.ref });
    assert.equal((await phase).firstMove.side, "w");
  });

  test("game:sync answers the caller's view; game:leave detaches", async () => {
    const [w, b] = [user("w"), user("b")];
    const { game, W, B } = await startGame(server, w, b);
    await move(W, game.ref, 0, "e2e4");
    const sync = await cmd(B, "game:sync", { ref: game.ref });
    assert.equal(sync.state.moves, "e2e4");
    assert.equal(sync.state.you.color, "b");
    const presence = waitFor(B, "presence:update");
    assert.deepEqual(await cmd(W, "game:leave", { ref: game.ref }), { ok: true });
    assert.equal((await presence).online, false);
    assert.deepEqual(await cmd(W, "game:sync", { ref: game.ref }), { ok: false, code: "not_found" });
  });

  test("abort: only the side to move in the first-move window; resign before your first move aborts", async () => {
    const [w, b] = [user("w"), user("b")];
    const one = await startGame(server, w, b);
    assert.deepEqual(await cmd(one.B, "game:abort", { ref: one.game.ref }), { ok: false, code: "not_allowed" });
    const ended = waitFor(one.B, "game:ended");
    assert.deepEqual(await cmd(one.W, "game:abort", { ref: one.game.ref }), { ok: true });
    const e = await ended;
    assert.equal(e.method, "aborted");
    assert.equal(e.abortedBy, "w");
    await until(() => server.persistence.aborts.some((a) => a.ref === one.game.ref));
    assert.equal(server.persistence.aborts.find((a) => a.ref === one.game.ref)!.abortedBy, "w");

    const [w2, b2] = [user("w2"), user("b2")];
    const two = await startGame(server, w2, b2);
    await move(two.W, two.game.ref, 0, "e2e4");
    const end2 = waitFor(two.W, "game:ended");
    assert.deepEqual(await cmd(two.B, "game:resign", { ref: two.game.ref }), { ok: true });
    assert.equal((await end2).method, "aborted");
  });

  test("resign while playing: the other side wins by resignation", async () => {
    const [w, b] = [user("w"), user("b")];
    const { game, W, B } = await startGame(server, w, b);
    await move(W, game.ref, 0, "e2e4");
    await move(B, game.ref, 1, "e7e5");
    const ended = waitFor(W, "game:ended");
    await cmd(B, "game:resign", { ref: game.ref });
    const e = await ended;
    assert.equal(e.method, "resignation");
    assert.equal(e.winner, "w");
  });
});
