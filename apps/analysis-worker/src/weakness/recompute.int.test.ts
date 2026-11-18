// RECOMPUTE_WEAKNESS against Postgres on rows the product's own pipelines wrote (phase-06 plan §12.3; testing/
// weakness-world.ts): a paying member in Asia/Kolkata links the CC0 fixture accounts (Chess.com knightowl_88: 48 games,
// Lichess knightowl88: 30 games with %clk and %eval; Aug–Oct 2026), the real IMPORT_SYNC imports them, the real
// ANALYZE_GAME grades every game (FakeEngine, or Stockfish 18 with WEAKNESS_INT_ENGINE=stockfish) with J1's bank and
// P6's final-batch extension, then the job under test runs. Checks:
//   - the final batch wrote the five input columns of every analysed side, equal to CA computeSideInputs over the
//     stored rows and each position's pass-1 line (FIX-1), and bank mistakes played under a minute carry
//     `rc:timePressure`;
//   - happy path: one READY snapshot for the member's local week, valid metrics, examples from the bank, the version
//     bumped once, `weakness:ready {bumped: true}` to `user:{ref}` with its dedupe key, PostHog `weakness_snapshot_
//     computed` and `weakness_first_ready` once, the Sentry metrics;
//   - a rerun in the same week upserts the same row and does not bump; a trigger that arrives while it RUNS re-queues
//     it at +240 s (rerunIfFlagged);
//   - heal: rows reset to `weaknessInputsV = 0` (an analysis made before P6) are filled once with what the stored rows
//     give (computeSideInputs over them), a second run heals nothing;
//   - weekStart is the Monday of the member's own zone (Asia/Kolkata and America/Los_Angeles, Sunday night / Monday
//     morning);
//   - lapsed member: DONE `skipped: "lapsed"`, nothing written; kill switch: DONE `skipped: "disabled"`;
//   - production refuses a READY snapshot on the synthetic baseline (terminal, FAILED row without a READY one), and
//     writes READY on the default real baseline (v1);
//   - the final failure: 3 thrown attempts → FAILED only when no READY row exists; with a READY row it is unchanged;
//     Sentry tags {job_kind, algo_version, trigger}; PostHog `weakness_recompute_failed`;
//   - a lost response of the committed batch: recognised by the completion token, the event still goes out once.
// Skipped without TEST_DATABASE_URL.
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { replayUci } from "@repo/chess-analysis/replay";
import { ENGINE_PROFILE } from "@repo/chess-analysis/version";
import { computeSideInputs } from "@repo/chess-analysis/weakness-inputs";
import { DEFAULT_BASELINE_ID } from "@repo/chess-training/baselines/load";
import { ALGO_VERSION, GAMES_REQUIRED } from "@repo/chess-training/weakness/constants";
import { weekStartOf } from "@repo/chess-training/weakness/scope";
import { WeaknessMetricsV1 } from "@repo/contracts/internal/weakness-metrics";
import { WeaknessReadyEvent } from "@repo/contracts/socket/user";
import { JOB_PRIORITY } from "@repo/contracts/internal/jobs";
import { enqueueAnalysisSql } from "@repo/db/jobs";
import { fromPrisma } from "../db/client";
import { FakeEngine } from "../engine/fake";
import { IMPORT_T0, loseOnce } from "../import/__tests__/harness";
import { failReapedWeakness } from "../jobs/weakness-recompute";
import { reapStatement, toFailedJob } from "../queue/outcome";
import { analysisTriggerStatement } from "./triggers";
import { setupInt, skipInt, type IntEnv, type TestUser } from "../testing/pg";
import { DAY_MS, WeaknessWorld, worldTag } from "../testing/weakness-world";

