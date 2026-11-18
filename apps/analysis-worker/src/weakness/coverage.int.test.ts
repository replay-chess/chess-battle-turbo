// J4 coverage and the progress emitter against Postgres (phase-06 plan §7.4.3, §7.4.4, §12.3), on members built by
// the real pipelines (testing/weakness-world.ts):
//   - a trialist imports 212 Lichess games (copies of the CC0 fixture lines: real moves, %clk, %eval, re-dated over the
//     last weeks): P4 queues its eager 20; coverage keeps the trialist at ≤ 20 (target 20, eager cap 20) and only
//     raises, never lowers; after the trial converts to paid, coverage raises the target to 100 inside P4's 200-game
//     budget: the picks are the newest analysable in-scope games, the ones needed for the first 20 at IMPORT_NEWEST,
//     the rest at WEAKNESS, `fairSeq` = rank, games NONE → QUEUED; the member's eager count never exceeds 200;
//   - a paying member with the P4 defaults (eager 50 + backlog to 200): coverage raises the backlog jobs it needs and
//     pulls their runAt to now, never touches the rest;
//   - the progress emitter, as the real ANALYZE_GAME jobs of a member without a READY profile finish: frames throttled
//     (no two inside 10 s unless pct moved ≥ 5), `first_build` armed at every new count from 5 (FIX-1), the INSUFFICIENT
//     snapshot then counting the same games as the meter; nothing once READY;
//   - (FIX-1) the recompute's inputs (Q-W5) drop imports against BOT-titled accounts BEFORE the 300 limit: a member
//     with 420 imports whose 5 newest opponents are Lichess BOT accounts gets the newest 300 human games, the set
//     coverage counts.
// Skipped without TEST_DATABASE_URL.
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { JOB_PRIORITY } from "@repo/contracts/internal/jobs";
import { enqueueAnalysisSql } from "@repo/db/jobs";
import { fromPrisma } from "../db/client";
import { WeaknessProgressEvent } from "@repo/contracts/socket/user";
import { IMPORT_T0 } from "../import/__tests__/harness";
import { setupInt, skipInt, type IntEnv, type TestUser } from "../testing/pg";
import { DAY_MS, WeaknessWorld, worldTag } from "../testing/weakness-world";
import { isWeaknessTrialing, loadWeaknessContext, scopeOf } from "./context";
import { ensureWeaknessCoverage } from "./coverage";
import { loadWeaknessInputs } from "./load";

const HOUR = 3_600_000;

