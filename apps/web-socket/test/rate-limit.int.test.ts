// Command limits in the production composition (phase-02 plan 12.4 `rate-limit`, 7.4.8): 25 moves in one second →
// `rate_limited` with `retryAfterMs` (bucket 20 burst / 10 s⁻¹), counted per command. (The 5 s flood disconnect is
// covered without a server clock in handshake.test.ts.)
import { after, afterEach, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { closeAllClients, cmd } from "./helpers";
import { DB_SKIP, disconnectAdmin, startDbGame, startDbServer, type DbServer } from "./db";

describe("rate limit (Postgres)", { skip: DB_SKIP }, () => {
  let server: DbServer;
  before(async () => {
    server = await startDbServer();
  });
  afterEach(() => closeAllClients());
  after(async () => {
    await server.close();
    await disconnectAdmin();
  });

  test("25 moves in a second → rate_limited", async () => {
    const { game, W } = await startDbGame(server);
    const acks = await Promise.all(
      Array.from({ length: 25 }, (_, i) => cmd(W, "game:move", { ref: game.ref, ply: 0, uci: "e2e4", clientMoveId: `r${i}` })),
    );
    const limited = acks.filter((a) => a.code === "rate_limited");
    assert.ok(limited.length >= 5, `limited ${limited.length}`);
    assert.ok(limited.every((a) => a.retryAfterMs > 0));
    assert.ok((server.metrics.counts.get("ws.rate_limited{cmd=game:move}") ?? 0) >= 5);
  });
});
