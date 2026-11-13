// The import purge and the analysis final batch of the same game lock in one order (m4t), so they never deadlock.
//
// regression: e2e stress of connected.spec + happy-path.spec (4 deadlocks in one run; Postgres log): import_purge_batch
// deleted the member's game_players row, bumped users, then deleted / updated the game (cascading to game_analyses),
// while the worker's final batch had marked the game DONE and then waited for that game_players row (the
// player_reviews FK). Here the final batch's own statements (sql-store.ts) run in an open transaction: the game is
// marked DONE, the purge starts on another connection, then the reviews are written. Before m4t the two waited for
// each other (40P01); now the purge waits for the game row before touching any player row, and both commit.
// The members' gamesVersion bump goes after the import-run count in the final batch (sql-store.ts finish): checked
// through the statement order. Skipped without TEST_DATABASE_URL.
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import pg from "pg";
import { gameDoneStatement, reviewsStatement, bumpMembersStatement } from "../../pipeline/sql-store";
import { makeGame, makeUser, setupInt, skipInt, TEST_URL, type IntEnv } from "../../testing/pg";

describe("import purge vs the final analysis batch (Postgres)", { skip: skipInt }, () => {
  let env: IntEnv;
  let analysis: pg.Client;

  before(async () => {
    env = await setupInt("purgelock");
    analysis = new pg.Client({ connectionString: TEST_URL });
    await analysis.connect();
  });
  after(async () => {
    await analysis?.end().catch(() => undefined);
    await env?.close();
  });

  it("a purge started while the game's final batch is open waits for it; neither is a deadlock victim", async () => {
    const member = await makeUser(env.owner, "plm");
    const other = await makeUser(env.owner, "plo");
    const g = await makeGame(env.owner, member, other);
    await env.owner.query(`UPDATE game_players SET source = 'CHESSCOM', "updatedAt" = now() WHERE "gameId" = $1`, [g.id]);
    await env.owner.query(`UPDATE games SET source = 'CHESSCOM', "updatedAt" = now() WHERE id = $1`, [g.id]);

    // The final batch, up to "DONE" (games row locked), in an open transaction.
    await analysis.query("BEGIN");
    const done = gameDoneStatement(g.id, null);
    await analysis.query(done.text, [...done.values]);

    // The purge of the member's Chess.com games on another connection.
    const purger = await env.owner.connect();
    const purge = purger
      .query(`SELECT deleted_players FROM import_purge_batch($1::bigint, 'CHESSCOM'::"GameSource", 10)`, [member.id])
      .finally(() => purger.release());
    purge.catch(() => undefined);
    const until = Date.now() + 10_000;
    for (;;) {
      const { rows } = await env.owner.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM pg_stat_activity WHERE wait_event_type = 'Lock' AND query LIKE '%import_purge_batch%'`,
      );
      if (rows[0]!.n > 0) break;
      assert.ok(Date.now() < until, "the purge reached the game");
      await new Promise((r) => setTimeout(r, 20));
    }

    // The rest of the final batch: the reviews (player_reviews FK → game_players), the members' gamesVersion.
    const reviews = reviewsStatement(g.id, [
      { color: "w", content: { v: 1 } },
      { color: "b", content: { v: 1 } },
    ] as never);
    const bump = bumpMembersStatement(g.id);
    const finish = (async () => {
      await analysis.query(reviews.text, [...reviews.values]);
      await analysis.query(bump.text, [...bump.values]);
      await analysis.query("COMMIT");
    })();
    const [batch, purged] = await Promise.allSettled([finish, purge]);
    assert.equal(batch.status, "fulfilled", `the final batch: ${batch.status === "rejected" ? String(batch.reason) : ""}`);
    assert.equal(purged.status, "fulfilled", `the purge: ${purged.status === "rejected" ? String(purged.reason) : ""}`);
    assert.equal((purged as PromiseFulfilledResult<pg.QueryResult<{ deleted_players: number }>>).value.rows[0]!.deleted_players, 1);
    const { rows } = await env.owner.query(`SELECT count(*)::int AS n FROM game_players WHERE "gameId" = $1 AND "userId" = $2`, [g.id, member.id]);
    assert.equal(rows[0]!.n, 0, "the member's side is purged after the batch committed");
  });
});
