// IMPORT_PURGE against a real Postgres (phase-04 plan §12.2 test 11, §8.12, §9.4): both providers linked, the
// Chess.com games purged through `import_purge_batch()` as role replay_worker; the Lichess games, the member's own
// Replay games and the opponent's side of a shared game survive. Skipped without TEST_DATABASE_URL.
//
// One harness detail: `import_purge_batch()` is SECURITY DEFINER with `search_path = public`, so it deletes queued
// ANALYZE_GAME jobs from `public.jobs`, while the worker in these tests writes its jobs to a private copy
// (testing/pg.ts). The jobs it must remove are therefore mirrored into `public.jobs` here (and removed after).
import assert from "node:assert/strict";
import { after, afterEach, before, describe, it } from "node:test";
import { JOB_MAX_ATTEMPTS, JOB_PRIORITY, importPurgeDedupeKey } from "@repo/contracts/internal/jobs";
import type { Statement } from "../../db/client";
import { importPurgeHandler, PURGE_BATCH } from "../../jobs/import-purge";
import { insertJob, jobRow, makeGame, run as RUN_ID, setupInt, skipInt, type IntEnv, type TestUser } from "../../testing/pg";
import { resetGamesChangedThrottle } from "../progress";
import { ImportWorld, parkImportJobs, loseOnce } from "./harness";

const ME = "imp-purge-0000aai1";
let seq = 0;
const tag = () => `${RUN_ID.replace(/[^0-9]/g, "").slice(-6)}${String(80 + ++seq)}`;
const has = (needle: string) => (ss: readonly Statement[]) => ss.some((s) => s.text.includes(needle));

