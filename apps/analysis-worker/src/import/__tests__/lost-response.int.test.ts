// Lost responses on the import's writes (phase-04 plan §8.8 "Errors"; feasibility F-OCI-4; P3-D11 "retry once"): the
// server commits a statement and its response is lost, so CountingDb sends it again (or its retry form). Each case
// proves the resend leaves the run, the account, the games and the job exactly as one send would, and that the
// worker still reports what happened (events). Skipped without TEST_DATABASE_URL.
import assert from "node:assert/strict";
import { after, afterEach, before, describe, it } from "node:test";
import type { Statement } from "../../db/client";
import { jobRow, run as RUN_ID, setupInt, skipInt, type IntEnv } from "../../testing/pg";
import { resetGamesChangedThrottle } from "../progress";
import { ImportWorld, parkImportJobs, loseOnce } from "./harness";

const ME = "imp-lost-0000aai1";
let seq = 0;
const tag = () => `${RUN_ID.replace(/[^0-9]/g, "").slice(-6)}${String(50 + ++seq)}`;
const has = (needle: string) => (ss: readonly Statement[]) => ss.some((s) => s.text.includes(needle));

describe("IMPORT_SYNC lost responses (Postgres)", { skip: skipInt }, () => {
  let env: IntEnv;
  const worlds: ImportWorld[] = [];
  const world = () => {
    const w = new ImportWorld(env, tag());
    worlds.push(w);
    return w;
  };

  before(async () => {
    env = await setupInt("implost");
  });
  afterEach(async () => {
    resetGamesChangedThrottle();
    await parkImportJobs(env);
  });
  after(async () => {
    for (const w of worlds) await w.close();
    await env?.close();
  });

  async function setup(w: ImportWorld, label: string, username = "KnightOwl_88") {
    const u = await w.member("paying", label);
    const la = await w.link(u, "CHESSCOM", username);
    const run = await w.run(u, la, "CHESSCOM", "INITIAL");
    const jobId = await w.job(la, run.id, "INITIAL");
    return { u, la, run, jobId };
  }

  it("a chunk whose response is lost is resent: no duplicate row, job or count", async () => {
    const w = world();
    w.upstream.addChessComFixture();
    const { u, run } = await setup(w, "lc");
    // The saving chunk (the second chunk statement) commits and its response is lost.
    let chunks = 0;
    w.driver.loseAfterCommit = loseOnce((ss) => has("jsonb_to_recordset")(ss) && ++chunks === 2);
    assert.equal(await w.runNext(ME), "done");
    assert.equal(w.driver.lost.length, 1);
    assert.equal(w.db.counters.retries, 1);
    const [r] = await w.q(`SELECT imported, total, "analysisQueued", status::text AS status FROM import_runs WHERE id = $1`, [run.id]);
    assert.deepEqual({ ...r }, { imported: 45, total: 45, analysisQueued: 45, status: "DONE" });
    assert.equal(Number((await w.q(`SELECT count(*) FROM game_players WHERE "userId" = $1`, [u.id]))[0]!.count), 45);
    const jobs = await w.q(`SELECT count(*)::int AS n FROM ${env.schema}.jobs WHERE kind = 'ANALYZE_GAME' AND "userId" = $1`, [u.id]);
    assert.equal(jobs[0]!.n, 45, "one analysis job per game (eager 50 ≥ 45)");
    const [a] = await w.q(`SELECT "importedCount", skipped FROM linked_accounts la JOIN import_runs r ON r."linkedAccountId" = la.id WHERE r.id = $1`, [run.id]);
    assert.equal(a!.importedCount, 45);
    assert.equal(a!.skipped, 3, "the resend counted no taken side");
    const fin = w.importEvents().find((e) => e.event === "import:finished")!.data as { imported: number };
    assert.equal(fin.imported, 45, "the events read the committed totals");
  });

  it("a finish batch whose response is lost is recognised as committed: finished event, job rescheduled", async () => {
    const w = world();
    w.upstream.addChessComFixture();
    const { jobId, run } = await setup(w, "lf");
    w.driver.loseAfterCommit = loseOnce(has(`status = 'DONE', phase = NULL`));
    assert.equal(await w.runNext(ME), "done");
    assert.equal(w.driver.lost.length, 1);
    const job = await jobRow(env, jobId);
    assert.equal(job.status, "QUEUED");
    assert.equal((job.result as { rescheduledBy: string }).rescheduledBy, ME);
    const fin = w.importEvents().filter((e) => e.event === "import:finished");
    assert.equal(fin.length, 1);
    assert.equal((fin[0]!.data as { runRef: string; imported: number }).runRef, run.ref);
    assert.equal((fin[0]!.data as { imported: number }).imported, 45);
  });

  it("a failure batch whose response is lost is recognised: account ERROR, run FAILED, one import:failed", async () => {
    const w = world();
    w.upstream.addChessComFixture();
    const { jobId, run, la } = await setup(w, "lx", "ghost_user");
    w.driver.loseAfterCommit = loseOnce(has(`"lastError" = $3`));
    assert.equal(await w.runNext(ME), "failed");
    assert.equal(w.driver.lost.length, 1);
    const job = await jobRow(env, jobId);
    assert.equal(job.status, "FAILED", "not_found is terminal");
    assert.match(job.lastError ?? "", /^not_found: /);
    const [r] = await w.q(`SELECT status::text AS status, error FROM import_runs WHERE id = $1`, [run.id]);
    assert.equal(r!.status, "FAILED");
    assert.equal((r!.error as { code: string }).code, "not_found");
    const [a] = await w.q(`SELECT status::text AS status, "importState"::text AS s FROM linked_accounts WHERE id = $1`, [la]);
    assert.deepEqual({ ...a }, { status: "ERROR", s: "FAILED" });
    const failed = w.importEvents().filter((e) => e.event === "import:failed");
    assert.equal(failed.length, 1);
    assert.deepEqual(
      { code: (failed[0]!.data as { code: string }).code, retryAt: (failed[0]!.data as { retryAt: unknown }).retryAt },
      { code: "not_found", retryAt: null },
    );
  });

  it("a DAILY run's creation whose response is lost finds the row it created: one run", async () => {
    const w = world();
    const acc = w.upstream.addChessComFixture();
    const { jobId, la } = await setup(w, "ld");
    assert.equal(await w.runNext(ME), "done");
    const src = acc.months.get("2026/10")![0]!;
    acc.months.set("2026/11", [{ ...src, url: `${String(src.url)}7`, end_time: Math.floor((w.clock.now() - 60_000) / 1000) }]);
    acc.version++;
    await w.due(jobId);
    w.driver.loseAfterCommit = loseOnce(has(`'DAILY', 'RUNNING', 'reading'`));
    assert.equal(await w.runNext(ME), "done");
    assert.equal(w.driver.lost.length, 1);
    const runs = await w.q(`SELECT trigger::text AS t, status::text AS s, imported FROM import_runs WHERE "linkedAccountId" = $1 ORDER BY id`, [la]);
    assert.deepEqual(runs.map((r) => [r.t, r.s, r.imported]), [["INITIAL", "DONE", 45], ["DAILY", "DONE", 1]]);
  });

  it("a park batch whose response is lost is done by this worker", async () => {
    const w = world();
    w.upstream.addChessComFixture();
    const u = await w.member("none", "lp");
    const la = await w.link(u, "CHESSCOM", "KnightOwl_88");
    const run = await w.run(u, la, "CHESSCOM", "INITIAL");
    const jobId = await w.job(la, run.id, "INITIAL");
    w.driver.loseAfterCommit = loseOnce(has(`'WAITING_FOR_MEMBERSHIP', phase = NULL`));
    assert.equal(await w.runNext(ME), "done");
    assert.equal(w.driver.lost.length, 1);
    assert.equal((await jobRow(env, jobId)).status, "DONE");
    const [r] = await w.q(`SELECT status::text AS s FROM import_runs WHERE id = $1`, [run.id]);
    assert.equal(r!.s, "WAITING_FOR_MEMBERSHIP");
  });

  it("a run start whose response is lost is sent again and still starts the run", async () => {
    const w = world();
    w.upstream.addChessComFixture();
    const { run } = await setup(w, "ls");
    w.driver.loseAfterCommit = loseOnce(has(`"startedAt" = COALESCE("startedAt"`));
    assert.equal(await w.runNext(ME), "done");
    assert.equal(w.driver.lost.length, 1);
    const [r] = await w.q(`SELECT status::text AS s, imported FROM import_runs WHERE id = $1`, [run.id]);
    assert.deepEqual({ ...r }, { s: "DONE", imported: 45 });
  });
});
