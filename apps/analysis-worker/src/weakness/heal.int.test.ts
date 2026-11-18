// The heal of RECOMPUTE_WEAKNESS against Postgres (FIX-1; phase-06 plan §7.4.2 step 4, §9.4 "heal ≤ 4 s", §12.3), on a
// member built by the real pipelines (testing/weakness-world.ts): the CC0 Lichess fixture account knightowl88 imported
// by IMPORT_SYNC, every game graded by ANALYZE_GAME (FakeEngine, or Stockfish with WEAKNESS_INT_ENGINE=stockfish), J1's
// bank and P6's final batch, a READY profile from the real handler. Then the member's analysed rows are reset to
// `weaknessInputsV = 0` (an analysis made before P6, the B-W1 / heal case):
//   - regression: weakness-heal-deadlock — an analysis/regrade batch of one of those games holds its game_players row
//     and then upserts the member's weakness job row (the `analysis` trigger) while the real handler heals: before
//     FIX-1 the handler took the job row first (lock guard) and then the heal's game_players rows, the opposite order,
//     and Postgres killed one side (40P01). Now the heal is its own statement before the guarded batch: both commit;
//   - regression: weakness-heal-unbounded — WEAKNESS_HEAL_MAX_ROWS caps a run: it heals that many rows (newest first),
//     commits them, writes no snapshot and re-queues itself; the next runs heal the rest, and the last one writes the
//     snapshot from fully healed inputs;
//   - regression: weakness-purge-stale — the real IMPORT_PURGE of the member's only account arms the `removed` recompute
//     in its final batch; the recompute then writes INSUFFICIENT (no games left), so the page leaves `ready` and no
//     example points at a deleted mistake.
// Skipped without TEST_DATABASE_URL.
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import pg from "pg";
import { importPurgeDedupeKey, JOB_MAX_ATTEMPTS, JOB_PRIORITY } from "@repo/contracts/internal/jobs";
import { WeaknessMetricsV1 } from "@repo/contracts/internal/weakness-metrics";
import { insertJob, setupInt, skipInt, TEST_URL, type IntEnv, type TestUser } from "../testing/pg";
import { WeaknessWorld, worldTag } from "../testing/weakness-world";
import { loadWeaknessContext, scopeOf } from "./context";
import { HEAL_CONTINUE_SEC } from "./heal";
import { loadWeaknessInputs } from "./load";
import { sideInputsUpdateStatement } from "./inputs";
import { analysisTriggerStatement } from "./triggers";