describe("IMPORT_PURGE (Postgres)", { skip: skipInt }, () => {
  let env: IntEnv;
  const worlds: ImportWorld[] = [];
  const publicJobKeys: string[] = [];
  const world = () => {
    const w = new ImportWorld(env, tag(), { cap: 200, eager: 50 });
    Object.assign(w.handlers, { IMPORT_PURGE: importPurgeHandler({ events: w.product }) });
    worlds.push(w);
    return w;
  };

  before(async () => {
    env = await setupInt("imppurge");
  });
  afterEach(async () => {
    resetGamesChangedThrottle();
    await parkImportJobs(env);
  });
  after(async () => {
    if (env && publicJobKeys.length) await env.owner.query(`DELETE FROM public.jobs WHERE "dedupeKey" = ANY($1)`, [publicJobKeys]);
    for (const w of worlds) await w.close();
    await env?.close();
  });

  async function importAll(w: ImportWorld, u: TestUser, provider: "CHESSCOM" | "LICHESS", username: string): Promise<string> {
    const la = await w.link(u, provider, username);
    await w.job(la, (await w.run(u, la, provider, "INITIAL")).id, "INITIAL");
    assert.equal(await w.runNext(ME), "done");
    return la;
  }

  async function purgeJob(w: ImportWorld, u: TestUser, provider: "CHESSCOM" | "LICHESS"): Promise<string> {
    return insertJob(env, {
      kind: "IMPORT_PURGE",
      priority: JOB_PRIORITY.IMPORT_PURGE,
      payload: { v: 1, userId: u.id, provider, requestedAt: new Date().toISOString() },
      dedupeKey: importPurgeDedupeKey(u.id, provider),
      maxAttempts: JOB_MAX_ATTEMPTS.IMPORT_PURGE,
    });
  }

  async function runPurge(w: ImportWorld) {
    const job = await w.claim(ME, ["IMPORT_PURGE"]);
    assert.ok(job, "the purge job is due");
    return w.runClaimed(job, ME);
  }

  /** Mirrors QUEUED ANALYZE_GAME jobs of these games into public.jobs (see the header), owned by `owner`. */
  async function mirrorAnalysisJobs(gameIds: string[], owner: TestUser | null = null): Promise<void> {
    for (const id of gameIds) {
      const key = `analyze:${id}`;
      publicJobKeys.push(key);
      await env.owner.query(
        `INSERT INTO public.jobs (kind, priority, "dedupeKey", "gameId", "userId", payload, "runAt", "maxAttempts")
         VALUES ('ANALYZE_GAME', 50, $1, $2::bigint, $4::bigint, $3::jsonb, now() AT TIME ZONE 'UTC' + interval '1 day', 3)
         ON CONFLICT ("dedupeKey") DO NOTHING`,
        [key, id, JSON.stringify({ v: 1, gameId: id, gameRef: "c0000000000000000000000", reason: "import" }), owner?.id ?? null],
      );
    }
  }

  const gamesOf = (w: ImportWorld, userId: string, source: string) =>
    w.q<{ gameId: string }>(`SELECT "gameId"::text AS "gameId" FROM game_players WHERE "userId" = $1 AND source = $2::"GameSource"`, [userId, source]);

  // ── 11 ─────────────────────────────────────────────────────────────────────────────────────────────────────────
  it("11: purges only the Chess.com games; a shared game survives for the opponent with its analysis; gamesVersion bumped", async () => {
    const w = world();
    const acc = w.upstream.addChessComFixture();
    w.upstream.addChessComOpponent(acc, "opponent_31");
    w.upstream.addLichessFixture();
    const a = await w.member("paying", "p11a");
    const b = await w.member("paying", "p11b");
    await importAll(w, a, "CHESSCOM", "KnightOwl_88");
    await importAll(w, a, "LICHESS", "knightowl88");
    await importAll(w, b, "CHESSCOM", "opponent_31");
    const replay = await makeGame(env.owner, a, b); // the members' own Replay game
    const laOf = async (u: TestUser, provider: string) =>
      (await w.q<{ id: string }>(`SELECT id::text AS id FROM linked_accounts WHERE "userId" = $1 AND provider = $2::"ChessProvider"`, [u.id, provider]))[0]!.id;
    const laCcA = await laOf(a, "CHESSCOM");
    const laLiA = await laOf(a, "LICHESS");
    const linkState = async (la: string) =>
      (await w.q(
        `SELECT la."importedCount" AS imported, la."skippedCount" AS skipped, c.archives, c."archivesEtag" AS etag,
                c."lichessSinceMs"::text AS since, c.seen
           FROM linked_accounts la JOIN import_cursors c ON c."linkedAccountId" = la.id WHERE la.id = $1`,
        [la],
      ))[0]!;
    const liBefore = await linkState(laLiA);

    const ccA = (await gamesOf(w, a.id, "CHESSCOM")).map((r) => r.gameId);
    const liA = (await gamesOf(w, a.id, "LICHESS")).map((r) => r.gameId);
    const ccB = (await gamesOf(w, b.id, "CHESSCOM")).map((r) => r.gameId);
    assert.equal(ccA.length, 45);
    assert.ok(liA.length > 0);
    assert.equal(ccB.length, 1);
    const shared = ccB[0]!;
    assert.ok(ccA.includes(shared), "the opponent's one game is A's games row");
    const legacyOf = async () =>
      (await w.q(
        `SELECT g."creatorId"::text AS creator, g."winnerId"::text AS winner, g.result::text AS result, g.outcome::text AS outcome,
                g."creatorTimeRemaining" AS ct, g."opponentTimeRemaining" AS ot,
                (SELECT p.color FROM game_players p WHERE p."gameId" = g.id AND p."userId" = $2::bigint) AS "bColor"
           FROM games g WHERE g.id = $1`,
        [shared, b.id],
      ))[0]!;
    const sharedBefore = await legacyOf();
    assert.equal(sharedBefore.creator, a.id, "A imported it first, so A is its legacy creator");
    await mirrorAnalysisJobs([...ccA, ...liA], a);
    // A's own rows on the shared game: a live share link and a legend comparison (FIX-1: they go with A's side).
    await env.owner.query(`UPDATE games SET "analysisStatus" = 'QUEUED' WHERE id = $1`, [shared]);
    const shareCode = `p${RUN_ID.replace(/[^0-9a-z]/g, "").slice(-8)}`.slice(0, 10);
    await env.owner.query(
      `INSERT INTO shares (code, kind, "ownerId", "gameId", "expiresAt") VALUES ($1, 'REVIEW', $2::bigint, $3::bigint, now() + interval '30 days')`,
      [shareCode, a.id, shared],
    );
    await env.owner.query(
      `INSERT INTO legend_comparisons ("gameId", "userId", facts, "updatedAt") VALUES ($1::bigint, $2::bigint, '{"v":1}'::jsonb, now())`,
      [shared, a.id],
    );
    const version = async (u: TestUser) => Number((await w.q(`SELECT "gamesVersion" FROM users WHERE id = $1`, [u.id]))[0]!.gamesVersion);
    const vA = await version(a);
    const vB = await version(b);

    const changedFor = (ref: string) => w.emitter.sent.filter((e) => e.event === "games:changed" && e.userRefs.includes(ref)).length;
    const changedBefore = changedFor(a.ref);
    const jobId = await purgeJob(w, a, "CHESSCOM");
    assert.equal(await runPurge(w), "done");
    const purged = w.product.events.filter((e) => e.event === "account_purge_completed");
    assert.deepEqual(w.product.refused, []);
    assert.equal(purged.length, 1, "account_purge_completed once (plan 10.1)");
    assert.equal(purged[0]!.distinctId, a.ref);
    assert.deepEqual({ provider: purged[0]!.props.provider, games: purged[0]!.props.games }, { provider: "chesscom", games: 45 });

    // Only Chess.com, only A's side.
    assert.equal((await gamesOf(w, a.id, "CHESSCOM")).length, 0);
    assert.deepEqual((await gamesOf(w, a.id, "LICHESS")).map((r) => r.gameId).sort(), [...liA].sort());
    assert.deepEqual((await gamesOf(w, b.id, "CHESSCOM")).map((r) => r.gameId), [shared]);
    const remaining = await w.q<{ id: string }>(`SELECT id::text AS id FROM games WHERE id = ANY($1::bigint[])`, [ccA]);
    assert.deepEqual(remaining.map((r) => r.id), [shared], "every A-only Chess.com game is gone, the shared one stays");
    const [sg] = await w.q(`SELECT "whitePlayerId"::text AS wp, "blackPlayerId"::text AS bp FROM games WHERE id = $1`, [shared]);
    assert.ok([sg!.wp, sg!.bp].includes(b.id), "the opponent's side is kept");
    assert.ok(![sg!.wp, sg!.bp].includes(a.id), "only the purged member's side is cleared");
    assert.ok([sg!.wp, sg!.bp].includes(null));
    assert.equal((await w.q(`SELECT 1 FROM games WHERE id = $1`, [replay.id])).length, 1, "a Replay game is never purged");
    // regression: purge-survivor-keeps-purged-identity (FIX-2, import review round 2): the survivor still carried A as
    // creatorId / winnerId with A's legacy result, so the legacy participant checks (creatorId) still admitted A.
    const sharedAfter = await legacyOf();
    assert.equal(sharedAfter.creator, b.id, "the remaining player is the legacy creator now");
    assert.notEqual(sharedAfter.winner, a.id);
    const bWon = (sharedAfter.outcome === "WHITE" && sharedAfter.bColor === "w") || (sharedAfter.outcome === "BLACK" && sharedAfter.bColor === "b");
    assert.equal(sharedAfter.winner, bWon ? b.id : null);
    const flip: Record<string, string> = { CREATOR_WON: "OPPONENT_WON", OPPONENT_WON: "CREATOR_WON", CREATOR_TIMEOUT: "OPPONENT_TIMEOUT", OPPONENT_TIMEOUT: "CREATOR_TIMEOUT", DRAW: "DRAW" };
    assert.equal(sharedAfter.result, sharedBefore.result === null ? null : flip[sharedBefore.result as string], "the legacy result seen from B's side");
    assert.deepEqual([sharedAfter.ct, sharedAfter.ot], [sharedBefore.ot, sharedBefore.ct], "the legacy clocks swap with the sides");
    // regression: purge-rollback-keeps-cursor (FIX-2): the kept Chess.com link starts over (cursor and counters reset);
    // the Lichess link, still holding games, is untouched.
    const ccAfter = await linkState(laCcA);
    assert.deepEqual(
      { imported: ccAfter.imported, skipped: ccAfter.skipped, archives: ccAfter.archives, etag: ccAfter.etag, seen: ccAfter.seen },
      { imported: 0, skipped: 0, archives: null, etag: null, seen: 0 },
    );
    assert.deepEqual(await linkState(laLiA), liBefore, "the other provider's link keeps its cursor and counts");

    // Queued analyses of the deleted games are gone; the Lichess ones stay; the shared game keeps its queued analysis,
    // now owned by the opponent (regression: purge-drops-survivor-analysis, FIX-1: it was deleted and the game stayed
    // QUEUED with no job for good).
    const left = await w.q<{ gameId: string; userId: string | null }>(
      `SELECT "gameId"::text AS "gameId", "userId"::text AS "userId" FROM public.jobs WHERE "dedupeKey" = ANY($1) AND status = 'QUEUED'`,
      [publicJobKeys],
    );
    assert.deepEqual(left.map((r) => r.gameId).sort(), [...liA, shared].sort());
    assert.equal(left.find((r) => r.gameId === shared)!.userId, b.id);
    const [sgs] = await w.q(`SELECT "analysisStatus"::text AS s FROM games WHERE id = $1`, [shared]);
    assert.equal(sgs!.s, "QUEUED", "still queued, and its job is there");
    // regression: purge-leaves-survivor-share (FIX-1): A's share link and comparison of the shared game are gone.
    assert.equal((await env.owner.query(`SELECT 1 FROM shares WHERE code = $1`, [shareCode])).rowCount, 0);
    assert.equal((await env.owner.query(`SELECT 1 FROM legend_comparisons WHERE "gameId" = $1 AND "userId" = $2`, [shared, a.id])).rowCount, 0);

    assert.ok((await version(a)) > vA, "A's archive ETag moves");
    assert.equal(await version(b), vB, "B lost nothing");

    // The job, the audit row, the events.
    const job = await jobRow(env, jobId);
    assert.equal(job.status, "DONE");
    assert.deepEqual(job.result, { games: 45, batches: 2 });
    const audit = await w.q(
      `SELECT category::text AS category, "actorKind"::text AS actor, "actorUserId"::text AS actor_user, "targetType", "targetId", meta
         FROM audit_logs WHERE action = 'account.purged' AND "targetId" = $1`,
      [a.ref],
    );
    assert.equal(audit.length, 1);
    assert.equal(audit[0]!.category, "ACCOUNT");
    assert.equal(audit[0]!.actor, "WORKER");
    assert.equal(audit[0]!.actor_user, a.id);
    assert.equal(audit[0]!.targetType, "user");
    assert.deepEqual({ ...(audit[0]!.meta as Record<string, unknown>), requestedAt: "x" }, { provider: "chesscom", games: 45, batches: 2, requestedAt: "x" });
    assert.equal(changedFor(a.ref), changedBefore + 1, "one games:changed reached A (throttled per member, one at the end)");
    assert.equal(changedFor(b.ref), 1, "B heard only its own import");
    assert.equal(w.metrics.imports.total("import.purged_games", { provider: "chesscom" }), 45);

    // Lichess next: everything of A's imports is gone, the Replay game stays.
    await purgeJob(w, a, "LICHESS");
    assert.equal(await runPurge(w), "done");
    assert.equal((await gamesOf(w, a.id, "LICHESS")).length, 0);
    assert.equal((await w.q(`SELECT 1 FROM games WHERE id = $1`, [replay.id])).length, 1);
    assert.deepEqual(
      (await w.q<{ gameId: string }>(`SELECT "gameId"::text AS "gameId" FROM public.jobs WHERE "dedupeKey" = ANY($1) AND status = 'QUEUED'`, [publicJobKeys])).map(
        (r) => r.gameId,
      ),
      [shared],
      "only the opponent's shared game keeps a queued analysis",
    );
  });

  // regression: purge-rollback-keeps-cursor (FIX-2, import review round 2): the ops data rollback purges with the link
  // kept (scripts/ops/purge-imports.ts, plan §14.4). The cursor kept every month done (and its validators), so a later
  // sync over the same link re-imported nothing and Settings kept the old count.
  it("a purge with the link kept: the next sync over the same link re-imports the whole history", async () => {
    const w = world();
    w.upstream.addChessComFixture();
    const u = await w.member("paying", "prk");
    const la = await importAll(w, u, "CHESSCOM", "KnightOwl_88");
    const imported = (await gamesOf(w, u.id, "CHESSCOM")).length;
    assert.equal(imported, 45);
    await purgeJob(w, u, "CHESSCOM");
    assert.equal(await runPurge(w), "done");
    assert.equal((await gamesOf(w, u.id, "CHESSCOM")).length, 0);
    const [acct] = await w.q(`SELECT "importedCount" AS n FROM linked_accounts WHERE id = $1`, [la]);
    assert.equal(acct!.n, 0, "Settings shows no games for the link");

    // The operator resumes imports: a MANUAL sync over the kept link (the run the web's ACC-4 sync would queue).
    const again = await w.run(u, la, "CHESSCOM", "MANUAL");
    // The link's one `import:<id>` row (the INITIAL run left it DONE or rescheduled): requeued as ACC-4 does.
    const [jobRowOfLink] = await w.q<{ id: string }>(`SELECT id::text AS id FROM ${env.schema}.jobs WHERE "dedupeKey" = $1`, [`import:${la}`]);
    await env.owner.query(
      `UPDATE ${env.schema}.jobs SET status = 'QUEUED', payload = $2::jsonb, attempts = 0, "lockedBy" = NULL,
              "runAt" = (now() AT TIME ZONE 'UTC') - interval '1 second' WHERE id = $1`,
      [jobRowOfLink!.id, JSON.stringify({ v: 1, linkedAccountId: la, runId: again.id, trigger: "MANUAL" })],
    );
    assert.equal(await w.runNext(ME), "done");
    assert.equal((await gamesOf(w, u.id, "CHESSCOM")).length, 45, "every game comes back");
    const [r] = await w.q(`SELECT status::text AS status, imported FROM import_runs WHERE id = $1`, [again.id]);
    assert.deepEqual({ status: r!.status, imported: r!.imported }, { status: "DONE", imported: 45 });
    const [after] = await w.q(`SELECT "importedCount" AS n FROM linked_accounts WHERE id = $1`, [la]);
    assert.equal(after!.n, 45);
  });

  it("purges in batches of 500 until a batch deletes nothing (§9.4: 2,000 games ≈ 4 batches + 1)", async () => {
    const w = world();
    w.upstream.addChessComMany("bulk_purge", Date.UTC(2026, 10, 12, 9, 30), 3, 400);
    const u = await w.member("paying", "p11c");
    await importAll(w, u, "CHESSCOM", "bulk_purge");
    const n = (await gamesOf(w, u.id, "CHESSCOM")).length;
    assert.ok(n > PURGE_BATCH && n <= 1_200, `${n} games`);
    const jobId = await purgeJob(w, u, "CHESSCOM");
    const sentBefore = w.driver.sent.length;
    assert.equal(await runPurge(w), "done");
    const calls = w.driver.sent.slice(sentBefore).filter((t) => t.includes("import_purge_batch")).length;
    assert.equal(calls, Math.ceil(n / PURGE_BATCH) + 1);
    assert.deepEqual((await jobRow(env, jobId)).result, { games: n, batches: calls });
    assert.equal((await gamesOf(w, u.id, "CHESSCOM")).length, 0);
  });

  it("a member deleted before the purge ran: the job ends DONE with nothing to do and no audit row", async () => {
    const w = world();
    const u = await w.member("none", "p11d");
    const jobId = await purgeJob(w, u, "CHESSCOM");
    await env.owner.query(`DELETE FROM users WHERE id = $1`, [u.id]);
    assert.equal(await runPurge(w), "done");
    assert.equal((await jobRow(env, jobId)).status, "DONE");
    assert.equal((await w.q(`SELECT 1 FROM audit_logs WHERE action = 'account.purged' AND "targetId" = $1`, [u.ref])).length, 0);
  });

  it("lost responses: a purge batch resent and the final batch resent leave one audit row and the right count", async () => {
    const w = world();
    w.upstream.addChessComFixture();
    const u = await w.member("paying", "p11e");
    await importAll(w, u, "CHESSCOM", "KnightOwl_88");
    const jobId = await purgeJob(w, u, "CHESSCOM");
    const loseBatch = loseOnce(has("import_purge_batch"));
    const loseFinal = loseOnce(has("INSERT INTO audit_logs"));
    w.driver.loseAfterCommit = (ss) => loseBatch(ss) || loseFinal(ss);
    assert.equal(await runPurge(w), "done");
    w.driver.loseAfterCommit = null;
    assert.equal(w.driver.lost.length, 2, "both responses were lost after the commit");
    const job = await jobRow(env, jobId);
    assert.equal(job.status, "DONE");
    assert.equal((job.result as { games: number }).games, 45, "the count read first survives a lost batch response");
    const audit = await w.q(`SELECT meta FROM audit_logs WHERE action = 'account.purged' AND "targetId" = $1`, [u.ref]);
    assert.equal(audit.length, 1, "the final batch committed once");
    assert.equal((await gamesOf(w, u.id, "CHESSCOM")).length, 0);
  });
});
