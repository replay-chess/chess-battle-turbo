/**
 * FIX-3 (review round 3, D-P6-FIX3-4) on a real Postgres: B-W1's `--verify` on rows the P6 WORKER wrote. The member is
 * built by the worker's own pipelines (apps/analysis-worker/src/testing/weakness-world.ts: the CC0 Lichess fixture
 * account knightowl88 imported by IMPORT_SYNC, graded by ANALYZE_GAME with the FakeEngine, the P6 final batch writing
 * the five input columns with the analysis's pass-1 lines, then a `weakness_lines` refresh run by the engine lane):
 *   - regression: bw1-verify-worker-rows — every row is reported as matching: `stats` and `errorLog` always compared,
 *     the themes only where the stored analysis can reproduce them; the rest is counted as "not comparable", never as
 *     wrong (FIX-2's verify compared the themes of every row and reported 10 of 25 correct worker rows as DIFFERS);
 *   - a row whose stored `stats` really differ from its analysis is still reported.
 * Skipped unless TEST_DATABASE_URL (local) is set.
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import type { Prisma } from "@repo/db";
import { weaknessLinesSql } from "@repo/db/weakness-jobs";
import { setupInt, skipInt, type IntEnv, type TestUser } from "../../../analysis-worker/src/testing/pg";
import { WeaknessWorld, worldTag } from "../../../analysis-worker/src/testing/weakness-world";
import { fromPrisma } from "../../../analysis-worker/src/db/client";
import type { BackfillDb } from "./p04-common";
import { verifyStoredInputs } from "./backfill-weakness-inputs";

describe("FIX-3 B-W1 --verify on rows the P6 worker wrote (Postgres, real pipelines)", { skip: skipInt }, () => {
  let env: IntEnv;
  let world: WeaknessWorld;
  let member: TestUser;
  /** B-W1's reads through the worker's own client (search_path: the world's private schema, then public). */
  let db: BackfillDb;

  before(async () => {
    env = await setupInt("bw1verify");
    world = new WeaknessWorld(env, worldTag());
    world.imp.upstream.addLichessFixture("knightowl88");
    member = await world.member("paying", "bw1verify", "Asia/Kolkata");
    await world.importAccount(member, "LICHESS", "knightowl88");
    await world.due(["ANALYZE_GAME"]);
    await world.drainAnalyses();
    db = { $queryRaw: (s: Prisma.Sql) => world.db.query({ text: s.text, values: s.values }) } as unknown as BackfillDb;
  });
  after(async () => {
    await world?.close();
    await env?.close();
  });

  it("regression: bw1-verify-worker-rows — rows the worker wrote (pass-1 lines, a lines refresh) verify; the rest is 'not comparable', never DIFFERS", async () => {
    // One game's inputs rewritten by a `weakness_lines` refresh as well (the engine lane's own write).
    const [g] = await world.q<{ id: string; ref: string }>(
      `SELECT g.id::text AS id, g."referenceId" AS ref FROM games g JOIN game_players gp ON gp."gameId" = g.id
        WHERE gp."userId" = $1 AND g."analysisStatus" = 'DONE' ORDER BY g.id DESC LIMIT 1`,
      [member.id],
    );
    await world.db.query(fromPrisma(weaknessLinesSql([{ gameId: g!.id, gameRef: g!.ref }])));
    await world.due(["ANALYZE_GAME"]);
    await world.drainAnalyses();

    const checks = await verifyStoredInputs(db, 25, { userIds: [BigInt(member.id)] });
    assert.equal(checks.length, 25);
    const differs = checks.filter((c) => !c.matches);
    assert.deepEqual(differs, [], `${differs.length} of ${checks.length} rows the worker wrote reported as wrong`);
    const notComparable = checks.filter((c) => !c.themesCompared).length;
    assert.ok(notComparable > 0, "the worker tagged some errors from lines stored data does not hold");
    assert.ok(notComparable < checks.length, "rows whose stored analysis holds every line still compare their themes");

    // A row whose stored stats do not match its analysis is reported (verify still checks what it can).
    const victim = checks[0]!;
    await env.owner.query(`UPDATE game_players SET stats = array_append(stats, 1::smallint) WHERE "gameId" = $1 AND "userId" = $2`, [victim.gameId, victim.userId]);
    const again = await verifyStoredInputs(db, 25, { userIds: [BigInt(member.id)] });
    assert.deepEqual(again.filter((c) => !c.matches).map((c) => c.gameId), [victim.gameId]);
  });
});