describe("RECOMPUTE_WEAKNESS heal (Postgres, real pipelines)", { skip: skipInt }, () => {
  let env: IntEnv;
  let world: WeaknessWorld;
  let member: TestUser;

  before(async () => {
    env = await setupInt("wkheal");
    world = new WeaknessWorld(env, worldTag());
    world.imp.upstream.addLichessFixture("knightowl88");
    member = await world.member("paying", "wkheal", "Asia/Kolkata");
    await world.importAccount(member, "LICHESS", "knightowl88");
    await world.due(["ANALYZE_GAME"]);
    await world.drainAnalyses();
    await world.arm(member.id, "user");
    await world.recompute(member.id);
    assert.equal((await world.snapshots(member.id))[0]!.status, "READY");
  });
  after(async () => {
    await world?.close();
    await env?.close();
  });

  /** The analysed sides the handler reads (its own Q-W5 over the member's scope). */
  const inScope = async () => {
    const c = (await loadWeaknessContext(world.db, member.id))!;
    const { scope, since } = scopeOf(c, new Date(world.clock.now()));
    return (await loadWeaknessInputs(world.db, member.id, since, scope.timeClasses)).filter((x) => x.accuracy !== null);
  };

  /** Resets the member's analysed in-scope rows to "analysed before P6"; returns their saved inputs. */
  async function resetInputs() {
    const sides = await inScope();
    await env.owner.query(
      `UPDATE game_players SET stats = '{}', "errorThemes" = '{}', "errorLog" = '{}', "errorThemeN" = '{}', "weaknessInputsV" = 0
        WHERE "userId" = $1 AND "gameId" = ANY($2::bigint[])`,
      [member.id, sides.map((x) => x.gameId)],
    );
    return sides;
  }

  it("regression: weakness-heal-deadlock — an analysis batch holding a healed game's row commits; the handler waits, then finishes", async () => {
    const sides = await resetInputs();
    const g = sides[0]!;
    const url = new URL(TEST_URL!);
    url.searchParams.set("options", `-c search_path=${env.schema},public -c deadlock_timeout=200ms`);
    const a = new pg.Client({ connectionString: url.toString() });
    await a.connect();
    const errors: string[] = [];
    try {
      // A = the analysis/regrade final batch of game g: its game_players write first …
      await a.query("BEGIN");
      const st = sideInputsUpdateStatement([{ gameId: g.gameId, color: g.color, stats: [...g.stats], errorLog: [...g.errorLog], errorThemeN: [...g.errorThemeN], errorThemes: [...g.errorThemes] }]);
      await a.query(st.text, st.values as unknown[]);
      // … meanwhile the real handler runs and reaches the heal of g (it waits on A's row) …
      await world.arm(member.id, "user");
      const run = world.recompute(member.id).catch((e: { code?: string }) => {
        errors.push(`recompute ${e.code ?? String(e)}`);
        return null;
      });
      await new Promise((r) => setTimeout(r, 400));
      // … then A upserts the member's weakness job row (the `analysis` trigger) last, and commits.
      const trig = analysisTriggerStatement([member.id], world.settings)!;
      await a.query(trig.text, trig.values as unknown[]).catch((e: { code?: string }) => errors.push(`analysis ${e.code ?? String(e)}`));
      await a.query("COMMIT").catch((e: { code?: string }) => errors.push(`commit ${e.code ?? String(e)}`));
      const out = await run;
      assert.deepEqual(errors, [], "no 40P01 on either side");
      assert.equal(out?.out, "done");
    } finally {
      await a.query("ROLLBACK").catch(() => undefined);
      await a.end();
    }
    assert.ok((await inScope()).every((s) => s.weaknessInputsV === 1), "every row healed (g by A)");
    const job = await world.job(member.id);
    assert.equal(job?.payload.rerun, undefined, "the trigger that met the RUNNING row re-queued it");
    assert.equal(job?.status, "QUEUED");
  });

  it("regression: weakness-heal-unbounded — WEAKNESS_HEAL_MAX_ROWS caps a run; it re-queues itself; the last run writes the snapshot", async () => {
    const sides = await resetInputs();
    assert.ok(sides.length > 10, `analysed sides: ${sides.length}`);
    const cap = 8;
    world.settings.healMaxRows = cap;
    try {
      const snap0 = (await world.snapshots(member.id))[0]!;
      const computed0 = WeaknessMetricsV1.parse(snap0.metrics);
      let left = sides.length;
      let runs = 0;
      while (left > cap) {
        await world.arm(member.id, "user");
        const { out } = await world.recompute(member.id);
        runs++;
        assert.equal(out, "done");
        left -= cap;
        const job = (await world.job(member.id))!;
        assert.equal(job.status, "QUEUED", "re-queued to heal the rest");
        assert.deepEqual({ healed: job.result?.healed, healRemaining: job.result?.healRemaining }, { healed: cap, healRemaining: left });
        assert.ok(job.runAtMs - job.nowMs <= HEAL_CONTINUE_SEC * 1000 + 1_000, "runs again within seconds");
        const healedNow = (await inScope()).filter((s) => s.weaknessInputsV === 1).length;
        assert.equal(healedNow, sides.length - left);
        // No snapshot from half-healed inputs: the stored one is untouched.
        assert.deepEqual(WeaknessMetricsV1.parse((await world.snapshots(member.id))[0]!.metrics).inputs, computed0.inputs);
      }
      const { out } = await world.recompute(member.id);
      assert.equal(out, "done");
      assert.ok(runs >= 2, `runs: ${runs}`);
      const job = (await world.job(member.id))!;
      assert.equal(job.result?.healed, left);
      assert.equal(job.result?.healRemaining, undefined);
      const last = WeaknessMetricsV1.parse((await world.snapshots(member.id))[0]!.metrics);
      assert.equal(last.inputs.healed, left);
      assert.ok((await inScope()).every((s) => s.weaknessInputsV === 1));
    } finally {
      world.settings.healMaxRows = 40;
    }
  });

  it("regression: weakness-purge-stale — IMPORT_PURGE re-arms the recompute; the profile leaves READY and keeps no deleted example", async () => {
    // Settle: one more run so every row is healed and the snapshot is READY with examples from the bank.
    await world.arm(member.id, "user");
    await world.recompute(member.id);
    const before = (await world.snapshots(member.id))[0]!;
    assert.equal(before.status, "READY");
    const refs = WeaknessMetricsV1.parse(before.metrics).rows.flatMap((r) => (r.example ? [r.example.mistakeRef] : []));
    assert.ok(refs.length > 0, "READY rows carry examples");
    await insertJob(env, {
      kind: "IMPORT_PURGE",
      priority: JOB_PRIORITY.IMPORT_PURGE,
      payload: { v: 1, userId: member.id, provider: "LICHESS", requestedAt: new Date().toISOString() },
      dedupeKey: importPurgeDedupeKey(member.id, "LICHESS"),
      maxAttempts: JOB_MAX_ATTEMPTS.IMPORT_PURGE,
    });
    const purge = await world.claim(["IMPORT_PURGE"]);
    assert.ok(purge, "the purge is due");
    assert.equal(await world.runClaimed(purge), "done");
    const left = await world.q<{ n: number }>(`SELECT count(*)::int AS n FROM game_players WHERE "userId" = $1`, [member.id]);
    assert.equal(left[0]!.n, 0, "the purge removed the member's games");
    const job = (await world.job(member.id))!;
    assert.equal(job.status, "QUEUED", "the purge's final batch armed the recompute");
    assert.equal(job.payload.trigger, "removed");
    assert.ok(job.runAtMs <= job.nowMs + 1_000, "due now");
    await world.recompute(member.id);
    const after = (await world.snapshots(member.id))[0]!;
    assert.equal(after.status, "INSUFFICIENT");
    assert.equal(after.gamesAnalysed, 0);
    const m = WeaknessMetricsV1.parse(after.metrics);
    assert.deepEqual(m.rows, []);
    const still = await world.q<{ n: number }>(`SELECT count(*)::int AS n FROM mistakes WHERE "referenceId" = ANY($1)`, [refs]);
    assert.equal(still[0]!.n, 0, "the old examples' mistakes are gone, and no row points at them");
  });
});
