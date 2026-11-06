// Two tabs of one player (phase-02 plan 12.4 `multitab`): both sockets are in `game:{ref}`; a move from either tab is
// accepted and seen by the other; the opponent sees the player go offline only when the last tab leaves.
import { after, afterEach, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { closeAllClients, cmd, connect, delay, move, recordEvents, waitFor } from "./helpers";
import { DB_SKIP, disconnectAdmin, startDbGame, startDbServer, type DbServer } from "./db";

describe("multitab (Postgres)", { skip: DB_SKIP }, () => {
  let server: DbServer;
  before(async () => {
    server = await startDbServer();
  });
  afterEach(() => closeAllClients());
  after(async () => {
    await server.close();
    await disconnectAdmin();
  });

  test("moves from either tab; presence stays online until both tabs leave", async () => {
    const { w, game, W, B } = await startDbGame(server);
    const W2 = await connect(server.url, w);
    assert.equal((await cmd(W2.socket, "game:join", { ref: game.ref })).color, "w");
    const seenByTab1 = waitFor(W, "move:applied");
    assert.equal((await move(W2.socket, game.ref, 0, "e2e4")).ok, true);
    assert.equal((await seenByTab1).uci, "e2e4");
    await move(B, game.ref, 1, "e7e5");
    assert.equal((await move(W, game.ref, 2, "g1f3")).ok, true);
    const presence = recordEvents(B, ["presence:update"]);
    W.close();
    await delay(300);
    assert.equal(presence.filter((p) => p.payload.side === "w" && !p.payload.online).length, 0, "one tab is still here");
    const offline = waitFor(B, "presence:update", 2_000, (p) => p.side === "w" && !p.online);
    W2.socket.close();
    assert.ok((await offline).graceEndsAt);
  });
});
