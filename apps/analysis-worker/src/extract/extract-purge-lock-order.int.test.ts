// The EXTRACT_MISTAKES batch and an import purge of the same game lock in one order (m4t), so they never deadlock.
//
// regression: extract-purge-deadlock (found while rebasing Phase 5 onto m4t). The §7.6 statements lock the game's
// player_reviews rows first (statement L) and update game_players later (statement 5). In J1 that is safe: P3's final
// batch has already updated the games row. The standalone EXTRACT_MISTAKES batch had no games lock, so
// import_purge_batch (game_analyses + games FOR UPDATE, then DELETE game_players, cascading to player_reviews) could
// hold the game_players row and wait for player_reviews while the extraction held player_reviews and waited for
// game_players: 40P01. The job now takes the game's game_analyses and games rows first (extractGameLockStatements), so
// the purge waits for the extraction to commit (or the other way round) and both succeed. Here the job's own
// statements run, as the worker role, in an open transaction around a purge started on another connection.
// Skipped without TEST_DATABASE_URL.
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import pg from "pg";
import { extractGameLockStatements } from "../jobs/extract-mistakes";
import { gameDoneStatement, linkedAccountsLockStatement, playersStatement, reviewsStatement } from "../pipeline/sql-store";
import { makeGame, makeUser, setupInt, skipInt, WORKER_URL, type IntEnv } from "../testing/pg";
import { bankVersionStatement, lockReviewsStatement, type BankRows } from "./bankStatements";

