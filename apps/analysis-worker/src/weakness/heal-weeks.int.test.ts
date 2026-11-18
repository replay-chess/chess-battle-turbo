// FIX-2 (review round 2) against Postgres, on a member built by the real pipelines (testing/weakness-world.ts): the
// CC0 Lichess fixture account knightowl88 imported by IMPORT_SYNC (its games carry Lichess's %eval, so every analysis
// takes the eval-hinted path), graded by ANALYZE_GAME (FakeEngine, or Stockfish with WEAKNESS_INT_ENGINE=stockfish),
// J1's bank and P6's final batch, the READY profile from the real RECOMPUTE_WEAKNESS handler:
//   - regression: hinted-refutation-missing — the analysis searches each member error AND the position after it (the
//     opponent's best reply that rc:missedThreat reads); an eval-hinted import knows no best move past position 0;
//   - regression: weakness-heal-loop — rows whose analysis is being redone (completedAt cleared) and rows whose stored
//     arrays cannot be read never fill the heal's cap run after run: every run heals or the heal ends; a failing row
//     is marked −1 and never picked again; the snapshot is written;
//   - regression: weakness-heal-pv-bias — rows healed from stored data (best move only) arm a `weakness_lines` refresh
//     each (never touching the game's analysis), and it writes exactly the inputs the analysis wrote (full lines);
//   - regression: weakness-tz-week — a member who moves west across Monday midnight never writes an older week;
//   - regression: weakness-hadready-any-week — an older week's READY row behind a newer INSUFFICIENT one is not "has a
//     READY profile": the progress frames run again;
//   - regression: weakness-paused-outlives-switch — the daily heal sweep re-arms a member the kill switch paused,
//     whatever their snapshot;
//   - regression: weakness-purge-older-weeks — IMPORT_PURGE removes every week of the member's profile, not only the
//     current one (older weeks held the purged games' example positions and counts).
// Skipped without TEST_DATABASE_URL.
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { decodeMove, errorJudgementOf, moverAt, type Color } from "@repo/chess-analysis/codec";
import { replayUci } from "@repo/chess-analysis/replay";
import { importPurgeDedupeKey, JOB_MAX_ATTEMPTS, JOB_PRIORITY } from "@repo/contracts/internal/jobs";
import { WeaknessMetricsV1 } from "@repo/contracts/internal/weakness-metrics";
import { planPositions } from "../pipeline/positions";
import { healSweepStatement } from "../scheduler/recurring/weakness";
import { insertJob, setupInt, skipInt, type IntEnv, type TestUser } from "../testing/pg";
import { WeaknessWorld, worldTag } from "../testing/weakness-world";
import { loadWeaknessContext, scopeOf } from "./context";
import { WEAKNESS_INPUTS_HEAL_FAILED } from "./heal";
import { loadWeaknessInputs } from "./load";

const HOUR = 3_600_000;

