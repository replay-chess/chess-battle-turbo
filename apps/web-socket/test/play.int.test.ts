// A full game against Postgres (phase-02 plan 12.4 `play`): the Opera Game to 17.Rd8# through the real outbox;
// every `move:applied` carries seq + 1; the final move is in `moves` and in the PGN (F-07); game_players results;
// user_stats counted once; gamesVersion bumped once. Plus a study start (study → ready → first move) persisted.
import { after, afterEach, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { OPERA_START_FEN, OPERA_UCI, closeAllClients, cmd, recordEvents, waitFor } from "./helpers";
import {
  DB_SKIP,
  disconnectAdmin,
  gameRow,
  playLine,
  playerResults,
  startDbGame,
  startDbServer,
  userStats,
  type DbServer,
} from "./db";

describe("play (Postgres)", { skip: DB_SKIP }, () => {
  let server: DbServer;
  before(async () => {
    server = await startDbServer();
  });
  afterEach(() => closeAllClients());
  after(async () => {
    await server.close();
    await disconnectAdmin();
  });

  test("the Opera Game to mate: seq + 1, every ply and the PGN stored, results and stats once", async () => {
    const { w, b, game, W, B, jb } = await startDbGame(server);
    const statsBefore = [await userStats(w.id), await userStats(b.id)];
    const seen = recordEvents(W, ["move:applied"]);
    const ended = waitFor(B, "game:ended", 10_000);
    const result = waitFor(W, "game:result", 10_000);
    await playLine(W, B, game.ref, OPERA_UCI);
    const end = await ended;
    assert.equal(end.method, "checkmate");
    await result; // after the finish committed
    let seq = 0;
    for (const { payload } of seen) {
      if (seq) assert.ok(payload.seq > seq, "seq grows");
      seq = payload.seq;
    }
    assert.ok(jb.state.seq < seen[0]!.payload.seq);
    const row = await gameRow(game.id);
    assert.equal(row.status, "COMPLETED");
    assert.equal(row.endMethod, "CHECKMATE");
    assert.equal(row.outcome, "WHITE");
    assert.equal(row.moves, OPERA_UCI.join(" "), "the mating move is stored (F-07)");
    assert.equal(row.plyCount, 33);
    assert.match(row.pgn, /Rd8#/);
    assert.match(row.pgn, /1-0/);
    assert.deepEqual(await playerResults(game.id), { w: "WIN", b: "LOSS" });
    const [sw, sb] = [await userStats(w.id), await userStats(b.id)];
    assert.equal(sw.total - statsBefore[0]!.total, 1);
    assert.equal(sw.won - statsBefore[0]!.won, 1);
    assert.equal(sb.lost - statsBefore[1]!.lost, 1);
    assert.equal(sw.version - statsBefore[0]!.version, 1, "gamesVersion bumped once");
    assert.equal(server.metrics.counts.get("ws.persist.fail{code=unknown,op=checkpoint}"), undefined);
    assert.ok((server.metrics.samples.get("ws.persist.ms{op=checkpoint}") ?? []).length >= 3, "checkpoints every 10 plies");
  });

  test("a study start: study, both ready, first move; the phase reaches the row", async () => {
    const { game, W, B, jb } = await startDbGame(server, { startingFen: OPERA_START_FEN });
    assert.equal(jb.state.phase, "study");
    const firstMove = waitFor(W, "game:phase", 3_000, (p) => p.phase === "first_move");
    await cmd(W, "study:ready", { ref: game.ref });
    await cmd(B, "study:ready", { ref: game.ref });
    await firstMove;
    // The phase change is a checkpoint opportunity (max age 300 ms in tests).
    let row = await gameRow(game.id);
    for (let i = 0; i < 30 && row.phase !== "FIRST_MOVE"; i++) {
      await new Promise((r) => setTimeout(r, 100));
      row = await gameRow(game.id);
    }
    assert.equal(row.phase, "FIRST_MOVE");
  });
});
