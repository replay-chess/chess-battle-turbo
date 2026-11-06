// Draw offers (phase-02 plan 12.4 `draw`, 8.7, F-01): offer → decline → cooldown → accept after the cooldown; an
// accept with no open offer is refused; the agreement is stored as a draw and counted once.
import { after, afterEach, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { closeAllClients, cmd, waitFor } from "./helpers";
import { DB_SKIP, disconnectAdmin, gameRow, playLine, startDbGame, startDbServer, userStats, type DbServer } from "./db";

describe("draw (Postgres)", { skip: DB_SKIP }, () => {
  let server: DbServer;
  before(async () => {
    server = await startDbServer();
  });
  afterEach(() => closeAllClients());
  after(async () => {
    await server.close();
    await disconnectAdmin();
  });

  test("offer, decline, cooldown, accept; no_offer without an offer; stored as AGREEMENT", async () => {
    const { w, game, W, B } = await startDbGame(server);
    const before = await userStats(w.id);
    await playLine(W, B, game.ref, ["e2e4", "e7e5"]);
    assert.deepEqual(await cmd(B, "draw:accept", { ref: game.ref }), { ok: false, code: "no_offer" });
    const offered = waitFor(B, "draw:offered");
    assert.equal((await cmd(W, "draw:offer", { ref: game.ref })).ok, true);
    assert.equal((await offered).by, "w");
    const declined = waitFor(W, "draw:declined");
    assert.deepEqual(await cmd(B, "draw:decline", { ref: game.ref }), { ok: true });
    const d = await declined;
    const again = await cmd(W, "draw:offer", { ref: game.ref });
    assert.equal(again.code, "draw_cooldown");
    assert.equal(again.canOfferAtPly, d.canOfferAtPly);
    await playLine(W, B, game.ref, ["g1f3", "b8c6", "f1c4", "f8c5"], 2);
    assert.equal((await cmd(W, "draw:offer", { ref: game.ref })).ok, true);
    const ended = waitFor(W, "game:ended");
    const result = waitFor(W, "game:result", 5_000);
    assert.deepEqual(await cmd(B, "draw:accept", { ref: game.ref }), { ok: true });
    assert.equal((await ended).method, "agreement");
    await result;
    const row = await gameRow(game.id);
    assert.equal(row.endMethod, "AGREEMENT");
    assert.equal(row.outcome, "DRAW");
    assert.equal((await userStats(w.id)).drawn - before.drawn, 1);
  });
});