describe("FIX-2: heal progress, engine regrades, weeks, paused, purge (Postgres, real pipelines)", { skip: skipInt }, () => {
  let env: IntEnv;
  let world: WeaknessWorld;
  let member: TestUser;
  let lineSearches = 0;

  const sum = (name: string) => world.telemetry.named(name).reduce((s, m) => s + m.value, 0);

  before(async () => {
    env = await setupInt("wkfix2");
    world = new WeaknessWorld(env, worldTag());
    world.imp.upstream.addLichessFixture("knightowl88");
    member = await world.member("paying", "wkfix2", "Asia/Kolkata");
    await world.importAccount(member, "LICHESS", "knightowl88");
    await world.due(["ANALYZE_GAME"]);
    const s0 = sum("worker.weakness.line_searches");
    await world.drainAnalyses();
    lineSearches = sum("worker.weakness.line_searches") - s0;
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
  const tags = (rows: Awaited<ReturnType<typeof inScope>>) =>
    rows.map((r) => [r.gameId, r.weaknessInputsV, r.errorThemes.join(","), r.errorThemeN.join(","), r.stats.join(","), r.errorLog.join(",")].join("|"));

  /** Resets the member's analysed in-scope rows to "analysed before P6". */
  async function resetInputs() {
    const sides = await inScope();
    await env.owner.query(
      `UPDATE game_players SET stats = '{}', "errorThemes" = '{}', "errorLog" = '{}', "errorThemeN" = '{}', "weaknessInputsV" = 0
        WHERE "userId" = $1 AND "gameId" = ANY($2::bigint[])`,
      [member.id, sides.map((x) => x.gameId)],
    );
    return sides;
  }

  /** Runs the member's recompute until it writes a snapshot (at most `max` runs); returns each run's job result. */
  async function healToSnapshot(max: number) {
    const results: Record<string, unknown>[] = [];
    for (let i = 0; i < max; i++) {
      await world.arm(member.id, "user");
      const { out } = await world.recompute(member.id);
      assert.equal(out, "done");
      const r = (await world.job(member.id))!.result ?? {};
      results.push(r);
      if (r.healRemaining === undefined) return results;
    }
    throw new Error(`no snapshot after ${max} runs: ${JSON.stringify(results)}`);
  }

  it("regression: hinted-refutation-missing — each member error and the position after it are searched for their lines", async () => {
    const rows = await world.q<{ moves: string; startingFen: string; color: Color; best: number[]; judgements: number[]; lines: Record<string, { pv?: string }> | null; evalSource: string }>(
      `SELECT g.moves, g."startingFen", gp.color, ga.best, ga.judgements, ga.lines, ga."evalSource"::text AS "evalSource"
         FROM game_players gp JOIN games g ON g.id = gp."gameId" JOIN ${env.schema}.game_analyses ga ON ga."gameId" = gp."gameId"
        WHERE gp."userId" = $1 AND ga."completedAt" IS NOT NULL`,
      [member.id],
    );
    let errorPly = 0;
    let refutation = 0;
    for (const r of rows) {
      const replay = replayUci(r.startingFen, r.moves.trim().split(/\s+/).filter(Boolean));
      const positions = planPositions(replay);
      const lines = r.lines ?? {};
      for (let i = 0; i < replay.uci.length; i++) {
        if (moverAt(i, replay.startMover) !== r.color || errorJudgementOf(r.judgements[i] ?? 0) === null) continue;
        if (!lines[String(i)]?.pv && positions[i]!.terminal === null) errorPly++;
        const next = positions[i + 1];
        if (next && next.terminal === null && !lines[String(i + 1)]?.pv && decodeMove(r.best[i + 1] ?? 0) === null) refutation++;
      }
    }
    assert.ok(rows.some((r) => r.evalSource !== "ENGINE"), "the fixture games take the eval-hinted path (LICHESS or MIXED)");
    assert.ok(refutation > 0, "hinted analyses know no best move after the member's errors");
    assert.equal(lineSearches, errorPly + refutation, `searched ${lineSearches}; error plies ${errorPly} + refutations ${refutation}`);
  });

  it("regression: weakness-heal-loop — unfinished and unreadable rows never fill the cap; every run progresses; the snapshot is written", async () => {
    const sides = await resetInputs();
    assert.ok(sides.length >= 24, `analysed sides: ${sides.length}`);
    const redo = sides.slice(0, 12).map((s) => s.gameId);
    const broken = sides.slice(12, 14).map((s) => s.gameId);
    const saved = await world.q<{ gameId: string; completedAt: Date; evals: number[] }>(
      `SELECT "gameId"::text AS "gameId", "completedAt", evals FROM ${env.schema}.game_analyses WHERE "gameId" = ANY($1::bigint[])`,
      [[...redo, ...broken]],
    );
    // P3 clears completedAt when a re-analysis starts (or fails); a broken row's evals no longer fit its moves.
    await env.owner.query(`UPDATE ${env.schema}.game_analyses SET "completedAt" = NULL WHERE "gameId" = ANY($1::bigint[])`, [redo]);
    await env.owner.query(`UPDATE ${env.schema}.game_analyses SET evals = evals[1:3] WHERE "gameId" = ANY($1::bigint[])`, [broken]);
    world.settings.healMaxRows = 8;
    try {
      const finished = sides.length - redo.length;
      const results = await healToSnapshot(Math.ceil(finished / 8) + 1);
      for (const r of results.slice(0, -1)) assert.ok(Number(r.healed) > 0, `a continuing run healed nothing: ${JSON.stringify(results)}`);
      const rows = await inScope();
      const v = (ids: string[]) => rows.filter((x) => ids.includes(x.gameId)).map((x) => x.weaknessInputsV);
      assert.deepEqual([...new Set(v(broken))], [WEAKNESS_INPUTS_HEAL_FAILED], "unreadable rows are marked −1");
      assert.deepEqual([...new Set(v(redo))], [0], "rows being re-analysed are left to their analysis");
      assert.ok(rows.filter((x) => !redo.includes(x.gameId) && !broken.includes(x.gameId)).every((x) => x.weaknessInputsV === 1));
      const snap = WeaknessMetricsV1.parse((await world.snapshots(member.id))[0]!.metrics);
      assert.equal(snap.games.analysed, sides.length - redo.length - broken.length, "the snapshot counts what decodes");
      // The next run picks none of them again: no heal, the snapshot at once.
      const again = await healToSnapshot(1);
      assert.equal(again[0]!.healed, 0);
    } finally {
      world.settings.healMaxRows = 40;
      for (const s of saved) {
        await env.owner.query(`UPDATE ${env.schema}.game_analyses SET "completedAt" = $2, evals = $3 WHERE "gameId" = $1`, [s.gameId, s.completedAt, s.evals]);
      }
      await env.owner.query(`UPDATE game_players SET "weaknessInputsV" = 0 WHERE "userId" = $1 AND "weaknessInputsV" = $2`, [member.id, WEAKNESS_INPUTS_HEAL_FAILED]);
    }
  });

  it("regression: weakness-heal-pv-bias — healed rows arm an engine regrade each; the regrade writes the analysis's own full-line inputs", async () => {
    // Settle every row first: run the regrades the earlier heals armed, then capture the analysis-quality inputs.
    await world.due(["ANALYZE_GAME"], member.id);
    await world.drainAnalysesOf(member.id);
    await healToSnapshot(10);
    await world.due(["ANALYZE_GAME"], member.id);
    await world.drainAnalysesOf(member.id);
    const full = await inScope();
    assert.ok(full.every((x) => x.weaknessInputsV === 1));
    const sides = await resetInputs();
    world.settings.healMaxRows = 400;
    try {
      const regrades0 = sum("worker.weakness.lines_regrades");
      await healToSnapshot(1);
      const healed = await inScope();
      assert.notDeepEqual(tags(healed), tags(full), "stored data alone tags differently (the bias)");
      const armed = await world.q<{ gameId: string; reason: string; priority: number; status: string; dedupeKey: string; userId: string | null }>(
        `SELECT "gameId"::text AS "gameId", payload->>'reason' AS reason, priority, status::text AS status, "dedupeKey", "userId"::text AS "userId"
           FROM ${env.schema}.jobs WHERE kind = 'ANALYZE_GAME' AND "gameId" = ANY($1::bigint[]) AND status = 'QUEUED'`,
        [sides.map((s) => s.gameId)],
      );
      assert.equal(armed.length, sum("worker.weakness.lines_regrades") - regrades0);
      assert.ok(
        armed.length > 0 &&
          armed.every((j) => j.reason === "weakness_lines" && j.priority === JOB_PRIORITY.HOUSEKEEPING && j.userId === null && j.dedupeKey === `weaklines:${j.gameId}`),
        JSON.stringify(armed.slice(0, 3)),
      );
      // The games' analysis rows and statuses are untouched (the reviews stay done; A6 keeps working).
      const statuses = await world.q<{ s: string }>(`SELECT DISTINCT "analysisStatus"::text AS s FROM games WHERE id = ANY($1::bigint[])`, [armed.map((j) => j.gameId)]);
      assert.deepEqual(statuses.map((x) => x.s), ["DONE"]);
      await world.due(["ANALYZE_GAME"], member.id);
      assert.equal(await world.drainAnalysesOf(member.id), armed.length);
      assert.deepEqual(tags(await inScope()), tags(full), "the refreshed inputs are the analysis's own");
    } finally {
      world.settings.healMaxRows = 40;
    }
  });

  it("regression: weakness-tz-week — moving west across Monday midnight never writes an older week", async () => {
    await env.owner.query(`UPDATE users SET "timeZone" = 'Asia/Tokyo' WHERE id = $1`, [member.id]);
    // Monday 2026-11-16 00:30 in Tokyo = Sunday 07:30 in Los Angeles.
    await world.at(Date.UTC(2026, 10, 15, 15, 30));
    await world.arm(member.id, "user");
    await world.recompute(member.id);
    const weeks = async () =>
      world.q<{ weekStart: string; computedAtMs: number }>(
        `SELECT to_char("weekStart", 'YYYY-MM-DD') AS "weekStart", (extract(epoch FROM "computedAt") * 1000)::float8 AS "computedAtMs"
           FROM ${env.schema}.weakness_snapshots WHERE "userId" = $1 ORDER BY "weekStart" DESC`,
        [member.id],
      );
    const before = await weeks();
    assert.equal(before[0]!.weekStart, "2026-11-16");
    await env.owner.query(`UPDATE users SET "timeZone" = 'America/Los_Angeles' WHERE id = $1`, [member.id]);
    await world.at(Date.UTC(2026, 10, 15, 17, 0));
    await world.arm(member.id, "user");
    await world.recompute(member.id);
    const afterRun = await weeks();
    assert.deepEqual(afterRun.map((w) => w.weekStart), before.map((w) => w.weekStart), "no row for the LA week 2026-11-09 was written over");
    assert.ok(afterRun[0]!.computedAtMs > before[0]!.computedAtMs, "the newest week took the fresh profile");
    const older = before.find((w) => w.weekStart === "2026-11-09");
    assert.ok(older, "last week's row (written at the import's clock, 2026-11-12) exists");
    assert.equal(afterRun.find((w) => w.weekStart === "2026-11-09")!.computedAtMs, older.computedAtMs, "last week's history is untouched");
  });

  it("regression: weakness-hadready-any-week — a newer INSUFFICIENT week turns the progress frames back on", async () => {
    // A scope with no games (classical) next week: the newest row is INSUFFICIENT, an older one READY.
    await env.owner.query(`UPDATE ${env.schema}.training_profiles SET "weaknessTimeClasses" = '{CLASSICAL}' WHERE "userId" = $1`, [member.id]);
    try {
      await world.at(Date.UTC(2026, 10, 23, 18, 0));
      await world.arm(member.id, "user");
      await world.recompute(member.id);
      const snaps = await world.snapshots(member.id);
      assert.equal(snaps[0]!.status, "INSUFFICIENT");
      assert.ok(snaps.slice(1).some((s) => s.status === "READY"));
      const c = (await loadWeaknessContext(world.db, member.id))!;
      assert.deepEqual([c.hadReady, c.everReady, c.latestWeekStart], [false, true, snaps[0]!.weekStart]);
      assert.equal(c.prevTop, null);
      world.progress.reset();
      const r = await world.progress.maybeEmit({ userId: member.id, userRef: member.ref }, "analysis");
      assert.notEqual(r.skipped, "ready", JSON.stringify(r));
    } finally {
      await env.owner.query(`UPDATE ${env.schema}.training_profiles SET "weaknessTimeClasses" = '{}' WHERE "userId" = $1`, [member.id]);
    }
  });

  it("regression: weakness-paused-outlives-switch — the heal sweep re-arms a paused member with an INSUFFICIENT profile", async () => {
    world.settings.enabled = false;
    try {
      await world.arm(member.id, "user");
      await world.recompute(member.id);
    } finally {
      world.settings.enabled = true;
    }
    const paused = (await world.job(member.id))!;
    assert.deepEqual([paused.status, paused.result?.skipped], ["DONE", "disabled"]);
    assert.equal((await world.snapshots(member.id))[0]!.status, "INSUFFICIENT");
    await world.db.query(healSweepStatement(world.settings));
    const armed = (await world.job(member.id))!;
    assert.equal(armed.status, "QUEUED");
    assert.equal(armed.payload.trigger, "heal");
    await world.recompute(member.id);
    assert.notEqual((await world.job(member.id))!.result?.skipped, "disabled", "the switch is on: it ran");
  });

  it("regression: weakness-purge-older-weeks — IMPORT_PURGE deletes every week of the member's profile; the rebuild writes the current one", async () => {
    const weeksBefore = await world.snapshots(member.id);
    assert.ok(weeksBefore.length >= 2, `weeks: ${weeksBefore.map((w) => w.weekStart).join(", ")}`);
    assert.ok(weeksBefore.some((w) => w.status === "READY" && (WeaknessMetricsV1.parse(w.metrics).rows.some((r) => r.example !== null))), "an older week holds examples");
    await insertJob(env, {
      kind: "IMPORT_PURGE",
      priority: JOB_PRIORITY.IMPORT_PURGE,
      payload: { v: 1, userId: member.id, provider: "LICHESS", requestedAt: new Date().toISOString() },
      dedupeKey: importPurgeDedupeKey(member.id, "LICHESS"),
      maxAttempts: JOB_MAX_ATTEMPTS.IMPORT_PURGE,
    });
    const purge = await world.claim(["IMPORT_PURGE"]);
    assert.ok(purge);
    assert.equal(await world.runClaimed(purge), "done");
    assert.deepEqual(await world.snapshots(member.id), [], "no week of the purged games' profile is left");
    const job = (await world.job(member.id))!;
    assert.deepEqual([job.status, job.payload.trigger], ["QUEUED", "removed"]);
    await world.at(world.clock.now() + HOUR);
    await world.recompute(member.id);
    const after = await world.snapshots(member.id);
    assert.equal(after.length, 1);
    assert.equal(after[0]!.status, "INSUFFICIENT");
  });
});

