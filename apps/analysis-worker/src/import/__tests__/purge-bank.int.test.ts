// The import purge takes the member's Mistake Bank rows of the purged games with it (m5c, import_purge_bank).
//
// regression: purged-games-stay-in-bank (Phase 5 pre-deploy review). Unlinking an account with "delete games" (the
// marked purge, m4s) or the ops rollback (by source) deleted the member's games, but only mistake_occurrences went
// with them: a mistake seen only in those games kept its row (position, `lastGameId`, `lastOpponentName` of a deleted
// game), its BANK card, the card's attempts, and `theme_mastery."bankCount"` kept counting it. Now:
//   * a mistake with no occurrence left goes with its card, that card's attempts and its bankCount;
//   * a mistake still seen in another game keeps its card and attempts, `occurrences` is recounted, and its `last*`
//     fields point at the newest remaining occurrence;
//   * another member's mistakes on a surviving shared game, the member's other mistakes and puzzle cards are untouched;
//   * a batch boundary in between (p_limit 1) gives the same end state;
//   * an extraction of ANOTHER game holding the same mistake (it locks the mistake, then bumps users last) and a purge
//     started meanwhile both commit (the purge locks mistakes before its users bump; no 40P01).
// The purge functions run as the worker role (TEST_WORKER_DATABASE_URL), as the IMPORT_PURGE job calls them.
// Skipped without TEST_DATABASE_URL.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, it } from "node:test";
import pg from "pg";
import { bumpMembersStatement } from "../../pipeline/sql-store";
import { makeGame, makeUser, run as RUN_ID, setupInt, skipInt, WORKER_URL, type IntEnv, type TestUser } from "../../testing/pg";

type Source = "CHESSCOM" | "LICHESS";

