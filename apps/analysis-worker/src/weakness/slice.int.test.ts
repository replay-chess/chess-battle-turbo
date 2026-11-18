// The daily weakness slice inside a real HOUSEKEEPING run (phase-06 plan §7.4.6, §12.3 "Daily slice"), on members
// whose snapshots the real recompute wrote from games the real import and analysis wrote (testing/weakness-world.ts;
// the games are the CC0 Lichess fixture lines re-dated against the database clock, so "recently active" and the scope
// window hold on any day the suite runs):
//   - the weekly roll arms `weekly` (HOUSEKEEPING, due now) only for entitled, recently active members whose newest
//     snapshot is from an earlier local week: not for an inactive member, a lapsed one or one already rolled this week;
//   - the heal sweep arms `heal` for an entitled member with ≥ 5 analysed games and no snapshot, `algo` for one whose
//     snapshot is an older algorithm's, nobody with an active RECOMPUTE_WEAKNESS row or a current snapshot;
//   - the prune keeps the newest 12 snapshots of a member;
//   - the statements ride HOUSEKEEPING's one batch and `after()` wakes the I/O lane.
// Skipped without TEST_DATABASE_URL.
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { housekeepingDedupeKey, JOB_PRIORITY } from "@repo/contracts/internal/jobs";
import { IMPORT_T0 } from "../import/__tests__/harness";
import { insertJob, setupInt, skipInt, type IntEnv, type TestUser } from "../testing/pg";
import { DAY_MS, WeaknessWorld, worldTag } from "../testing/weakness-world";

const HOUR = 3_600_000;

