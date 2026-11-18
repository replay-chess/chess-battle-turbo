// FIX-3 (review round 3) against Postgres, on a member built by the real pipelines (testing/weakness-world.ts: the CC0
// Lichess fixture account knightowl88 imported by IMPORT_SYNC, graded by ANALYZE_GAME with the FakeEngine, the P6 final
// batch, the READY profile from the real RECOMPUTE_WEAKNESS handler), the real runner, outcome and reaper statements:
//   - regression: lines-failure-fails-game — a `weakness_lines` refresh that fails (its engine search crashes), is
//     released or reaped never touches the game (no FAILED/QUEUED status, no failedAtPly, no `analysis:failed`), even
//     while the game's own regrade is queued or running (D-P6-FIX3-2);
//   - regression: lines-payload-old-worker — the refresh is written as payload v 2: a worker built before it (claim
//     v ≤ 1, its reader without the reason) never claims it and would release it untouched; this build reads it;
//   - regression: weakness-search-isolation — a crashed weakness search never fails a regrade, a spent budget never
//     makes an analysis search: the inputs are written without those lines and a lines refresh is armed (D-P6-FIX3-9);
//   - regression: lines-disabled-lost — with the kill switch off a lines refresh waits (QUEUED a day later) instead
//     of ending DONE "disabled"; it runs once the switch is back; games of non-entitled members arm none (D-P6-FIX3-10);
//   - regression: heal-failed-forever — a row marked failed by one inputs version is retried once by a higher version
//     (the daily heal sweep arms the member), and a second failure is never retried again (D-P6-FIX3-8);
//   - regression: purge-vs-first-build — IMPORT_PURGE finishing while the member's FIRST build runs (no snapshot yet)
//     never leaves a profile of the purged games: the build's final batch refuses inputs that a purge removed after it
//     read them and runs again; the purge arms the running row (D-P6-FIX3-1).
// Skipped without TEST_DATABASE_URL.
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { decodeMove, errorJudgementOf, moverAt, type Color } from "@repo/chess-analysis/codec";
import { replayUci } from "@repo/chess-analysis/replay";
import {
  AnalyzeGamePayloadV1,
  importPurgeDedupeKey,
  JOB_MAX_ATTEMPTS,
  JOB_PRIORITY,
  PAYLOAD_V_MAX,
  readJobPayload,
} from "@repo/contracts/internal/jobs";
import { WeaknessMetricsV1 } from "@repo/contracts/internal/weakness-metrics";
import { enqueueAnalysisSql } from "@repo/db/jobs";
import { weaknessLinesSql } from "@repo/db/weakness-jobs";
import { fromPrisma } from "../db/client";
import { planPositions } from "../pipeline/positions";
import { claimJob } from "../queue/claim";
import { reapStatement, releaseStatement, toFailedJob } from "../queue/outcome";
import { healSweepStatement } from "../scheduler/recurring/weakness";
import { insertJob, setupInt, skipInt, type IntEnv, type TestUser } from "../testing/pg";
import { IMPORT_T0 } from "../import/__tests__/harness";
import { DAY_MS, WeaknessWorld, worldTag } from "../testing/weakness-world";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * The reader of the build before FIX-2 (b81a763, packages/contracts/src/internal/jobs.ts), in what decides a claimed
 * row's fate: PAYLOAD_V_MAX 1 (its claim takes v ≤ 1 only), `v > 1` → "newer" (released untouched), else the V1 schema
 * whose reasons did not include `weakness_lines` → "invalid" (the runner fails the row for good, a Sentry error each).
 */
const P5_PAYLOAD_V_MAX = 1;
const P5_REASONS: readonly string[] = ["live_end", "bot_end", "opened", "retry", "regrade", "backfill", "smoke", "import"];
function p5Read(payload: Record<string, unknown>): "newer" | "invalid" | "ok" {
  const v = payload.v;
  if (typeof v === "number" && Number.isInteger(v) && v > P5_PAYLOAD_V_MAX) return "newer";
  const parsed = AnalyzeGamePayloadV1.safeParse(payload);
  return parsed.success && P5_REASONS.includes(parsed.data.reason) ? "ok" : "invalid";
}

