// Spectators (phase-02 plan 12.4 `spectate`, 8.10): ply n reaches `spectate:{ref}` when ply n+1 is played (one-ply
// delay); spectators never see draw offers or rematch internals; at the end every withheld ply is released.
import { after, afterEach, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { closeAllClients, cmd, connect, delay, move, recordEvents, until, waitFor } from "./helpers";
import { DB_SKIP, disconnectAdmin, makeUser, startDbGame, startDbServer, type DbServer } from "./db";

describe("spectate (Postgres)", { skip: DB_SKIP }, () => {
  let server: DbServer;
  before(async () => {
    server = await startDbServer();
  });
  afterEach(() => closeAllClients());
  after(async () => {
    await server.close();
    await disconnectAdmin();
  });

  test("one ply behind; no offers; everything released at the end", async () => {
    const { game, W, B } = await startDbGame(server);
    const viewer = await makeUser("viewer");
    const V = (await connect(server.url, viewer)).socket;
    assert.equal((await cmd(V, "spectate:join", { ref: game.ref })).role, "spectator");
    const seen = recordEvents(V, ["move:applied", "draw:offered", "game:ended"]);
    await move(W, game.ref, 0, "e2e4");
    await delay(150);
    assert.equal(seen.filter((e) => e.event === "move:applied").length, 0, "ply 1 is withheld");
    await move(B, game.ref, 1, "e7e5");
    await until(() => seen.some((e) => e.event === "move:applied"), 2_000, "ply 1 released");
    assert.equal(seen.find((e) => e.event === "move:applied")!.payload.uci, "e2e4");
    await delay(60);
    await move(W, game.ref, 2, "g1f3");
    await cmd(B, "draw:offer", { ref: game.ref });
    const ended = waitFor(V, "game:ended", 3_000);
    await cmd(W, "game:resign", { ref: game.ref });
    await ended;
    await delay(100);
    const plies = seen.filter((e) => e.event === "move:applied").map((e) => e.payload.uci);
    assert.deepEqual(plies, ["e2e4", "e7e5", "g1f3"], "every withheld ply released at the end");
    assert.equal(seen.filter((e) => e.event === "draw:offered").length, 0, "no offers for spectators");
  });
});