describe("J4 coverage and the progress emitter on imported games (Postgres)", { skip: skipInt }, () => {
  let env: IntEnv;
  /** One world per member: the Lichess fixture lines all name knightowl88 as the member, so each import needs its own
   * upstream (its own tag: the copies get their own game ids). */
  let world: WeaknessWorld;
  const worlds: WeaknessWorld[] = [];
  const newWorld = () => {
    world = new WeaknessWorld(env, worldTag());
    worlds.push(world);
    return world;
  };

  before(async () => {
    env = await setupInt("wkcover");
  });
  after(async () => {
    for (const w of worlds) await w.close();
    await env?.close();
  });

  /** The member's in-scope sides, newest first, with their game's analysis job (if any). */
  async function scopeRows(userId: string) {
    const c = (await loadWeaknessContext(world.db, userId))!;
    const { scope, since } = scopeOf(c, new Date(world.clock.now()));
    return world.q<{ gameId: string; accuracy: number | null; analysisStatus: string; plyCount: number; priority: number | null; fairSeq: number | null; status: string | null; runAtMs: number | null; nowMs: number }>(
      `SELECT gp."gameId"::text AS "gameId", gp.accuracy, g."analysisStatus"::text AS "analysisStatus", g."plyCount",
              j.priority, j."fairSeq", j.status::text AS status, (extract(epoch FROM j."runAt") * 1000)::float8 AS "runAtMs",
              (extract(epoch FROM (now() AT TIME ZONE 'UTC')) * 1000)::float8 AS "nowMs"
         FROM game_players gp JOIN games g ON g.id = gp."gameId"
         LEFT JOIN ${env.schema}.jobs j ON j."dedupeKey" = 'analyze:' || gp."gameId"::text
        WHERE gp."userId" = $1 AND gp."endedAt" >= ($2::timestamptz AT TIME ZONE 'UTC') AND gp."timeClass"::text = ANY($3::text[])
          AND gp.mode NOT IN ('BOT', 'LEGEND_BOT') AND gp.result IS DISTINCT FROM 'ABORTED'
          AND NOT (gp.source <> 'REPLAY' AND (CASE gp.color WHEN 'w' THEN g."blackTitle" ELSE g."whiteTitle" END) IS NOT DISTINCT FROM 'BOT')
        ORDER BY gp."endedAt" DESC, gp."gameId" DESC`,
      [userId, since.toISOString(), scope.timeClasses],
    );
  }

  async function memberJobs(userId: string) {
    return world.q<{ n: number }>(`SELECT count(*)::int AS n FROM ${env.schema}.jobs WHERE kind = 'ANALYZE_GAME' AND "userId" = $1`, [userId]);
  }

  async function cover(userId: string) {
    const c = (await loadWeaknessContext(world.db, userId))!;
    const now = new Date(world.clock.now());
    const { scope, since } = scopeOf(c, now);
    return ensureWeaknessCoverage(world.db, {
      userId,
      scope,
      since,
      trialing: isWeaknessTrialing(c, now.getTime()),
      caps: { member: world.settings.analyseCap, trial: world.settings.analyseCapTrial },
      eager: { cap: world.imp.settings.cap, eagerTrial: world.imp.settings.eagerTrial },
    });
  }

  let trialist: TestUser;

  it("a trialist with 212 imported games stays at ≤ 20; existing jobs are raised, never lowered", async () => {
    newWorld();
    trialist = await world.member("trial", "weaktrial", "Asia/Kolkata");
    world.imp.upstream.addLichessMany("knightowl88", 212, IMPORT_T0 - 2 * HOUR, 9 * HOUR);
    await world.importAccount(trialist, "LICHESS", "knightowl88");
    const p4 = await scopeRows(trialist.id);
    assert.ok(p4.length >= 150, `in scope: ${p4.length}`);
    assert.equal((await memberJobs(trialist.id))[0]!.n, world.imp.settings.eagerTrial, "P4 queued its eager 20");
    const before = new Map(p4.map((r) => [r.gameId, r.priority]));
    const out = await cover(trialist.id);
    assert.equal(out.created, 0, "the trial budget is used up by P4's eager 20");
    assert.ok(out.picked <= 20);
    const after1 = await scopeRows(trialist.id);
    for (const r of after1) {
      const was = before.get(r.gameId);
      if (was !== null && was !== undefined) assert.ok((r.priority ?? 0) >= was, "never lowered");
    }
    assert.ok((await memberJobs(trialist.id))[0]!.n <= 20);
  });

  it("after the trial converts to paid: target 100 inside P4's budget, first 20 at IMPORT_NEWEST, fairSeq = rank", async () => {
    await env.owner.query(`UPDATE users SET "trialEndsAt" = $2 WHERE id = $1`, [trialist.id, new Date(IMPORT_T0 - DAY_MS)]);
    const before = await scopeRows(trialist.id);
    const out = await cover(trialist.id);
    const rows = await scopeRows(trialist.id);
    const unanalysed = rows.filter((r) => r.accuracy === null && r.plyCount >= 8 && ["NONE", "QUEUED"].includes(before.find((b) => b.gameId === r.gameId)!.analysisStatus));
    const picks = unanalysed.slice(0, 100);
    assert.equal(out.picked, picks.length);
    assert.ok(out.created > 50, `new jobs: ${out.created}`);
    picks.forEach((r, i) => {
      const rank = i + 1;
      const was = before.find((b) => b.gameId === r.gameId)!;
      assert.equal(r.status, "QUEUED", `pick ${rank}`);
      assert.equal(r.analysisStatus, "QUEUED");
      const floor = rank <= 20 ? JOB_PRIORITY.IMPORT_NEWEST : JOB_PRIORITY.WEAKNESS;
      assert.equal(r.priority, Math.max(floor, was.priority ?? 0), `pick ${rank}: ${r.priority}`);
      if (was.priority === null) assert.equal(r.fairSeq, rank, "a new job's fairSeq is its rank");
      assert.ok((r.runAtMs ?? Infinity) <= r.nowMs + 1_000, "due now");
    });
    for (const r of rows.filter((x) => !picks.some((p) => p.gameId === x.gameId))) {
      const was = before.find((b) => b.gameId === r.gameId)!;
      assert.equal(r.priority, was.priority, "games past the picks keep what they had");
    }
    assert.ok((await memberJobs(trialist.id))[0]!.n <= world.imp.settings.cap, "never past P4's 200");
    const again = await cover(trialist.id);
    assert.equal(again.created, 0, "idempotent: a second run queues nothing new");
  });

  it("a paying member with P4's eager 50 + backlog: the needed backlog jobs are raised and due now, the rest untouched", async () => {
    newWorld();
    const paying = await world.member("paying", "weakpay", "Europe/Berlin");
    world.imp.upstream.addLichessMany("knightowl88", 212, IMPORT_T0 - 3 * HOUR, 9 * HOUR);
    await world.importAccount(paying, "LICHESS", "knightowl88");
    const before = await scopeRows(paying.id);
    const out = await cover(paying.id);
    assert.equal(out.created, 0, "P4's budget (200) is used: P6 queues nothing past it");
    const rows = await scopeRows(paying.id);
    const picks = rows.filter((r) => r.accuracy === null && r.plyCount >= 8).slice(0, 100);
    picks.forEach((r, i) => {
      const was = before.find((b) => b.gameId === r.gameId)!;
      if (was.priority === null) return;
      const floor = i < 20 ? JOB_PRIORITY.IMPORT_NEWEST : JOB_PRIORITY.WEAKNESS;
      assert.equal(r.priority, Math.max(floor, was.priority));
      assert.ok((r.runAtMs ?? Infinity) <= r.nowMs + 1_000, `pick ${i + 1} is due now`);
    });
    const rest = rows.filter((r) => !picks.some((p) => p.gameId === r.gameId) && r.priority !== null);
    assert.ok(rest.length > 0);
    for (const r of rest) assert.equal(r.priority, before.find((b) => b.gameId === r.gameId)!.priority);
    assert.ok((await memberJobs(paying.id))[0]!.n <= 200);
  });

  it("progress: frames throttled per member, first_build at every new count from 5 (5, 6 … 20); nothing once READY", async () => {
    newWorld();
    const m = await world.member("paying", "weakprog", "Asia/Kolkata");
    world.imp.upstream.addLichessMany("knightowl88", 30, IMPORT_T0 - 4 * HOUR, 5 * HOUR);
    await world.importAccount(m, "LICHESS", "knightowl88");
    await world.due(["ANALYZE_GAME"], m.id);
    const inScopeAnalysed = async () => (await scopeRows(m.id)).filter((r) => r.accuracy !== null).length;
    const firstBuilds: number[] = [];
    const sent: { at: number; pct: number; analysed: number }[] = [];
    let runs = 0;
    for (let i = 0; i < 40; i++) {
      const job = await world.claimAnalysisOf(m.id);
      if (!job) break;
      const frames0 = world.weaknessEvents("weakness:progress", m.ref).length;
      assert.equal(await world.runClaimed(job), "done");
      runs++;
      const frames = world.weaknessEvents("weakness:progress", m.ref);
      if (frames.length > frames0) {
        const e = WeaknessProgressEvent.parse(frames.at(-1)!.data);
        sent.push({ at: world.clock.now(), pct: e.pct, analysed: e.analysed });
      }
      const wk = await world.job(m.id);
      if (wk && wk.payload.trigger === "first_build" && wk.status === "QUEUED") {
        const live = await inScopeAnalysed();
        firstBuilds.push(live);
        // The I/O lane runs it: an INSUFFICIENT build below 20, the first READY one at 20.
        await world.recompute(m.id);
        if (live < 20) assert.equal((await world.snapshots(m.id))[0]!.gamesAnalysed, live, "the snapshot counts the meter's games");
      }
      await world.clock.advance(2_000);
    }
    assert.ok((await inScopeAnalysed()) >= 20, `in-scope analysed: ${await inScopeAnalysed()}`);
    // regression: insufficient-two-counts (FIX-1) — every analysed count from 5 rebuilds the INSUFFICIENT snapshot, so
    // its preliminary rows ("Seen in k of N games") count the same N as the page's live meter.
    assert.deepEqual(firstBuilds.slice(0, 16), Array.from({ length: 16 }, (_, i) => 5 + i));
    assert.ok(sent.length >= 4 && sent.length < runs, `${sent.length} frames for ${runs} analyses: some were throttled`);
    for (let k = 1; k < sent.length; k++) {
      const a = sent[k - 1]!;
      const b = sent[k]!;
      assert.ok(b.at - a.at >= 10_000 || Math.abs(b.pct - a.pct) >= 5, `frames ${k - 1}→${k}: ${JSON.stringify([a, b])}`);
    }
    const snaps = await world.snapshots(m.id);
    assert.equal(snaps[0]!.status, "READY");
    // Once READY: the member's next analysis (a regrade of one game) sends no frame and arms no first_build.
    const framesAtReady = world.weaknessEvents("weakness:progress", m.ref).length;
    const g = (await scopeRows(m.id)).find((r) => r.accuracy !== null)!;
    const ref = (await world.q<{ ref: string }>(`SELECT "referenceId" AS ref FROM games WHERE id = $1`, [g.gameId]))[0]!.ref;
    await world.db.query(fromPrisma(enqueueAnalysisSql({ gameId: BigInt(g.gameId), gameRef: ref, priority: JOB_PRIORITY.HOUSEKEEPING, reason: "regrade" })));
    await world.due(["ANALYZE_GAME"], m.id);
    assert.equal(await world.drainAnalysesOf(m.id), 1);
    assert.equal(world.weaknessEvents("weakness:progress", m.ref).length, framesAtReady);
    assert.equal((await world.job(m.id))?.payload.trigger, "analysis", "a READY member gets the analysis trigger instead");
  });

  it("regression: bot-title-before-limit — the inputs are the newest 300 human games, BOT-titled imports dropped before the limit", async () => {
    newWorld();
    const m = await world.member("paying", "weakbot", "Asia/Kolkata");
    const acc = world.imp.upstream.addLichessMany("knightowl88", 420, IMPORT_T0 - HOUR, HOUR);
    // The 5 newest games were played against Lichess BOT accounts (the export's opponent title, as Lichess sends it).
    for (const line of acc.lines.slice(0, 5)) {
      // The copies share their base line's objects: give this game its own players before titling the opponent.
      const own = line as unknown as { players: Record<"white" | "black", { user?: { name?: string; title?: string } }> };
      own.players = structuredClone(own.players);
      const players = own.players;
      const opp = (players.white.user?.name ?? "").toLowerCase() === "knightowl88" ? players.black : players.white;
      opp.user = { ...(opp.user ?? {}), title: "BOT" };
    }
    await world.importAccount(m, "LICHESS", "knightowl88");
    const c = (await loadWeaknessContext(world.db, m.id))!;
    const { scope, since } = scopeOf(c, new Date(world.clock.now()));
    const human = await scopeRows(m.id);
    const bots = await world.q<{ n: number }>(
      `SELECT count(*)::int AS n FROM game_players gp JOIN games g ON g.id = gp."gameId"
        WHERE gp."userId" = $1 AND (CASE gp.color WHEN 'w' THEN g."blackTitle" ELSE g."whiteTitle" END) = 'BOT'`,
      [m.id],
    );
    // The fixture account also met a few BOT accounts in its own history (copied with the lines).
    assert.ok(bots[0]!.n >= 5, `the import stored the BOT titles (${bots[0]!.n})`);
    assert.ok(human.length > 300, `human in-scope games: ${human.length}`);
    const inputs = await loadWeaknessInputs(world.db, m.id, since, scope.timeClasses);
    assert.equal(inputs.length, 300, "300 human games, not 295");
    assert.ok(inputs.every((g) => g.oppTitle !== "BOT"));
    assert.deepEqual(inputs.map((g) => g.gameId), human.slice(0, 300).map((r) => r.gameId), "the same newest 300 as coverage counts");
  });
});