describe("import purge vs the Mistake Bank (Postgres)", { skip: skipInt }, () => {
  let env: IntEnv;
  let worker: pg.Client;
  let hash = 0;

  before(async () => {
    env = await setupInt("purgebank");
    worker = new pg.Client({ connectionString: WORKER_URL });
    await worker.connect();
  });
  after(async () => {
    await worker?.end().catch(() => undefined);
    await env?.close();
  });

  const q = async <T extends pg.QueryResultRow = Record<string, unknown>>(text: string, values: unknown[] = []) => (await env.owner.query<T>(text, values)).rows;

  /** An imported game of `member` (opponent `opponentName`), or a shared one when `with` holds the other side. */
  async function game(member: TestUser, source: Source | "REPLAY", endedAt: string, opponentName: string, shared?: TestUser): Promise<string> {
    const opp = shared ?? (await makeUser(env.owner, "pbo"));
    const g = await makeGame(env.owner, member, opp, { analysisStatus: "DONE" });
    await q(`UPDATE games SET source = $2::"GameSource", "updatedAt" = now() WHERE id = $1`, [g.id, source]);
    await q(`UPDATE game_players SET source = $2::"GameSource", "updatedAt" = now() WHERE "gameId" = $1`, [g.id, source]);
    await q(`UPDATE game_players SET "endedAt" = $3::timestamp, "opponentName" = $4 WHERE "gameId" = $1 AND "userId" = $2`, [
      g.id,
      member.id,
      endedAt,
      opponentName,
    ]);
    if (!shared) await q(`DELETE FROM game_players WHERE "gameId" = $1 AND "userId" = $2`, [g.id, opp.id]);
    return g.id;
  }

  /** A mistake of `u` seen at (game, ply) for each occurrence; the last one is its `last*` occurrence. */
  async function mistake(u: TestUser, theme: string, occ: { gameId: string; ply: number; at: string; opp: string }[], color: "w" | "b" = "w") {
    hash++;
    const last = occ[occ.length - 1]!;
    const [m] = await q<{ id: string }>(
      `INSERT INTO mistakes ("referenceId", "userId", "epdHash", color, fen, solution, "playedUci", judgement, source,
                             "isPuzzle", "primaryTheme", phase, "winBefore", "winAfterPlayed", "moveNumber", occurrences,
                             "lastGameId", "lastPly", "lastPlayedAt", "lastOpponentName", "updatedAt")
       VALUES ($1, $2, $3, $4, '8/8/8/8/8/8/8/K6k w - - 0 1', 'a1a2', 'a1b1', 'MISTAKE', 'OWN_ERROR', true, $5,
               'MIDDLEGAME', 0.6, 0.3, 20, $6, $7, $8, $9::timestamp, $10, now())
       RETURNING id::text AS id`,
      [`mk${RUN_ID}${hash}`.slice(0, 30), u.id, `${Number(u.id) * 1000 + hash}`, color, theme, occ.length, last.gameId, last.ply, last.at, last.opp],
    );
    for (const o of occ) await q(`INSERT INTO mistake_occurrences ("gameId", ply, "mistakeId") VALUES ($1, $2, $3)`, [o.gameId, o.ply, m!.id]);
    const [c] = await q<{ id: string }>(
      `INSERT INTO training_cards ("userId", deck, kind, "itemKey", "mistakeId", theme, phase, due, "updatedAt")
       VALUES ($1, 'BANK', 'MISTAKE', $2, $3, $4, 'MIDDLEGAME', now(), now()) RETURNING id::text AS id`,
      [u.id, `m_${RUN_ID}${hash}`.slice(0, 40), m!.id, theme],
    );
    await attempts(u, c!.id, "BANK", theme, 2);
    await q(
      `INSERT INTO theme_mastery ("userId", theme, "bankCount") VALUES ($1, $2, 1)
       ON CONFLICT ("userId", theme) DO UPDATE SET "bankCount" = theme_mastery."bankCount" + 1`,
      [u.id, theme],
    );
    return { id: m!.id, cardId: c!.id };
  }

  async function attempts(u: TestUser, cardId: string, deck: "BANK" | "PUZZLE", theme: string, n: number) {
    for (let i = 0; i < n; i++) {
      await q(
        `INSERT INTO training_attempts ("clientAttemptId", "userId", "cardId", deck, kind, theme, solved, "firstTry", "timeMs", "reviewedAt")
         VALUES ($1::uuid, $2, $3, $4::"TrainingDeck", $5::"TrainingItemKind", $6, true, true, 5000, now())`,
        [randomUUID(), u.id, cardId, deck, deck === "BANK" ? "MISTAKE" : "LICHESS_PUZZLE", theme],
      );
    }
  }

  async function puzzleCard(u: TestUser): Promise<string> {
    hash++;
    const [c] = await q<{ id: string }>(
      `INSERT INTO training_cards ("userId", deck, kind, "itemKey", "puzzleId", theme, due, "updatedAt")
       VALUES ($1, 'PUZZLE', 'LICHESS_PUZZLE', $2, '00abc', 'fork', now(), now()) RETURNING id::text AS id`,
      [u.id, `p_${RUN_ID}${hash}`.slice(0, 40)],
    );
    await attempts(u, c!.id, "PUZZLE", "fork", 3);
    return c!.id;
  }

  const mistakeRow = async (id: string) =>
    (await q<{ occurrences: number; lastGameId: string; lastPly: number; lastPlayedAt: string; lastOpponentName: string }>(
      `SELECT occurrences, "lastGameId"::text AS "lastGameId", "lastPly", to_char("lastPlayedAt", 'YYYY-MM-DD HH24:MI') AS "lastPlayedAt",
              "lastOpponentName" FROM mistakes WHERE id = $1`,
      [id],
    ))[0];
  const count = async (sql: string, values: unknown[]) => (await q<{ n: number }>(`SELECT count(*)::int AS n FROM ${sql}`, values))[0]!.n;
  const bankCount = async (u: TestUser, theme: string) =>
    (await q<{ n: number }>(`SELECT "bankCount" AS n FROM theme_mastery WHERE "userId" = $1 AND theme = $2`, [u.id, theme]))[0]?.n ?? null;

  /** Runs one purge function until a batch deletes nothing, as the worker role. */
  async function purgeAll(fn: "import_purge_batch" | "import_purge_marked_batch", u: TestUser, source: Source, limit: number): Promise<number> {
    let batches = 0;
    for (;;) {
      const { rows } = await worker.query<{ deleted_players: number }>(`SELECT deleted_players FROM ${fn}($1::bigint, $2::"GameSource", $3::int)`, [u.id, source, limit]);
      batches++;
      if (rows[0]!.deleted_players === 0) return batches;
      assert.ok(batches < 50, "the purge ends");
    }
  }

  /** The world of both outcomes; returns what the assertions read. */
  async function world(label: string) {
    const me = await makeUser(env.owner, `${label}m`);
    const other = await makeUser(env.owner, `${label}x`);
    const cc1 = await game(me, "CHESSCOM", "2026-11-10 10:00", "purged_newest");
    const cc2 = await game(me, "CHESSCOM", "2026-11-09 10:00", "purged_older");
    const shared = await game(me, "CHESSCOM", "2026-11-08 10:00", "other_member", other);
    const li = await game(me, "LICHESS", "2026-11-05 10:00", "lichess_opponent");
    const li2 = await game(me, "LICHESS", "2026-11-01 10:00", "lichess_oldest");
    // Only in purged games (two of them, and the shared game the other member keeps).
    const onlyPurged = await mistake(me, "fork", [
      { gameId: shared, ply: 21, at: "2026-11-08 10:00", opp: "other_member" },
      { gameId: cc2, ply: 31, at: "2026-11-09 10:00", opp: "purged_older" },
      { gameId: cc1, ply: 41, at: "2026-11-10 10:00", opp: "purged_newest" },
    ]);
    // Also seen in two Lichess games, last in a purged one.
    const alsoKept = await mistake(me, "pin", [
      { gameId: li2, ply: 13, at: "2026-11-01 10:00", opp: "lichess_oldest" },
      { gameId: li, ply: 15, at: "2026-11-05 10:00", opp: "lichess_opponent" },
      { gameId: cc1, ply: 17, at: "2026-11-10 10:00", opp: "purged_newest" },
    ]);
    // Never in a purged game.
    const untouched = await mistake(me, "pin", [{ gameId: li, ply: 25, at: "2026-11-05 10:00", opp: "lichess_opponent" }]);
    // The other member's side of the shared game.
    const theirs = await mistake(other, "fork", [{ gameId: shared, ply: 22, at: "2026-11-08 10:00", opp: "me" }], "b");
    const puzzle = await puzzleCard(me);
    return { me, other, cc1, cc2, shared, li, onlyPurged, alsoKept, untouched, theirs, puzzle };
  }

  async function assertBank(w: Awaited<ReturnType<typeof world>>) {
    // The purge itself (unchanged): the member's Chess.com sides are gone, the shared game survives for the other member.
    assert.equal(await count(`game_players WHERE "userId" = $1 AND source = 'CHESSCOM'`, [w.me.id]), 0);
    assert.equal(await count(`games WHERE id = $1`, [w.shared]), 1);

    // Seen only in purged games: the mistake, its card, the card's attempts and the card's bankCount are gone.
    assert.equal(await mistakeRow(w.onlyPurged.id), undefined, "a mistake seen only in purged games is removed");
    assert.equal(await count(`mistake_occurrences WHERE "mistakeId" = $1`, [w.onlyPurged.id]), 0, "its occurrence on the surviving shared game too");
    assert.equal(await count(`training_cards WHERE id = $1`, [w.onlyPurged.cardId]), 0, "its card");
    assert.equal(await count(`training_attempts WHERE "cardId" = $1`, [w.onlyPurged.cardId]), 0, "its card's attempts");
    assert.equal(await bankCount(w.me, "fork"), 0, "bankCount no longer counts its card");

    // Still seen in Lichess games: card and attempts kept, count and last occurrence re-pointed at the newest left.
    assert.deepEqual(await mistakeRow(w.alsoKept.id), {
      occurrences: 2,
      lastGameId: w.li,
      lastPly: 15,
      lastPlayedAt: "2026-11-05 10:00",
      lastOpponentName: "lichess_opponent",
    });
    assert.equal(await count(`training_cards WHERE id = $1`, [w.alsoKept.cardId]), 1, "its card stays");
    assert.equal(await count(`training_attempts WHERE "cardId" = $1`, [w.alsoKept.cardId]), 2, "with its attempts");
    assert.equal(await bankCount(w.me, "pin"), 2, "pin counts the kept card and the untouched one");

    // Untouched: the member's mistake of a kept game, the other member's mistake on the shared game, puzzle cards.
    assert.deepEqual(await mistakeRow(w.untouched.id), {
      occurrences: 1,
      lastGameId: w.li,
      lastPly: 25,
      lastPlayedAt: "2026-11-05 10:00",
      lastOpponentName: "lichess_opponent",
    });
    assert.equal((await mistakeRow(w.theirs.id))?.lastGameId, w.shared);
    assert.equal(await count(`mistake_occurrences WHERE "mistakeId" = $1`, [w.theirs.id]), 1);
    assert.equal(await count(`training_attempts WHERE "cardId" = $1`, [w.theirs.cardId]), 2);
    assert.equal(await bankCount(w.other, "fork"), 1);
    assert.equal(await count(`training_attempts WHERE "cardId" = $1`, [w.puzzle]), 3, "puzzle attempts stay");
  }

  it("import_purge_batch (by source): a mistake only in purged games goes with its card and attempts; one seen elsewhere is re-pointed", async () => {
    const w = await world("pbs");
    await purgeAll("import_purge_batch", w.me, "CHESSCOM", 500);
    await assertBank(w);
  });

  it("import_purge_marked_batch (by link, m4s) in batches of one game: the same end state", async () => {
    const w = await world("pbk");
    await q(`UPDATE game_players SET "purgeLinkId" = 1 WHERE "userId" = $1 AND source = 'CHESSCOM'`, [w.me.id]);
    const batches = await purgeAll("import_purge_marked_batch", w.me, "CHESSCOM", 1);
    assert.equal(batches, 4, "three games, one per batch, then the empty batch");
    await assertBank(w);
  });

  it("an extraction of another game holding the same mistake (mistake locked, users bumped last) and a purge both commit", async () => {
    const me = await makeUser(env.owner, "pbl");
    const purged = await game(me, "CHESSCOM", "2026-11-10 10:00", "purged");
    const kept = await game(me, "LICHESS", "2026-11-11 10:00", "kept");
    const m = await mistake(me, "fork", [{ gameId: purged, ply: 41, at: "2026-11-10 10:00", opp: "purged" }]);

    // The other game's bank batch (bankStatements.ts 1 → 2: the mistake's upsert holds its row, then the occurrence),
    // open; its final statement (sql-store.ts: the members' gamesVersion) comes after the purge started.
    await worker.query("BEGIN");
    await worker.query(`UPDATE mistakes SET "lastGameId" = $2, "lastPly" = 9, "lastPlayedAt" = '2026-11-11 10:00', "lastOpponentName" = 'kept', "updatedAt" = now() WHERE id = $1`, [m.id, kept]);
    await worker.query(`INSERT INTO mistake_occurrences ("gameId", ply, "mistakeId") VALUES ($1, 9, $2)`, [kept, m.id]);

    const purger = await env.owner.connect();
    const purge = purger
      .query(`SELECT deleted_players FROM import_purge_batch($1::bigint, 'CHESSCOM'::"GameSource", 10)`, [me.id])
      .finally(() => purger.release());
    purge.catch(() => undefined);
    const until = Date.now() + 10_000;
    for (;;) {
      const { rows } = await env.owner.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM pg_stat_activity WHERE wait_event_type = 'Lock' AND query LIKE '%import_purge_batch%'`,
      );
      if (rows[0]!.n > 0) break;
      assert.ok(Date.now() < until, "the purge reached the mistake");
      await new Promise((r) => setTimeout(r, 20));
    }
    const finish = (async () => {
      const s = bumpMembersStatement(kept);
      await worker.query(s.text, [...s.values]);
      await worker.query("COMMIT");
    })();
    const [batch, purgedRes] = await Promise.allSettled([finish, purge]);
    if (batch.status === "rejected") await worker.query("ROLLBACK").catch(() => undefined);
    assert.equal(batch.status, "fulfilled", `the extraction: ${batch.status === "rejected" ? String(batch.reason) : ""}`);
    assert.equal(purgedRes.status, "fulfilled", `the purge: ${purgedRes.status === "rejected" ? String(purgedRes.reason) : ""}`);
    assert.deepEqual(await mistakeRow(m.id), {
      occurrences: 1,
      lastGameId: kept,
      lastPly: 9,
      lastPlayedAt: "2026-11-11 10:00",
      lastOpponentName: "kept",
    });
    assert.equal(await count(`training_cards WHERE id = $1`, [m.cardId]), 1, "the card stays: the other game holds the mistake");
  });
});
