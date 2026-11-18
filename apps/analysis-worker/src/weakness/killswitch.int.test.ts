// WEAKNESS_JOBS_ENABLED=false (phase-06 plan §7.7 kill switch, §13 WP4 acceptance) against Postgres and the real
// pipelines: a member's import and analyses run as before but write none of P6's input columns, arm no recompute and
// send no progress frame; a row the web still arms (TR-12) ends DONE `skipped: "disabled"` without a snapshot.
// Skipped without TEST_DATABASE_URL.
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { IMPORT_T0 } from "../import/__tests__/harness";
import { setupInt, skipInt, type IntEnv } from "../testing/pg";
import { WeaknessWorld, worldTag } from "../testing/weakness-world";

describe("the weakness kill switch (Postgres)", { skip: skipInt }, () => {
  let env: IntEnv;
  let world: WeaknessWorld;

  before(async () => {
    env = await setupInt("wkkill");
    world = new WeaknessWorld(env, worldTag(), { weakness: { enabled: false } });
  });
  after(async () => {
    await world?.close();
    await env?.close();
  });

  it("imports and analyses without P6 writes; an armed row ends DONE skipped disabled", async () => {
    const member = await world.member("paying", "wkkill", "Asia/Kolkata");
    world.imp.upstream.addLichessMany("knightowl88", 8, IMPORT_T0 - 3_600_000, 6 * 3_600_000);
    await world.importAccount(member, "LICHESS", "knightowl88");
    await world.due(["ANALYZE_GAME"], member.id);
    assert.ok((await world.drainAnalysesOf(member.id)) >= 6);
    const sides = await world.inputs(member.id);
    assert.ok(sides.filter((s) => s.accuracy !== null).length >= 6, "the analyses ran");
    for (const s of sides) assert.equal(s.weaknessInputsV, 0, "no input columns");
    assert.equal(await world.job(member.id), undefined, "no trigger armed a recompute");
    assert.equal(world.weaknessEvents("weakness:progress").length, 0);
    await world.arm(member.id);
    const { out } = await world.recompute(member.id);
    assert.equal(out, "done");
    const job = (await world.job(member.id))!;
    assert.equal(job.status, "DONE");
    assert.equal(job.result?.skipped, "disabled");
    assert.deepEqual(await world.snapshots(member.id), []);
    assert.equal(world.weaknessEvents("weakness:ready").length, 0);
  });
});
