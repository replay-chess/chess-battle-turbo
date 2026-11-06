// Neon scale-to-zero through the socket's outbox (phase-02 plan 12.4 `neon-suspend`, 6.7): mid-game every connection
// of the socket's client is terminated (what Neon does on suspend). The next checkpoint fails once, the pool is
// reset, the statement is retried at once and succeeds; it counts as `ws.persist.reconnect`, never
// `ws.persist.fail`; the process stays up and the finish stores every ply.
import { after, afterEach, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { closeAllClients, cmd, delay, testTiming, until, waitFor } from "./helpers";
import { DB_SKIP, disconnectAdmin, gameRow, playLine, startDbGame, startDbServer, terminateBackends, type DbServer } from "./db";

describe("neon suspend (Postgres)", { skip: DB_SKIP }, () => {
  let server: DbServer;
  before(async () => {
    server = await startDbServer({ timing: testTiming({}, { checkpointPlies: 4, checkpointMaxAgeMs: 60_000 }) });
  });
  afterEach(() => closeAllClients());
  after(async () => {
    await server.close();
    await disconnectAdmin();
  });

  test("a suspend mid-game: one reconnect, no failure, every ply stored", async () => {
    const { game, W, B } = await startDbGame(server);
    await playLine(W, B, game.ref, ["e2e4", "e7e5", "g1f3", "b8c6"]);
    await until(() => (server.metrics.samples.get("ws.persist.ms{op=checkpoint}") ?? []).length >= 1, 5_000, "first checkpoint");
    await delay(100);
    assert.ok((await terminateBackends(server.sql.appName)) >= 1, "the socket's connections were closed");
    await playLine(W, B, game.ref, ["f1b5", "a7a6", "b5a4", "g8f6"], 4);
    await until(() => (server.metrics.samples.get("ws.persist.ms{op=checkpoint}") ?? []).length >= 2, 10_000, "second checkpoint");
    assert.ok((server.metrics.counts.get("ws.persist.reconnect{op=checkpoint}") ?? 0) >= 1, "counted as a reconnect");
    assert.equal([...server.metrics.counts.keys()].filter((k) => k.startsWith("ws.persist.fail")).length, 0, "never as a failure");
    assert.equal((await gameRow(game.id)).plyCount, 8);
    const result = waitFor(W, "game:result", 10_000);
    await cmd(B, "game:resign", { ref: game.ref });
    await result;
    const row = await gameRow(game.id);
    assert.equal(row.status, "COMPLETED");
    assert.equal(row.moves, "e2e4 e7e5 g1f3 b8c6 f1b5 a7a6 b5a4 g8f6");
  });
});
