// Reconnect and the client outbox (phase-02 plan 12.4 `reconnect-outbox`, 5.2.4): the server keeps the session while
// a player is away; the player rejoins with `lastSeq` and gets the state; a queued move whose `ply` still matches is
// accepted, one made stale by the opponent's move is refused with `stale_ply` and the state.
import { after, afterEach, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { closeAllClients, cmd, connect, move } from "./helpers";
import { DB_SKIP, disconnectAdmin, playLine, startDbGame, startDbServer, type DbServer } from "./db";

describe("reconnect and the outbox (Postgres)", { skip: DB_SKIP }, () => {
  let server: DbServer;
  before(async () => {
    server = await startDbServer();
  });
  afterEach(() => closeAllClients());
  after(async () => {
    await server.close();
    await disconnectAdmin();
  });

  test("rejoin with lastSeq gets the state; a matching queued move is accepted, a stale one refused", async () => {
    const { w, game, W, B, jw } = await startDbGame(server);
    await playLine(W, B, game.ref, ["e2e4", "e7e5"]);
    W.close();
    await move(B, game.ref, 2, "d7d6").catch(() => undefined); // not B's turn: refused, the session is unchanged
    const queries = server.sql.queries();
    const W2 = await connect(server.url, w);
    const rejoin = await cmd(W2.socket, "game:join", { ref: game.ref, lastSeq: jw.state.seq });
    assert.equal(rejoin.ok, true);
    assert.equal(rejoin.state.moves, "e2e4 e7e5");
    assert.equal(server.sql.queries() - queries, 0, "the session was kept in memory");
    const stale = await move(W2.socket, game.ref, 1, "g1f3");
    assert.equal(stale.code, "stale_ply");
    assert.equal(stale.state.moves, "e2e4 e7e5");
    const ok = await move(W2.socket, game.ref, 2, "g1f3");
    assert.equal(ok.ok, true);
    assert.equal(ok.ply, 3);
  });
});
