// The finish runs twice (a lost response, then the retry; phase-02 plan 12.4 `finish-idempotent`, DB-04): the second
// statement finds `status <> 'IN_PROGRESS'` (finished = 0), the outbox treats the matching stored end as success,
// and user_stats / gamesVersion / game_players count once. No second `game_ended` event either.
import { after, afterEach, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { finishGame } from "@repo/db/live";
import { closeAllClients, cmd, move, waitFor } from "./helpers";
import { DB_SKIP, disconnectAdmin, gameRow, startDbGame, startDbServer, userStats, type DbServer } from "./db";

describe("finish idempotency (Postgres)", { skip: DB_SKIP }, () => {
  let server: DbServer;
  before(async () => {
    server = await startDbServer();
  });
  afterEach(() => closeAllClients());
  after(async () => {
    await server.close();
    await disconnectAdmin();
  });

  test("a second finish changes nothing and counts nothing", async () => {
    const { w, b, game, W, B, session } = await startDbGame(server);
    const before = [await userStats(w.id), await userStats(b.id)];
    await move(W, game.ref, 0, "e2e4");
    await move(B, game.ref, 1, "e7e5");
    const result = waitFor(W, "game:result", 5_000);
    await cmd(B, "game:resign", { ref: game.ref });
    await result;
    const s = session();
    const endResult = s.state.result!;
    // The same statement again (what a retry after a lost response sends).
    const again = await finishGame(server.sql.db, {
      gameId: game.id,
      moves: s.state.moves.join(" "),
      clocksMs: s.state.clocksMs,
      plyCount: s.state.moves.length,
      fen: s.state.fen,
      whiteTimeMs: 300_000,
      blackTimeMs: 300_000,
      method: "resignation",
      winner: "w",
      pgn: null,
      endedAt: new Date(endResult.endedAt),
    });
    assert.equal(again.finished, false, "finished = 0 the second time");
    assert.equal(again.conflict, false, "the stored end matches");
    // And through the outbox (the adapter's retry path).
    const out = await server.booted.persistence.finish(s, endResult);
    assert.equal(out.committed, true);
    const after = [await userStats(w.id), await userStats(b.id)];
    assert.equal(after[0]!.total - before[0]!.total, 1);
    assert.equal(after[0]!.won - before[0]!.won, 1);
    assert.equal(after[1]!.lost - before[1]!.lost, 1);
    assert.equal(after[0]!.version - before[0]!.version, 1);
    assert.equal((await gameRow(game.id)).endMethod, "RESIGNATION");
    assert.equal(server.telemetry.events.filter((e) => e.event === "game_ended" && e.distinctId === w.ref).length, 1);
  });
});