describe("FIX-3: lines refresh failures, payload version, search isolation, kill switch, failed-row retry, purge race (Postgres, real pipelines)", { skip: skipInt }, () => {
  let env: IntEnv;
  let world: WeaknessWorld;
  let member: TestUser;

  before(async () => {
    env = await setupInt("wkfix3");
    world = new WeaknessWorld(env, worldTag());
    world.imp.upstream.addLichessFixture("knightowl88");
    member = await world.member("paying", "wkfix3", "Asia/Kolkata");
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

  /** Runs every due ANALYZE_GAME (the refreshes earlier steps armed), so a test starts from a quiet engine queue. */
  async function settle(): Promise<void> {
    await world.due(["ANALYZE_GAME"]);
    await world.drainAnalyses();
  }

  /** The member's DONE games whose stored analysis lacks a line for some member error (a lines refresh searches). */
  async function gamesNeedingLines(): Promise<{ id: string; ref: string }[]> {
    const rows = await world.q<{ id: string; ref: string; moves: string; startingFen: string; color: Color; best: number[]; judgements: number[]; lines: Record<string, { pv?: string }> | null }>(
      `SELECT g.id::text AS id, g."referenceId" AS ref, g.moves, g."startingFen", gp.color, ga.best, ga.judgements, ga.lines
         FROM game_players gp JOIN games g ON g.id = gp."gameId" JOIN ${env.schema}.game_analyses ga ON ga."gameId" = gp."gameId"
        WHERE gp."userId" = $1 AND ga."completedAt" IS NOT NULL AND g."analysisStatus" = 'DONE'
        ORDER BY g.id`,
      [member.id],
    );
    const out: { id: string; ref: string }[] = [];
    for (const r of rows) {
      const replay = replayUci(r.startingFen, r.moves.trim().split(/\s+/).filter(Boolean));
      const positions = planPositions(replay);
      const lines = r.lines ?? {};
      let wants = 0;
      for (let i = 0; i < replay.uci.length; i++) {
        if (moverAt(i, replay.startMover) !== r.color || errorJudgementOf(r.judgements[i] ?? 0) === null) continue;
        if (!lines[String(i)]?.pv && positions[i]!.terminal === null) wants++;
        const next = positions[i + 1];
        if (next && next.terminal === null && !lines[String(i + 1)]?.pv && decodeMove(r.best[i + 1] ?? 0) === null) wants++;
      }
      if (wants > 0) out.push({ id: r.id, ref: r.ref });
    }
    return out;
  }

  const armLines = (games: readonly { id: string; ref: string }[]) =>
    world.db.query(fromPrisma(weaknessLinesSql(games.map((g) => ({ gameId: g.id, gameRef: g.ref })))));
  const linesJob = async (gameId: string) =>
    (
      await world.q<{ id: string; status: string; payload: Record<string, unknown>; attempts: number; runAtMs: number; nowMs: number; result: Record<string, unknown> | null }>(
        `SELECT id::text AS id, status::text AS status, payload, attempts, (extract(epoch FROM "runAt") * 1000)::float8 AS "runAtMs",
                (extract(epoch FROM (now() AT TIME ZONE 'UTC')) * 1000)::float8 AS "nowMs", result
           FROM ${env.schema}.jobs WHERE "dedupeKey" = 'weaklines:' || $1::text`,
        [gameId],
      )
    )[0];
  const gameState = async (gameId: string) =>
    (
      await world.q<{ status: string; failedAtPly: number | null; gamesVersion: number }>(
        `SELECT g."analysisStatus"::text AS status, ga."failedAtPly", u."gamesVersion"
           FROM games g JOIN ${env.schema}.game_analyses ga ON ga."gameId" = g.id
           JOIN game_players gp ON gp."gameId" = g.id JOIN users u ON u.id = gp."userId"
          WHERE g.id = $1 AND gp."userId" = $2`,
        [gameId, member.id],
      )
    )[0]!;
  const failedEmits = () => world.emitter.sent.filter((e) => e.event === "analysis:failed").length;
  /** P3's regrade enqueue for a game (the DONE analyze row revived, the game QUEUED). */
  const enqueueRegrade = (g: { id: string; ref: string }) =>
    world.db.query(fromPrisma(enqueueAnalysisSql({ gameId: BigInt(g.id), gameRef: g.ref, priority: JOB_PRIORITY.HOUSEKEEPING, reason: "regrade" })));

  it("regression: lines-failure-fails-game — a failed, released or reaped lines refresh never touches the game, its regrade queued or running", async () => {
    await settle();
    const [g1, g2, g3] = await gamesNeedingLines();
    assert.ok(g1 && g2 && g3, "three games whose errors lack a stored line");

    // 1. Fail: the refresh's engine search crashes twice (the pool's restart-and-retry used up) while the game's
    // regrade waits in the queue. The runner's own fail path runs (fail → failStatement → the hook).
    await armLines([g1]);
    const lines = await world.claimRow(`weaklines:${g1.id}`);
    assert.ok(lines);
    await enqueueRegrade(g1);
    const before1 = await gameState(g1.id);
    assert.equal(before1.status, "QUEUED", "the regrade queued the game");
    const emits0 = failedEmits();
    world.engine.injectCrash(2);
    assert.equal(await world.runClaimed(lines), "failed");
    const after1 = await gameState(g1.id);
    assert.deepEqual(after1, before1, "the game's status, failedAtPly and the member's gamesVersion are untouched");
    assert.equal(failedEmits(), emits0, "no analysis:failed for a lines refresh");
    const lj = (await linesJob(g1.id))!;
    assert.deepEqual([lj.status, lj.attempts], ["QUEUED", 1], "the refresh itself retries after its back-off");

    // 2. Release (SIGTERM) while the game's regrade is RUNNING on another lane: the game stays RUNNING.
    await armLines([g2]);
    const l2 = await world.claimRow(`weaklines:${g2.id}`);
    assert.ok(l2);
    await env.owner.query(`UPDATE games SET "analysisStatus" = 'RUNNING' WHERE id = $1`, [g2.id]);
    const released = await world.db.query(releaseStatement(l2.id, "int-weak-00000001"));
    assert.equal(released.length, 1);
    assert.equal(released[0]!.gamesRequeued, 0);
    assert.equal((await gameState(g2.id)).status, "RUNNING", "a released refresh never puts the game back to QUEUED");
    await env.owner.query(`UPDATE games SET "analysisStatus" = 'DONE' WHERE id = $1`, [g2.id]);

    // 3. Reap: a stalled refresh on its last attempt (FAILED for good) while the game's regrade is queued.
    await armLines([g3]);
    const l3 = await world.claimRow(`weaklines:${g3.id}`, "gone-worker-00000001");
    assert.ok(l3);
    await enqueueRegrade(g3);
    await env.owner.query(
      `UPDATE ${env.schema}.jobs SET "heartbeatAt" = (now() AT TIME ZONE 'UTC') - interval '10 minutes', attempts = "maxAttempts" WHERE id = $1`,
      [l3.id],
    );
    const before3 = await gameState(g3.id);
    const reaped = (await world.db.query(reapStatement({ workerId: "fix3-reaper", me: "fix3-reaper-00000001" }))).map(toFailedJob);
    const mine = reaped.find((r) => r.id === l3.id);
    assert.ok(mine, "the stalled refresh was reaped");
    assert.equal(mine.status, "FAILED");
    assert.equal(mine.game, null, "no game and no members returned: no analysis:failed");
    assert.deepEqual(await gameState(g3.id), before3, "a reaped refresh never fails the game");
    // The regrades of g1 and g3 then run as usual.
    await settle();
    assert.equal((await gameState(g1.id)).status, "DONE");
    assert.equal((await gameState(g3.id)).status, "DONE");
  });

  it("regression: lines-payload-old-worker — a lines refresh is payload v 2: the previous build never claims it and would release it; this build reads it", async () => {
    await settle();
    const [g] = await gamesNeedingLines();
    assert.ok(g);
    await armLines([g]);
    const row = (await linesJob(g.id))!;
    assert.equal(row.payload.v, 2);
    assert.equal(row.payload.reason, "weakness_lines");
    // The previous build's claim (v ≤ 1) does not take it: no other job is due, so it claims nothing at all.
    assert.equal(await claimJob(world.db, "old-build-00000001", ["ANALYZE_GAME"], P5_PAYLOAD_V_MAX), null, "an older worker never claims it");
    // Had it claimed it (an adoption, a hand edit), its reader says "newer": released untouched, not failed.
    assert.equal(p5Read(row.payload), "newer");
    // FIX-2's v 1 form is what the previous build failed for good ("invalid payload", a Sentry error per job).
    assert.equal(p5Read({ ...row.payload, v: 1 }), "invalid");
    // This build claims and reads it.
    assert.equal(PAYLOAD_V_MAX >= 2, true);
    assert.deepEqual(readJobPayload("ANALYZE_GAME", row.payload).ok, true);
    // (Other games' refreshes, v 2 as well, may be due too: run what the claim hands out until it reaches this one.)
    for (let n = 0; ; n++) {
      assert.ok(n < 50, "this build's claim reaches the v 2 refresh");
      const claimed = await claimJob(world.db, "int-weak-00000001", ["ANALYZE_GAME"], PAYLOAD_V_MAX);
      assert.ok(claimed, "this build's claim takes v 2 rows");
      assert.equal(await world.runClaimed(claimed), "done");
      if (claimed.id === row.id) break;
    }
    assert.equal((await linesJob(g.id))!.status, "DONE");
  });

  it("regression: weakness-search-isolation — a crashed weakness search never fails a regrade; a spent budget never searches; a lines refresh is armed", async () => {
    await settle();
    const [g] = await gamesNeedingLines();
    assert.ok(g);
    await env.owner.query(`DELETE FROM ${env.schema}.jobs WHERE "dedupeKey" = 'weaklines:' || $1::text`, [g.id]);
    await env.owner.query(`UPDATE game_players SET "weaknessInputsV" = 0, stats = '{}', "errorLog" = '{}', "errorThemes" = '{}', "errorThemeN" = '{}' WHERE "gameId" = $1 AND "userId" = $2`, [g.id, member.id]);
    await enqueueRegrade(g);
    await world.due(["ANALYZE_GAME"], member.id);
    const job = await world.claimRow(`analyze:${g.id}`);
    assert.ok(job);
    // The regrade's only engine work is the weakness searches: the first one crashes twice (EngineFailed).
    world.engine.injectCrash(2);
    assert.equal(await world.runClaimed(job), "done", "the regrade completes");
    assert.equal((await gameState(g.id)).status, "DONE");
    const side = (await world.inputs(member.id)).find((x) => x.gameId === g.id)!;
    assert.ok(side.weaknessInputsV >= 1, "the inputs were written without the missing lines");
    const armed = await linesJob(g.id);
    assert.ok(armed && armed.status === "QUEUED" && armed.payload.v === 2, "a lines refresh of the game is armed");

    // A fresh analysis whose weakness budget is spent: no weakness search at all, the analysis DONE, refreshes armed.
    const budgetWorld = new WeaknessWorld(env, worldTag(), { weakness: { linesBudgetMs: 0 } });
    try {
      const b = await budgetWorld.member("paying", "wkfix3b", "Asia/Kolkata");
      budgetWorld.imp.upstream.addLichessMany("knightowl88", 6, IMPORT_T0 - 3 * DAY_MS, 6 * 3_600_000);
      await budgetWorld.importAccount(b, "LICHESS", "knightowl88");
      await budgetWorld.due(["ANALYZE_GAME"], b.id);
      const searches0 = budgetWorld.telemetry.named("worker.weakness.line_searches").length;
      // The analyses only (their `analyze:` rows); the refreshes they arm stay queued.
      const ids = (await budgetWorld.q<{ id: string }>(`SELECT "gameId"::text AS id FROM game_players WHERE "userId" = $1`, [b.id])).map((x) => x.id);
      let ran = 0;
      for (const id of ids) {
        const a = await budgetWorld.claimRow(`analyze:${id}`);
        if (!a) continue;
        assert.equal(await budgetWorld.runClaimed(a), "done");
        ran++;
      }
      assert.ok(ran >= 4, `analyses run: ${ran}`);
      assert.equal(budgetWorld.telemetry.named("worker.weakness.line_searches").length, searches0, "no weakness search past the budget");
      const cut = budgetWorld.telemetry.named("worker.weakness.lines_cut").reduce((s, m) => s + m.value, 0);
      assert.ok(cut > 0, "the analyses cut their weakness searches");
      const games = await budgetWorld.q<{ id: string; status: string; v: number; lines: string | null }>(
        `SELECT g.id::text AS id, g."analysisStatus"::text AS status, gp."weaknessInputsV" AS v,
                (SELECT j.status::text FROM ${env.schema}.jobs j WHERE j."dedupeKey" = 'weaklines:' || g.id::text) AS lines
           FROM games g JOIN game_players gp ON gp."gameId" = g.id WHERE gp."userId" = $1 AND gp.accuracy IS NOT NULL`,
        [b.id],
      );
      assert.ok(games.length >= 4 && games.every((x) => x.status === "DONE" && x.v >= 1), JSON.stringify(games));
      assert.equal(games.filter((x) => x.lines === "QUEUED").length, cut, "one lines refresh per cut analysis");
    } finally {
      await budgetWorld.close();
    }
  });

  it("regression: lines-disabled-lost — the kill switch pauses a lines refresh (QUEUED, a day later) and it runs once the switch is back; non-entitled games arm none", async () => {
    await settle();
    const [g] = await gamesNeedingLines();
    assert.ok(g);
    await armLines([g]);
    const job = await world.claimRow(`weaklines:${g.id}`);
    assert.ok(job);
    world.settings.enabled = false;
    try {
      assert.equal(await world.runClaimed(job), "done");
    } finally {
      world.settings.enabled = true;
    }
    const paused = (await linesJob(g.id))!;
    assert.equal(paused.status, "QUEUED", "never DONE 'disabled' (lost for good)");
    assert.equal(paused.attempts, 0);
    assert.ok(Math.abs(paused.runAtMs - (world.clock.now() + DAY_MS)) < 5_000, "it waits a day (the worker's clock)");
    // The switch is back on: the row runs and refreshes the game.
    await env.owner.query(`UPDATE ${env.schema}.jobs SET "runAt" = (now() AT TIME ZONE 'UTC') - interval '1 second' WHERE id = $1`, [paused.id]);
    const again = await world.claimRow(`weaklines:${g.id}`);
    assert.ok(again);
    assert.equal(await world.runClaimed(again), "done");
    const done = (await linesJob(g.id))!;
    assert.equal(done.status, "DONE");
    assert.ok(Number(done.result?.searched ?? 0) > 0, JSON.stringify(done.result));

    // A game whose only member side belongs to a non-entitled member: no refresh is armed (no profile to feed).
    const free = await world.member("none", "wkfix3free", "Asia/Kolkata");
    const freeGame = (await world.q<{ id: string; ref: string }>(
      `SELECT g.id::text AS id, g."referenceId" AS ref FROM games g JOIN game_players gp ON gp."gameId" = g.id
        WHERE gp."userId" = $1 ORDER BY g.id LIMIT 1`,
      [member.id],
    ))[0]!;
    // Hand the side to the non-entitled member for this check, then back.
    await env.owner.query(`UPDATE game_players SET "userId" = $1 WHERE "gameId" = $2 AND "userId" = $3`, [free.id, freeGame.id, member.id]);
    try {
      await env.owner.query(`DELETE FROM ${env.schema}.jobs WHERE "dedupeKey" = 'weaklines:' || $1::text`, [freeGame.id]);
      const [r] = await armLines([freeGame]);
      assert.equal(Number(r?.armed), 0, "a non-entitled member's game arms no lines refresh");
      assert.equal(await linesJob(freeGame.id), undefined);
    } finally {
      await env.owner.query(`UPDATE game_players SET "userId" = $1 WHERE "gameId" = $2 AND "userId" = $3`, [member.id, freeGame.id, free.id]);
    }
  });

  it("regression: heal-failed-forever — a version bump retries rows an earlier version could not compute, once", async () => {
    await settle();
    await world.arm(member.id, "user");
    await world.recompute(member.id);
    const sides = (await world.inputs(member.id)).filter((x) => x.accuracy !== null && x.timeClass === "BLITZ");
    const broken = sides.slice(0, 2).map((s) => s.gameId);
    assert.equal(broken.length, 2);
    const saved = await world.q<{ gameId: string; evals: number[] }>(
      `SELECT "gameId"::text AS "gameId", evals FROM ${env.schema}.game_analyses WHERE "gameId" = ANY($1::bigint[])`,
      [broken],
    );
    const v = async () => (await world.inputs(member.id)).filter((x) => broken.includes(x.gameId)).map((x) => x.weaknessInputsV);
    try {
      // Version 1 (this build) cannot read them (a "tagger bug": the stored evals no longer fit): marked −1.
      await env.owner.query(`UPDATE game_players SET "weaknessInputsV" = 0 WHERE "userId" = $1 AND "gameId" = ANY($2::bigint[])`, [member.id, broken]);
      await env.owner.query(`UPDATE ${env.schema}.game_analyses SET evals = evals[1:3] WHERE "gameId" = ANY($1::bigint[])`, [broken]);
      await world.arm(member.id, "user");
      await world.recompute(member.id);
      assert.deepEqual(await v(), [-1, -1]);
      // The bug is fixed (the rows read again); version 1 never retries them (the heal loop stays closed).
      for (const s of saved) await env.owner.query(`UPDATE ${env.schema}.game_analyses SET evals = $2 WHERE "gameId" = $1`, [s.gameId, s.evals]);
      await world.arm(member.id, "user");
      await world.recompute(member.id);
      assert.deepEqual(await v(), [-1, -1], "the same version never retries a failed row");
      // A build with inputs version 2: the daily heal sweep arms the member (a current-algo READY profile), the heal
      // retries the two rows once and they are healed.
      world.settings.inputsVersion = 2;
      await env.owner.query(`UPDATE ${env.schema}.jobs SET status = 'DONE' WHERE "dedupeKey" = 'weakness:' || $1::text AND status = 'QUEUED'`, [member.id]);
      const [swept] = await world.db.query(healSweepStatement(world.settings));
      assert.ok(Number(swept?.healed) >= 1, "the sweep arms the member with retryable rows");
      assert.equal((await world.job(member.id))!.payload.trigger, "heal");
      await world.recompute(member.id);
      assert.deepEqual(await v(), [2, 2], "healed under version 2");
      // A row that fails again under version 2 is marked −2 and never armed or retried by version 2 again.
      await env.owner.query(`UPDATE game_players SET "weaknessInputsV" = -1 WHERE "userId" = $1 AND "gameId" = ANY($2::bigint[])`, [member.id, broken]);
      await env.owner.query(`UPDATE ${env.schema}.game_analyses SET evals = evals[1:3] WHERE "gameId" = ANY($1::bigint[])`, [broken]);
      await world.arm(member.id, "user");
      await world.recompute(member.id);
      assert.deepEqual(await v(), [-2, -2]);
      await env.owner.query(`UPDATE ${env.schema}.jobs SET status = 'DONE' WHERE "dedupeKey" = 'weakness:' || $1::text AND status = 'QUEUED'`, [member.id]);
      const [none] = await world.db.query(healSweepStatement(world.settings));
      assert.equal(Number(none?.healed), 0, "no member is armed for rows this version already failed");
    } finally {
      world.settings.inputsVersion = 1;
      for (const s of saved) await env.owner.query(`UPDATE ${env.schema}.game_analyses SET evals = $2 WHERE "gameId" = $1`, [s.gameId, s.evals]);
      await env.owner.query(`UPDATE game_players SET "weaknessInputsV" = 0 WHERE "userId" = $1 AND "gameId" = ANY($2::bigint[])`, [member.id, broken]);
    }
  });

  // Last: it purges the member's games.
  it("regression: purge-vs-first-build — a purge that finishes while the first build runs never leaves a profile of the purged games", async () => {
    await settle();
    // The member's first build: no snapshot of any week yet.
    await env.owner.query(`DELETE FROM ${env.schema}.weakness_snapshots WHERE "userId" = $1`, [member.id]);
    await env.owner.query(`UPDATE ${env.schema}.jobs SET status = 'DONE' WHERE "dedupeKey" = 'weakness:' || $1::text`, [member.id]);
    await world.arm(member.id, "user");
    const build = await world.claimRow(`weakness:${member.id}`);
    assert.ok(build);
    // Hold the build's job row so its final batch waits at its lock guard after it read its inputs and examples.
    const lock = await env.owner.connect();
    let run: Promise<unknown> | null = null;
    let purging: Promise<unknown> | null = null;
    try {
      await lock.query("BEGIN");
      await lock.query(`SELECT 1 FROM ${env.schema}.jobs WHERE id = $1 FOR UPDATE`, [build.id]);
      run = world.runClaimed(build);
      const waiting = async () =>
        Number((await env.owner.query(`SELECT count(*)::int AS n FROM pg_stat_activity WHERE wait_event_type = 'Lock' AND datname = current_database()`)).rows[0].n);
      for (let i = 0; i < 200 && (await waiting()) === 0; i++) await sleep(100);
      assert.ok((await waiting()) > 0, "the build's final batch waits on its job row");
      // The member disconnects the account with "delete games": the purge runs while the build waits.
      await insertJob(env, {
        kind: "IMPORT_PURGE",
        priority: JOB_PRIORITY.IMPORT_PURGE,
        payload: { v: 1, userId: member.id, provider: "LICHESS", requestedAt: new Date().toISOString() },
        dedupeKey: importPurgeDedupeKey(member.id, "LICHESS"),
        maxAttempts: JOB_MAX_ATTEMPTS.IMPORT_PURGE,
      });
      const purge = await world.claim(["IMPORT_PURGE"]);
      assert.ok(purge);
      purging = world.runClaimed(purge);
      await sleep(3_000);
    } finally {
      await lock.query("COMMIT");
      lock.release();
    }
    assert.equal(await purging, "done");
    assert.equal(await run, "done");
    const left = Number((await world.q<{ n: number }>(`SELECT count(*)::int AS n FROM game_players WHERE "userId" = $1`, [member.id]))[0]!.n);
    assert.equal(left, 0, "the purge removed every side");
    const snaps = await world.snapshots(member.id);
    const purgedData = snaps.filter((s) => s.gamesAnalysed > 0 || WeaknessMetricsV1.parse(s.metrics).rows.some((r) => r.example !== null));
    assert.deepEqual(purgedData.map((s) => [s.weekStart, s.status, s.gamesAnalysed]), [], "no snapshot built from the purged games survives");
    const job = (await world.job(member.id))!;
    assert.equal(job.status, "QUEUED", "the member's recompute runs again");
    // It runs: the profile says what is left (nothing).
    await world.recompute(member.id);
    const after = await world.snapshots(member.id);
    assert.equal(after.length, 1);
    assert.equal(after[0]!.status, "INSUFFICIENT");
    assert.equal(after[0]!.gamesAnalysed, 0);
  });
});