describe("RECOMPUTE_WEAKNESS on imported, analysed games (Postgres)", { skip: skipInt }, () => {
  let env: IntEnv;
  let world: WeaknessWorld;
  let member: TestUser;
  let analysed = 0;
  const firstAnalysisTrips: string[][] = [];

  /** Every analysed side of a member, read back as CA computeSideInputs takes it (the heal's own reading). */
  async function storedSides(userId: string, gameIds?: readonly string[]) {
    const rows = await world.q<Record<string, unknown>>(
      `SELECT g.id::text AS "gameId", g."startingFen", g."startPly", g.moves, g."moveClocksMs", g."initialTimeSeconds",
              g."timeClass"::text AS "timeClass", a.evals, a.best, a.judgements, a.lines, a."middlegamePly", a."endgamePly",
              gp.color, gp.result::text AS result
         FROM game_players gp JOIN games g ON g.id = gp."gameId" JOIN ${env.schema}.game_analyses a ON a."gameId" = g.id
        WHERE gp."userId" = $1 AND gp.accuracy IS NOT NULL AND ($2::bigint[] IS NULL OR g.id = ANY($2::bigint[]))`,
      [userId, gameIds ? [...gameIds] : null],
    );
    return rows.map((r) => ({
      gameId: String(r.gameId),
      game: {
        startingFen: String(r.startingFen),
        startPly: Number(r.startPly),
        moves: String(r.moves),
        moveClocksMs: (r.moveClocksMs as number[]) ?? [],
        initialTimeSeconds: r.initialTimeSeconds as number | null,
        timeClass: r.timeClass as string | null,
      },
      analysis: {
        evals: r.evals as number[],
        best: r.best as number[],
        judgements: r.judgements as number[],
        lines: r.lines as Record<string, { pv: string }> | null,
        middlegamePly: r.middlegamePly as number | null,
        endgamePly: r.endgamePly as number | null,
      },
      side: { color: r.color as "w" | "b", result: r.result as "WIN" | "LOSS" | "DRAW" | null },
    }));
  }

  before(async () => {
    env = await setupInt("weakness");
    world = new WeaknessWorld(env, worldTag());
    world.imp.upstream.addChessComFixture("knightowl_88");
    world.imp.upstream.addLichessFixture("knightowl88");
    member = await world.member("paying", "weakmember", "Asia/Kolkata");
    await world.importAccount(member, "CHESSCOM", "knightowl_88");
    await world.importAccount(member, "LICHESS", "knightowl88");
    await world.due(["ANALYZE_GAME"]);
    // Every round trip of the member's first analyses, for the one-batch check below (the recording driver's hook).
    world.driver.beforeRun = async (ss) => void firstAnalysisTrips.push(ss.map((s) => s.text));
    analysed = await world.drainAnalyses();
    world.driver.beforeRun = null;
  });
  after(async () => {
    await world?.close();
    await env?.close();
  });

  it("the final analysis batch wrote the five input columns: computeSideInputs over the stored rows and the pass-1 lines", async () => {
    const sides = await world.inputs(member.id);
    const analysed = sides.filter((s) => s.accuracy !== null);
    assert.ok(analysed.length >= 40, `analysed sides: ${analysed.length} of ${sides.length}`);
    for (const s of analysed) assert.equal(s.weaknessInputsV, 1, `game ${s.gameId}`);
    for (const s of sides.filter((x) => x.accuracy === null)) assert.equal(s.weaknessInputsV, 0);
    // Recompute every analysed side independently of the batch: from the stored game + analysis, and (FIX-1) with the
    // pass-1 line of each position, as the analysis searched it (the fake engine answers a position the same way
    // every time; with Stockfish only the line-independent columns are compared).
    const stored = await storedSides(member.id);
    assert.equal(stored.length, analysed.length);
    const fake = world.engineKind === "fake" ? new FakeEngine() : null;
    await fake?.start();
    let withErrors = 0;
    let hinted = 0;
    for (const r of stored) {
      const fens = replayUci(r.game.startingFen, String(r.game.moves).split(" ").filter(Boolean)).fens;
      const lines = new Map<number, string[]>();
      if (fake) {
        for (let i = 0; i < fens.length - 1; i++) {
          const res = await fake.search({ fen: fens[i]!, moves: [], nodes: ENGINE_PROFILE.pass1.nodes, multipv: ENGINE_PROFILE.pass1.multipv });
          if (res.lines[0]) lines.set(i, res.lines[0].pv);
        }
      }
      const want = computeSideInputs(r.game, r.analysis, r.side, fake ? { pass1Pv: (i) => lines.get(i) } : {});
      const oldPath = computeSideInputs(r.game, r.analysis, r.side);
      const got = analysed.find((s) => s.gameId === r.gameId)!;
      assert.deepEqual(got.stats, want.stats, `stats of ${r.gameId}`);
      assert.deepEqual(got.errorLog, want.errorLog);
      if (fake) {
        assert.deepEqual(got.errorThemeN, want.errorThemeN, `themes of ${r.gameId}`);
        assert.deepEqual(got.errorThemes, want.errorThemes);
      }
      // An eval-hinted Lichess import stores no best move for most plies: its errors were tagged from nothing before.
      if (oldPath.errorThemes.length < got.errorThemes.length) hinted++;
      if (want.errorLog.length > 0) withErrors++;
    }
    assert.ok(withErrors > 10, `sides with errors: ${withErrors}`);
    if (fake) assert.ok(hinted > 0, "regression: member-band-pv-bias — some errors without a stored line or best move were tagged from their pass-1 line");
  });

  // DoD (plan §12.6 first bullet, §15; REGRESSION-6): the five input columns and the `analysis` trigger add no round
  // trip to an analysis. They ride the ONE final batch that marks the game DONE (one sql.transaction, one HTTP request
  // on Neon); no checkpoint, load or claim carries them.
  it("the five input columns and the analysis trigger ride the final batch: one round trip per analysis, none elsewhere", () => {
    const DONE = `"analysisStatus" = 'DONE'`;
    const P3_COLUMNS = `"phaseAccuracy" = r."phaseAccuracy"`;
    const inputs = (x: string) => x.includes(`"weaknessInputsV" = $2::smallint`);
    // The `analysis` trigger (triggers.ts): the shared upsert over the members with a READY profile. The progress
    // emitter's `first_build` after the commit is a statement of its own by design (§7.4.4) and is not counted here.
    const trigger = (x: string) => x.includes(`'RECOMPUTE_WEAKNESS'`) && x.includes(`'analysis'::text`);
    assert.ok(analysed >= 40, `analyses: ${analysed}`);
    const finals = firstAnalysisTrips.filter((t) => t.some((x) => x.includes("UPDATE games") && x.includes(DONE)));
    assert.equal(finals.length, analysed, "one final batch per analysis");
    for (const t of finals) {
      assert.ok(t.some((x) => x.includes("INSERT INTO game_analyses")), "the batch writes the analysis");
      assert.ok(t.some((x) => x.includes(P3_COLUMNS)), "and the P3 player columns (counts, accuracy, phaseAccuracy, headline)");
      assert.equal(t.filter(inputs).length, 1, "the five columns: one statement in the batch");
      // The trigger is built only when the game is in a member's scope (analysis.ts inMemberScope: rated online
      // play of the scope's time classes); then it is one statement of this batch.
      assert.ok(t.filter(trigger).length <= 1, "the analysis trigger: at most one statement in the batch");
    }
    const armed = finals.filter((t) => t.some(trigger)).length;
    assert.ok(armed >= 20, `in-scope analyses whose batch carried the trigger: ${armed} of ${finals.length}`);
    const elsewhere = firstAnalysisTrips.filter((t) => !finals.includes(t) && t.some((x) => inputs(x) || trigger(x)));
    assert.deepEqual(elsewhere, [], "no other round trip writes the inputs or arms the analysis trigger");
  });

  it("bank mistakes made with under a minute on the clock carry rc:timePressure, never as the primary theme", async () => {
    const rows = await world.q<{ themes: string[]; primaryTheme: string; pressured: boolean }>(
      `SELECT m.themes, m."primaryTheme",
              COALESCE((SELECT bool_or((CASE WHEN o.ply >= 2 THEN g."moveClocksMs"[o.ply - 1] ELSE g."initialTimeSeconds" * 1000 END) < 60000)
                          FROM mistake_occurrences o JOIN games g ON g.id = o."gameId"
                         WHERE o."mistakeId" = m.id AND g."timeClass" NOT IN ('DAILY', 'UNTIMED')
                           AND cardinality(g."moveClocksMs") > 0), false) AS pressured
         FROM mistakes m WHERE m."userId" = $1`,
      [member.id],
    );
    assert.ok(rows.length > 10, `mistakes: ${rows.length}`);
    for (const r of rows) assert.notEqual(r.primaryTheme, "rc:timePressure");
    // The tag is exactly the clock rule (CA isTimePressure) over every occurrence of the mistake.
    for (const r of rows) assert.equal(r.themes.includes("rc:timePressure"), r.pressured, JSON.stringify(r));
    assert.ok(rows.some((r) => r.pressured), "the fixture games have time-pressure errors");
  });

  it("happy path: READY for the member's week, version bumped once, weakness:ready + PostHog once", async () => {
    await world.arm(member.id, "user");
    const before = await world.weaknessVersion(member.id);
    const { out } = await world.recompute(member.id);
    assert.equal(out, "done");
    const snaps = await world.snapshots(member.id);
    assert.equal(snaps.length, 1);
    const s = snaps[0]!;
    assert.equal(s.weekStart, weekStartOf(new Date(IMPORT_T0), "Asia/Kolkata"));
    assert.equal(s.algoVersion, ALGO_VERSION);
    assert.equal(s.status, "READY", `analysed ${s.gamesAnalysed} of ${s.gamesInScope}`);
    assert.ok(s.gamesAnalysed >= GAMES_REQUIRED);
    const metrics = WeaknessMetricsV1.parse(s.metrics);
    assert.equal(DEFAULT_BASELINE_ID, "v1", "the real J5 baseline is the default (WP2)");
    assert.equal(metrics.inputs.baseline, DEFAULT_BASELINE_ID);
    assert.ok(metrics.rows.length > 0, "the profile has rows");
    assert.ok(metrics.rows.some((r) => r.example !== null), "an example from the bank");
    assert.equal(await world.weaknessVersion(member.id), before + 1);
    const ready = world.weaknessEvents("weakness:ready", member.ref);
    assert.equal(ready.length, 1);
    const ev = WeaknessReadyEvent.parse(ready[0]!.data);
    assert.equal(ev.status, "ready");
    assert.equal(ev.bumped, true);
    assert.equal(ev.version, before + 1);
    assert.deepEqual(ready[0]!.userRefs, [member.ref]);
    assert.match(ready[0]!.dedupeKey ?? "", new RegExp(`^weakness:ready:${member.ref}:${s.weekStart}\\.`));
    assert.equal(world.product.named("weakness_snapshot_computed").length, 1);
    assert.equal(world.product.named("weakness_first_ready").length, 1);
    assert.deepEqual(world.product.refused, []);
    assert.ok(world.telemetry.metrics.some((m) => m.name === "worker.weakness.duration_ms"));
    // regression: weakness-sentry-incomplete (§10.2, §9.4 SLO sources): the transaction and its attributes, the push
    // latency and the time to first READY after the 20th analysis.
    const tx = world.telemetry.spans.filter((x) => x.name === "job.RECOMPUTE_WEAKNESS").at(-1)!;
    assert.equal(tx.transaction, true);
    assert.deepEqual(
      { trigger: tx.attributes.trigger, games: tx.attributes.games, analysed: tx.attributes.analysed, status: tx.attributes.status, list_mode: tx.attributes.list_mode, healed: tx.attributes.healed },
      { trigger: "user", games: s.gamesInScope, analysed: s.gamesAnalysed, status: "ready", list_mode: metrics.listMode, healed: 0 },
    );
    assert.equal(world.telemetry.named("worker.weakness.emit_ms").length, 1);
    const lag = world.telemetry.named("weakness.first_ready_lag_s");
    assert.equal(lag.length, 1);
    assert.ok(lag[0]!.value >= 0);
    assert.ok(world.telemetry.metrics.some((m) => m.name === "worker.weakness.games" && m.attributes.status === "ready"));
    const job = await world.job(member.id);
    assert.equal(job?.status, "DONE");
  });

  it("a rerun in the same week upserts the same row without a bump; a trigger while it RUNS re-queues it at +240 s", async () => {
    const v0 = await world.weaknessVersion(member.id);
    const top0 = WeaknessMetricsV1.parse((await world.snapshots(member.id))[0]!.metrics).topKeys;
    await world.arm(member.id, "user");
    await world.env.owner.query(`UPDATE ${env.schema}.jobs SET "runAt" = (now() AT TIME ZONE 'UTC') - interval '1 second' WHERE "dedupeKey" = $1`, [`weakness:${member.id}`]);
    const claimed = await world.claimRow(`weakness:${member.id}`);
    assert.ok(claimed && claimed.userId === member.id);
    // An analysis of the member finishes while the recompute runs: the shared upsert flags the RUNNING row.
    await world.db.query(analysisTriggerStatement([member.id], world.settings)!);
    assert.equal((await world.job(member.id))?.payload.rerun, true);
    assert.equal(await world.runClaimed(claimed), "done");
    const snaps = await world.snapshots(member.id);
    assert.equal(snaps.length, 1, "one row per week");
    assert.deepEqual(WeaknessMetricsV1.parse(snaps[0]!.metrics).topKeys, top0);
    assert.equal(await world.weaknessVersion(member.id), v0, "no bump: the top is unchanged");
    const ready = world.weaknessEvents("weakness:ready", member.ref);
    assert.equal(WeaknessReadyEvent.parse(ready.at(-1)!.data).bumped, false);
    const job = (await world.job(member.id))!;
    assert.equal(job.status, "QUEUED", "re-queued by rerunIfFlagged");
    assert.equal(job.payload.rerun, undefined);
    assert.equal(job.attempts, 0);
    assert.equal(job.lockedBy, null);
    const delay = job.runAtMs - job.nowMs;
    assert.ok(delay > 230_000 && delay <= 240_000, `re-queued ${delay} ms out`);
    assert.equal(job.payload.trigger, "analysis", "the merged payload carries the newest trigger");
  });

  it("heal: rows an analysis left at weaknessInputsV = 0 are filled once, with the same values; a second run heals none", async () => {
    const before = (await world.inputs(member.id)).filter((s) => s.accuracy !== null && ["BLITZ", "RAPID"].includes(s.timeClass ?? ""));
    const victims = before.slice(0, 12);
    await world.env.owner.query(
      `UPDATE game_players SET stats = '{}', "errorThemes" = '{}', "errorLog" = '{}', "errorThemeN" = '{}', "weaknessInputsV" = 0
        WHERE "userId" = $1 AND "gameId" = ANY($2::bigint[])`,
      [member.id, victims.map((v) => v.gameId)],
    );
    const healedRows0 = world.telemetry.named("worker.weakness.healed_rows").length;
    const first = await world.recompute(member.id);
    assert.equal(first.out, "done");
    assert.equal((await world.job(member.id))?.result?.healed, victims.length);
    assert.deepEqual(world.telemetry.named("worker.weakness.healed_rows").slice(healedRows0).map((m) => m.value), [victims.length]);
    const after1 = await world.inputs(member.id);
    // The heal reads only the stored rows (no engine): its values are computeSideInputs over them. The line-independent
    // columns equal the analysis's own; the themes can only lose what the analysis's pass-1 lines added (FIX-1).
    const fromStored = new Map((await storedSides(member.id, victims.map((v) => v.gameId))).map((r) => [r.gameId, computeSideInputs(r.game, r.analysis, r.side)]));
    for (const v of victims) {
      const got = after1.find((s) => s.gameId === v.gameId)!;
      assert.equal(got.weaknessInputsV, 1);
      const want = fromStored.get(v.gameId)!;
      assert.deepEqual([got.stats, got.errorLog, got.errorThemeN, got.errorThemes], [want.stats, want.errorLog, want.errorThemeN, want.errorThemes]);
      assert.deepEqual([got.stats, got.errorLog], [v.stats, v.errorLog]);
    }
    assert.equal(WeaknessMetricsV1.parse((await world.snapshots(member.id))[0]!.metrics).inputs.healed, victims.length);
    await world.arm(member.id, "user");
    await world.recompute(member.id);
    assert.equal((await world.job(member.id))?.result?.healed, 0);
  });

  it("a regrade refreshes the five columns; with a READY profile it arms the analysis trigger and sends no progress frame", async () => {
    // The `weakness_lines` refreshes the earlier heals armed (FIX-2) run first, so the drain below runs the regrade only.
    await world.due(["ANALYZE_GAME"], member.id);
    await world.drainAnalysesOf(member.id);
    const side = (await world.inputs(member.id)).find((s) => s.accuracy !== null && s.timeClass === "BLITZ")!;
    const want = { stats: side.stats, errorLog: side.errorLog, errorThemeN: side.errorThemeN, errorThemes: side.errorThemes };
    await world.env.owner.query(
      `UPDATE game_players SET stats = '{}', "errorThemes" = '{}', "errorLog" = '{}', "errorThemeN" = '{}', "weaknessInputsV" = 0
        WHERE "userId" = $1 AND "gameId" = $2`,
      [member.id, side.gameId],
    );
    const ref = (await world.q<{ ref: string }>(`SELECT "referenceId" AS ref FROM games WHERE id = $1`, [side.gameId]))[0]!.ref;
    await world.db.query(
      fromPrisma(enqueueAnalysisSql({ gameId: BigInt(side.gameId), gameRef: ref, priority: JOB_PRIORITY.HOUSEKEEPING, reason: "regrade" })),
    );
    await world.due(["ANALYZE_GAME"], member.id);
    const progress0 = world.weaknessEvents("weakness:progress", member.ref).length;
    const wakes0 = world.ioWakes.length;
    assert.equal(await world.drainAnalysesOf(member.id), 1);
    const got = (await world.inputs(member.id)).find((s) => s.gameId === side.gameId)!;
    assert.equal(got.weaknessInputsV, 1);
    // FIX-2 (D-P6-FIX2-8): the regrade path, with the engine lane's engine, searches every member error's line and
    // refutation: its inputs are the analysis's own, themes included (stored data alone tags from the best move).
    assert.deepEqual({ stats: got.stats, errorLog: got.errorLog, errorThemeN: got.errorThemeN, errorThemes: got.errorThemes }, want);
    const r = (await storedSides(member.id, [side.gameId]))[0]!;
    const fromStored = computeSideInputs(r.game, r.analysis, r.side);
    assert.deepEqual({ stats: fromStored.stats, errorLog: fromStored.errorLog }, { stats: want.stats, errorLog: want.errorLog }, "the line-independent columns are the stored data's");
    const job = (await world.job(member.id))!;
    assert.equal(job.status, "QUEUED");
    assert.equal(job.payload.trigger, "analysis");
    assert.equal(job.priority, JOB_PRIORITY.WEAKNESS);
    const delay = job.runAtMs - job.nowMs;
    assert.ok(delay > 200_000 && delay <= 240_000, `the analysis trigger waits the debounce (${delay} ms)`);
    assert.equal(world.weaknessEvents("weakness:progress", member.ref).length, progress0, "READY: no progress frame");
    assert.ok(world.ioWakes.length > wakes0, "the I/O lane was told");
  });

  it("weekStart is the Monday of the member's own zone (Sunday night / Monday morning)", async () => {
    // Another member in Los Angeles, with her own import of the Lichess fixture lines (re-dated to the last days).
    const laWorld = new WeaknessWorld(env, worldTag());
    try {
      const la = await laWorld.member("paying", "weakla", "America/Los_Angeles");
      laWorld.imp.upstream.addLichessMany("knightowl88", 8, IMPORT_T0 - 3 * DAY_MS, 6 * 3_600_000);
      await laWorld.importAccount(la, "LICHESS", "knightowl88");
      await laWorld.due(["ANALYZE_GAME"], la.id);
      assert.ok((await laWorld.drainAnalysesOf(la.id)) >= 6);
      // 2026-11-15 18:00 UTC: Sunday 23:30 in Kolkata.
      await world.at(Date.UTC(2026, 10, 15, 18, 0, 0));
      await world.arm(member.id);
      await world.recompute(member.id);
      assert.equal((await world.snapshots(member.id))[0]!.weekStart, "2026-11-09");
      // 2026-11-16 03:00 UTC: Monday 08:30 in Kolkata, Sunday 19:00 in Los Angeles.
      for (const w of [world, laWorld]) await w.at(Date.UTC(2026, 10, 16, 3, 0, 0));
      await laWorld.arm(la.id);
      await laWorld.recompute(la.id);
      await world.arm(member.id);
      await world.recompute(member.id);
      const laSnap = (await laWorld.snapshots(la.id))[0]!;
      assert.equal(laSnap.weekStart, "2026-11-09");
      assert.equal(laSnap.status, "INSUFFICIENT");
      assert.ok(laSnap.gamesAnalysed >= 5, `analysed ${laSnap.gamesAnalysed}`);
      assert.ok(WeaknessMetricsV1.parse(laSnap.metrics).preliminary.length >= 0);
      assert.equal((await world.snapshots(member.id))[0]!.weekStart, "2026-11-16");
      // 08:00 UTC: Monday 00:00 in Los Angeles: a new week there.
      await laWorld.at(Date.UTC(2026, 10, 16, 8, 0, 0));
      await laWorld.arm(la.id);
      await laWorld.recompute(la.id);
      assert.deepEqual((await laWorld.snapshots(la.id)).map((r) => r.weekStart), ["2026-11-16", "2026-11-09"]);
      laMember = la;
    } finally {
      await laWorld.close();
    }
  });

  let laMember: TestUser;

  it("a lapsed member: DONE skipped lapsed, nothing written", async () => {
    const lapsed = await world.member("none", "weaklapsed", "Asia/Kolkata");
    await world.arm(lapsed.id);
    const { out } = await world.recompute(lapsed.id);
    assert.equal(out, "done");
    const job = (await world.job(lapsed.id))!;
    assert.equal(job.status, "DONE");
    assert.deepEqual(job.result?.skipped, "lapsed");
    assert.deepEqual(await world.snapshots(lapsed.id), []);
  });

  it("the final failure: 3 attempts, FAILED only without a READY row; Sentry tags; PostHog weakness_recompute_failed", async () => {
    const broken = new WeaknessWorld(env, worldTag(), { baselineId: "v-missing" });
    try {
      await broken.arm(laMember.id);
      for (let attempt = 1; attempt <= 3; attempt++) {
        const out = await broken.recompute(laMember.id);
        assert.equal(out.out, "failed", `attempt ${attempt}`);
      }
      const job = (await broken.job(laMember.id))!;
      assert.equal(job.status, "FAILED");
      assert.equal(job.attempts, 3);
      // This world's clock is behind the one that wrote laMember's rows (its LA week is 2026-11-09, the newest row is
      // 2026-11-16): FIX-2 (D-P6-FIX2-11) never writes a week older than the newest row, so the NEWEST row becomes
      // FAILED and last week's history stays as it was.
      const week = weekStartOf(new Date(broken.clock.now()), "America/Los_Angeles");
      assert.equal(week, "2026-11-09");
      const rows = await broken.snapshots(laMember.id);
      const failedRow = rows[0]!;
      assert.equal(failedRow.weekStart, "2026-11-16");
      assert.equal(failedRow.status, "FAILED", "no READY row: the newest INSUFFICIENT row becomes FAILED");
      assert.equal(rows.find((r) => r.weekStart === week)!.status, "INSUFFICIENT", "the older week is untouched");
      const m = WeaknessMetricsV1.parse(failedRow.metrics);
      assert.equal(m.failure?.code, "internal");
      assert.deepEqual(m.rows, []);
      const failedReady = broken.weaknessEvents("weakness:ready", laMember.ref);
      assert.equal(failedReady.length, 1);
      assert.equal(WeaknessReadyEvent.parse(failedReady[0]!.data).status, "failed");
      const tagged = broken.telemetry.exceptions.filter((e) => e.context.job_kind === "RECOMPUTE_WEAKNESS");
      assert.equal(tagged.length, 1);
      assert.deepEqual(tagged[0]!.context, { job_kind: "RECOMPUTE_WEAKNESS", algo_version: ALGO_VERSION, trigger: "user" });
      assert.equal(broken.product.named("weakness_recompute_failed").length, 1);
      assert.deepEqual(broken.product.refused, []);
    } finally {
      await broken.close();
    }
  });

  it("the reaper's final failure of a stalled last attempt gets the same FAILED write (worker_stalled)", async () => {
    const stalled = await world.member("paying", "weakstall", "Asia/Kolkata");
    await world.arm(stalled.id);
    await env.owner.query(
      `UPDATE ${env.schema}.jobs SET status = 'RUNNING', attempts = "maxAttempts", "lockedBy" = 'gone-worker-deadbeef',
              "lockedAt" = (now() AT TIME ZONE 'UTC') - interval '10 minutes', "heartbeatAt" = (now() AT TIME ZONE 'UTC') - interval '10 minutes'
        WHERE "dedupeKey" = $1`,
      [`weakness:${stalled.id}`],
    );
    const reaped = (await world.db.query(reapStatement({ workerId: "int-weak", me: "int-weak-00000001" }))).map(toFailedJob);
    const mine = reaped.filter((j) => j.kind === "RECOMPUTE_WEAKNESS" && j.status === "FAILED");
    assert.ok(mine.length >= 1);
    await failReapedWeakness({ db: world.db, clock: world.clock, emitter: world.emitter, telemetry: world.telemetry, events: world.product }, reaped);
    const row = (await world.snapshots(stalled.id))[0]!;
    assert.equal(row.status, "FAILED");
    assert.equal(WeaknessMetricsV1.parse(row.metrics).failure?.code, "worker_stalled");
    assert.equal(world.weaknessEvents("weakness:ready", stalled.ref).length, 1);
  });

  it("production refuses a READY snapshot on the synthetic baseline: terminal, and a READY row stays as it was", async () => {
    const prod = new WeaknessWorld(env, worldTag(), { appEnv: "production", baselineId: "v0-synthetic" });
    try {
      const before = await prod.snapshots(member.id);
      await prod.arm(member.id);
      const { out } = await prod.recompute(member.id);
      assert.equal(out, "failed");
      const job = (await prod.job(member.id))!;
      assert.equal(job.status, "FAILED", "terminal on the first attempt");
      assert.match(job.lastError ?? "", /synthetic_baseline_refused/);
      assert.deepEqual(await prod.snapshots(member.id), before, "the READY rows are unchanged");
      assert.equal(prod.weaknessEvents("weakness:ready").length, 0);
      const ev = prod.product.named("weakness_recompute_failed");
      assert.equal(ev[0]?.props.code, "synthetic_baseline_refused");
    } finally {
      await prod.close();
    }
  });

  it("production on the default baseline (v1) writes READY and records the baseline", async () => {
    const prod = new WeaknessWorld(env, worldTag(), { appEnv: "production" });
    try {
      await prod.arm(member.id);
      const { out } = await prod.recompute(member.id);
      assert.equal(out, "done");
      assert.equal((await prod.job(member.id))?.status, "DONE");
      const snaps = await prod.snapshots(member.id);
      const s = snaps.find((x) => x.status === "READY");
      assert.ok(s, "a READY row");
      assert.equal(WeaknessMetricsV1.parse(s.metrics).inputs.baseline, "v1");
      assert.equal(prod.product.named("weakness_recompute_failed").length, 0);
    } finally {
      await prod.close();
    }
  });

  it("a lost response of the committed batch: recognised by its token; one row, one bump at most, the event still sent", async () => {
    const snaps0 = await world.snapshots(member.id);
    await world.arm(member.id);
    world.driver.loseAfterCommit = loseOnce((ss) => ss.some((x) => x.text.includes("INSERT INTO weakness_snapshots")));
    const ready0 = world.weaknessEvents("weakness:ready", member.ref).length;
    const { out } = await world.recompute(member.id);
    world.driver.loseAfterCommit = null;
    assert.equal(out, "done");
    assert.equal(world.driver.lost.length, 1);
    assert.equal((await world.job(member.id))?.status, "DONE");
    assert.equal((await world.snapshots(member.id)).length, snaps0.length);
    assert.equal(world.weaknessEvents("weakness:ready", member.ref).length, ready0 + 1);
  });
});
