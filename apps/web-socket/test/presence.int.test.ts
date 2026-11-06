// Disconnects (phase-02 plan 12.4 `presence`, 8.6, F-10): a player's last socket leaving → `presence:update` with
// `graceEndsAt`; coming back clears it; the grace running out → `abandoned`, the absent side loses (stored with the
// right winner); nobody moving in the first-move window → aborted (stored ABORTED, abortedBy timeout).
import { after, afterEach, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { closeAllClients, cmd, connect, testTiming, waitFor } from "./helpers";
import { DB_SKIP, disconnectAdmin, gameRow, playLine, startDbGame, startDbServer, type DbServer } from "./db";

async function rowWhen(id: bigint, status: string) {
  let row = await gameRow(id);
  for (let i = 0; i < 50 && row.status !== status; i++) {
    await new Promise((r) => setTimeout(r, 100));
    row = await gameRow(id);
  }
  return row;
}

describe("presence (Postgres)", { skip: DB_SKIP }, () => {
  let server: DbServer;
  before(async () => {
    server = await startDbServer({ timing: testTiming({ graceMs: 700, graceFlappingMs: 700, firstMoveMs: 700 }) });
  });
  afterEach(() => closeAllClients());
  after(async () => {
    await server.close();
    await disconnectAdmin();
  });

  test("grace, return, grace expiry → abandoned with the absent side losing", async () => {
    const { b, game, W, B } = await startDbGame(server);
    await playLine(W, B, game.ref, ["e2e4", "e7e5", "g1f3"]);
    const away = waitFor(W, "presence:update", 2_000, (p) => p.side === "b" && !p.online);
    B.close();
    const p = await away;
    assert.ok(p.graceEndsAt > Date.now());
    const back = waitFor(W, "presence:update", 2_000, (q) => q.side === "b" && q.online);
    const B2 = await connect(server.url, b);
    await cmd(B2.socket, "game:join", { ref: game.ref });
    assert.equal((await back).graceEndsAt, undefined, "the return clears the grace");
    const ended = waitFor(W, "game:ended", 5_000);
    B2.socket.close();
    const e = await ended;
    assert.equal(e.method, "abandoned");
    assert.equal(e.winner, "w");
    const row = await rowWhen(game.id, "COMPLETED");
    assert.equal(row.endMethod, "ABANDONED");
    assert.equal(row.outcome, "WHITE");
  });

  test("no first move in the window → aborted (stored, abortedBy timeout)", async () => {
    const { game, W } = await startDbGame(server);
    const e = await waitFor(W, "game:ended", 5_000);
    assert.equal(e.method, "aborted");
    const row = await rowWhen(game.id, "ABORTED");
    assert.equal(row.status, "ABORTED");
    assert.equal(row.meta.abortedBy, "timeout");
  });
});