describe("Mistake Bank writes vs the P4 purge and unlink of the same game (Postgres)", { skip: skipInt }, () => {
  let env: IntEnv;
  let worker: pg.Client;

  before(async () => {
    env = await setupInt("extractlock");
    worker = new pg.Client({ connectionString: WORKER_URL });
    await worker.connect();
  });
  after(async () => {
    await worker?.end().catch(() => undefined);
    await env?.close();
  });

  it("a purge started while the extraction's batch is open waits for it; neither is a deadlock victim", async () => {
    const member = await makeUser(env.owner, "xlm");
    const other = await makeUser(env.owner, "xlo");
    const g = await makeGame(env.owner, member, other, { analysisStatus: "DONE" });
    await env.owner.query(`UPDATE game_players SET source = 'CHESSCOM', "updatedAt" = now() WHERE "gameId" = $1`, [g.id]);
    await env.owner.query(`UPDATE games SET source = 'CHESSCOM', "updatedAt" = now() WHERE id = $1`, [g.id]);
    const reviews = reviewsStatement(g.id, [
      { color: "w", content: { v: 1 } },
      { color: "b", content: { v: 1 } },
    ] as never);
    await env.owner.query(reviews.text, [...reviews.values]);

    // The job's batch (jobs/extract-mistakes.ts): the game locks, then statement L, in an open transaction.
    const rows = { gameId: g.id, userIds: [member.id], version: 1 } as unknown as BankRows;
    await worker.query("BEGIN");
    for (const s of [...extractGameLockStatements(g.id), lockReviewsStatement(rows)]) await worker.query(s.text, [...s.values]);

    // The purge of the member's Chess.com games on another connection.
    const purger = await env.owner.connect();
    const purge = purger
      .query(`SELECT deleted_players FROM import_purge_batch($1::bigint, 'CHESSCOM'::"GameSource", 10)`, [member.id])
      .finally(() => purger.release());
    purge.catch(() => undefined);
    const until = Date.now() + 10_000;
    for (;;) {
      const { rows: w } = await env.owner.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM pg_stat_activity WHERE wait_event_type = 'Lock' AND query LIKE '%import_purge_batch%'`,
      );
      if (w[0]!.n > 0) break;
      assert.ok(Date.now() < until, "the purge reached the game");
      await new Promise((r) => setTimeout(r, 20));
    }

    // Statement 5 (game_players."bankVersion"), then the commit.
    const finish = (async () => {
      const s = bankVersionStatement(rows);
      await worker.query(s.text, [...s.values]);
      await worker.query("COMMIT");
    })();
    const [batch, purged] = await Promise.allSettled([finish, purge]);
    if (batch.status === "rejected") await worker.query("ROLLBACK").catch(() => undefined);
    assert.equal(batch.status, "fulfilled", `the extraction: ${batch.status === "rejected" ? String(batch.reason) : ""}`);
    assert.equal(purged.status, "fulfilled", `the purge: ${purged.status === "rejected" ? String(purged.reason) : ""}`);
    assert.equal((purged as PromiseFulfilledResult<pg.QueryResult<{ deleted_players: number }>>).value.rows[0]!.deleted_players, 1);
    const { rows: left } = await env.owner.query(`SELECT count(*)::int AS n FROM game_players WHERE "gameId" = $1 AND "userId" = $2`, [
      g.id,
      member.id,
    ]);
    assert.equal(left[0]!.n, 0, "the member's side is purged after the extraction committed");
  });
  it("an unlink (DELETE linked_accounts, SET NULL on game_players) during J1's final batch waits for it; no deadlock", async () => {
    // regression: unlink-bankversion-deadlock (local e2e, connected.spec on webkit-iphone: DELETE /api/accounts/lichess
    // answered 500; Postgres: "DELETE FROM linked_accounts" vs "UPDATE game_players SET bankVersion"). J1 updates the
    // member's game_players row twice in one transaction (P3's analysis columns, then P5's bankVersion); the second
    // update re-runs the linked_accounts FK check (the row version is the transaction's own), which waits for the link
    // row the unlink is deleting, while the unlink's SET NULL waits for that game_players row. The final batch now
    // takes the game's linked accounts (FOR KEY SHARE) before it writes any game_players row.
    const member = await makeUser(env.owner, "ulm");
    const other = await makeUser(env.owner, "ulo");
    const g = await makeGame(env.owner, member, other, { analysisStatus: "RUNNING" });
    const { rows: link } = await env.owner.query<{ id: string }>(
      `INSERT INTO linked_accounts ("userId", provider, "externalId", username, "usernameLower", "updatedAt")
       VALUES ($1, 'LICHESS', $2, 'ulm', 'ulm', now()) RETURNING id::text AS id`,
      [member.id, `ext-${g.id}`],
    );
    await env.owner.query(`UPDATE game_players SET source = 'LICHESS', "linkedAccountId" = $2, "updatedAt" = now() WHERE "gameId" = $1 AND "userId" = $3`, [
      g.id,
      link[0]!.id,
      member.id,
    ]);

    // J1's batch up to the analysis columns (sql-store.ts finish), in an open transaction.
    const members = [
      { color: "w", content: { v: 1 }, accuracy: 80, headline: null, momentsCount: 0, counts: null, phaseAccuracy: null },
      { color: "b", content: { v: 1 }, accuracy: 70, headline: null, momentsCount: 0, counts: null, phaseAccuracy: null },
    ] as never;
    await worker.query("BEGIN");
    for (const s of [gameDoneStatement(g.id, null), linkedAccountsLockStatement(g.id), reviewsStatement(g.id, members), playersStatement(g.id, members)]) {
      await worker.query(s.text, [...s.values]);
    }

    // The unlink on another connection (link-service.ts: the link row goes, SET NULL on its game_players rows).
    const web = await env.owner.connect();
    const unlink = web.query(`DELETE FROM linked_accounts WHERE id = $1::bigint`, [link[0]!.id]).finally(() => web.release());
    unlink.catch(() => undefined);
    const until = Date.now() + 10_000;
    for (;;) {
      const { rows: w } = await env.owner.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM pg_stat_activity WHERE wait_event_type = 'Lock' AND query LIKE 'DELETE FROM linked_accounts%'`,
      );
      if (w[0]!.n > 0) break;
      assert.ok(Date.now() < until, "the unlink reached the game");
      await new Promise((r) => setTimeout(r, 20));
    }

    // P5's statement 5 in the same batch, then the commit.
    const finish = (async () => {
      const s = bankVersionStatement({ gameId: g.id, userIds: [member.id], version: 1 } as unknown as BankRows);
      await worker.query(s.text, [...s.values]);
      await worker.query("COMMIT");
    })();
    const [batch, unlinked] = await Promise.allSettled([finish, unlink]);
    if (batch.status === "rejected") await worker.query("ROLLBACK").catch(() => undefined);
    assert.equal(batch.status, "fulfilled", `the final batch: ${batch.status === "rejected" ? String(batch.reason) : ""}`);
    assert.equal(unlinked.status, "fulfilled", `the unlink: ${unlinked.status === "rejected" ? String(unlinked.reason) : ""}`);
    const { rows: gp } = await env.owner.query<{ link: string | null; v: number }>(
      `SELECT "linkedAccountId"::text AS link, "bankVersion" AS v FROM game_players WHERE "gameId" = $1 AND "userId" = $2`,
      [g.id, member.id],
    );
    assert.deepEqual(gp[0], { link: null, v: 1 }, "both committed: bankVersion written, the link cleared");
  });
});
