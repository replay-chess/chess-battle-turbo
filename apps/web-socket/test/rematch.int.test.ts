// Rematch (phase-02 plan 12.4 `rematch`, 6.6.6, 8.8): offer → accept creates a new game with swapped colours and
// `rematchOfId`; `paywall` when the other player's newest token has `ent = 0`; an unanswered offer expires.
import { after, afterEach, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { closeAllClients, cmd, connect, move, testTiming, waitFor } from "./helpers";
import { DB_SKIP, disconnectAdmin, gameByRef, makeGame, makeUser, startDbServer, type DbServer } from "./db";

async function finishedGame(server: DbServer) {
  const [w, b] = [await makeUser("w"), await makeUser("b")];
  const game = await makeGame(w, b);
  const W = (await connect(server.url, w)).socket;
  const B = (await connect(server.url, b)).socket;
  await cmd(W, "game:join", { ref: game.ref });
  await cmd(B, "game:join", { ref: game.ref });
  await move(W, game.ref, 0, "e2e4");
  await move(B, game.ref, 1, "e7e5");
  const result = waitFor(W, "game:result", 5_000);
  await cmd(B, "game:resign", { ref: game.ref });
  await result;
  return { w, b, game, W, B };
}

describe("rematch (Postgres)", { skip: DB_SKIP }, () => {
  let server: DbServer;
  before(async () => {
    server = await startDbServer({ timing: testTiming({ rematchMs: 800 }) });
  });
  afterEach(() => closeAllClients());
  after(async () => {
    await server.close();
    await disconnectAdmin();
  });

  test("offer → accept: a new row with swapped colours and rematchOfId", async () => {
    const { w, b, game, W, B } = await finishedGame(server);
    const offered = waitFor(B, "rematch:offered");
    assert.equal((await cmd(W, "rematch:offer", { ref: game.ref })).ok, true);
    await offered;
    const started = waitFor(W, "rematch:started", 5_000);
    const ack = await cmd(B, "rematch:accept", { ref: game.ref });
    assert.equal(ack.ok, true, JSON.stringify(ack));
    const s = await started;
    assert.equal(s.newRef, ack.newRef);
    assert.deepEqual(s.colors, { w: b.ref, b: w.ref });
    const child = await gameByRef(ack.newRef);
    assert.equal(child.rematchOfId, game.id);
    assert.equal(child.whitePlayerId, b.id);
    assert.equal(child.blackPlayerId, w.id);
    assert.equal(child.status, "IN_PROGRESS");
  });

  test("paywall when the other player's newest token has ent 0", async () => {
    const { w, game, W, B } = await finishedGame(server);
    // W's membership lapsed: a newer token of W carries ent 0 (the newest token wins, plan 11.2 rule 3).
    await connect(server.url, w, { ent: 0 });
    assert.equal((await cmd(W, "rematch:offer", { ref: game.ref })).ok, true);
    assert.deepEqual(await cmd(B, "rematch:accept", { ref: game.ref }), { ok: false, code: "paywall" });
  });

  test("an unanswered offer expires", async () => {
    const { game, W, B } = await finishedGame(server);
    assert.equal((await cmd(W, "rematch:offer", { ref: game.ref })).ok, true);
    const expired = await waitFor(B, "rematch:expired", 3_000);
    assert.equal(expired.reason, "timeout");
  });
});