describe("the weakness slice in a HOUSEKEEPING run (Postgres)", { skip: skipInt }, () => {
  let env: IntEnv;
  const worlds: WeaknessWorld[] = [];
  const m: Record<"active" | "inactive" | "lapsed" | "orphan" | "pending" | "fresh" | "prune", { world: WeaknessWorld; user: TestUser }> =
    {} as never;

  /** A member with `games` re-dated Lichess fixture lines, the newest `newestAgoMs` before the database's now. */
  async function persona(label: string, games: number, newestAgoMs: number) {
    const world = new WeaknessWorld(env, worldTag());
    worlds.push(world);
    const user = await world.member("paying", label, "Asia/Kolkata");
    world.imp.upstream.addLichessMany("knightowl88", games, Date.now() - newestAgoMs, 7 * HOUR);
    await world.importAccount(user, "LICHESS", "knightowl88");
    await world.due(["ANALYZE_GAME"], user.id);
    assert.ok((await world.drainAnalysesOf(user.id)) >= 5, `${label}: analyses`);
    return { world, user };
  }

  before(async () => {
    env = await setupInt("wkslice");
    m.active = await persona("wkactive", 10, 2 * DAY_MS);
    m.inactive = await persona("wkinactive", 8, 40 * DAY_MS);
    m.lapsed = await persona("wklapsed", 8, 2 * DAY_MS);
    m.orphan = await persona("wkorphan", 8, 3 * DAY_MS);
    m.pending = await persona("wkpending", 8, 3 * DAY_MS);
    m.fresh = await persona("wkfresh", 8, 2 * DAY_MS);
    m.prune = await persona("wkprune", 6, 2 * DAY_MS);
    // Snapshots: the active, inactive and lapsed members on IMPORT_T0's week (2026-11-09, before any later Monday).
    for (const k of ["active", "inactive", "lapsed"] as const) {
      await m[k].world.arm(m[k].user.id);
      await m[k].world.recompute(m[k].user.id);
    }
    // The fresh member is computed on the database's own day: this week.
    await m.fresh.world.at(Date.now());
    await m.fresh.world.arm(m.fresh.user.id);
    await m.fresh.world.recompute(m.fresh.user.id);
    // 14 weekly rows for the prune.
    for (let k = 0; k < 14; k++) {
      await m.prune.world.at(IMPORT_T0 + k * 7 * DAY_MS);
      await m.prune.world.arm(m.prune.user.id);
      await m.prune.world.recompute(m.prune.user.id);
    }
    // The lapsed member's membership ends; the inactive member's snapshot is an older algorithm's.
    await env.owner.query(`UPDATE users SET "subscriptionStatus" = NULL, "currentPeriodEnd" = NULL WHERE id = $1`, [m.lapsed.user.id]);
    await env.owner.query(`UPDATE ${env.schema}.weakness_snapshots SET "algoVersion" = 0 WHERE "userId" = $1`, [m.inactive.user.id]);
    // The orphan's import trigger ran long ago (no active row); the pending member's is still QUEUED.
    await env.owner.query(`UPDATE ${env.schema}.jobs SET status = 'DONE', "finishedAt" = (now() AT TIME ZONE 'UTC') - interval '1 day'
                            WHERE "dedupeKey" = $1`, [`weakness:${m.orphan.user.id}`]);
    await env.owner.query(`UPDATE ${env.schema}.jobs SET "runAt" = (now() AT TIME ZONE 'UTC') + interval '1 hour'
                            WHERE "dedupeKey" = $1`, [`weakness:${m.pending.user.id}`]);
  });
  after(async () => {
    for (const w of worlds) await w.close();
    await env?.close();
  });

  it("rolls, heals and prunes in the day's batch, and wakes the I/O lane", async () => {
    const w = m.active.world;
    const before = new Map<string, Awaited<ReturnType<WeaknessWorld["job"]>>>();
    for (const k of Object.keys(m) as (keyof typeof m)[]) before.set(k, await w.job(m[k].user.id));
    const day = new Date().toISOString().slice(0, 10);
    await insertJob(env, { kind: "HOUSEKEEPING", priority: JOB_PRIORITY.HOUSEKEEPING, payload: { v: 1, day }, dedupeKey: `${housekeepingDedupeKey(day)}-${worldTag()}`, maxAttempts: 2 });
    const job = await w.claim(["HOUSEKEEPING"]);
    assert.ok(job);
    const wakes0 = w.ioWakes.length;
    assert.equal(await w.runClaimed(job), "done");
    assert.ok(w.ioWakes.length > wakes0, "after() woke the I/O lane");

    const after = async (k: keyof typeof m) => (await w.job(m[k].user.id))!;
    // Weekly roll: the active member only.
    const active = await after("active");
    assert.equal(active.status, "QUEUED");
    assert.equal(active.payload.trigger, "weekly");
    assert.equal(active.priority, JOB_PRIORITY.HOUSEKEEPING);
    assert.ok(active.runAtMs <= active.nowMs + 1_000, "due now");
    // Heal sweep: `algo` for the older algorithm's snapshot, `heal` for the member without one.
    const inactive = await after("inactive");
    assert.equal(inactive.status, "QUEUED");
    assert.equal(inactive.payload.trigger, "algo", "inactive: not rolled, but healed for the new algorithm");
    const orphan = await after("orphan");
    assert.equal(orphan.status, "QUEUED");
    assert.equal(orphan.payload.trigger, "heal");
    // Left alone: lapsed, already this week's, an active row pending.
    for (const k of ["lapsed", "fresh", "pending"] as const) {
      const now = await after(k);
      assert.deepEqual(
        [now.status, now.payload.trigger, now.runAtMs, now.priority],
        [before.get(k)!.status, before.get(k)!.payload.trigger, before.get(k)!.runAtMs, before.get(k)!.priority],
        `${k} is untouched`,
      );
    }
    // Prune: the newest 12 of 14.
    const rows = await w.snapshots(m.prune.user.id);
    assert.equal(rows.length, 12);
    const all = Array.from({ length: 14 }, (_, k) => new Date(IMPORT_T0 + k * 7 * DAY_MS));
    assert.equal(rows.at(-1)!.weekStart > all[1]!.toISOString().slice(0, 10), true, "the two oldest weeks went");
  });

  it("the rolled member's job builds this week's snapshot", async () => {
    const w = m.active.world;
    await w.at(Date.now());
    await w.recompute(m.active.user.id);
    const rows = await w.snapshots(m.active.user.id);
    assert.equal(rows.length, 2, "last week's row is kept for the trend");
    assert.notEqual(rows[0]!.weekStart, rows[1]!.weekStart);
  });
});
