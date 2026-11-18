// `pnpm --filter analysis-worker bench:weakness` (phase-06 plan §7.4.2 "Budget", §9.4, §13 WP4 acceptance: ≤ 2 s p95
// without a heal, OPT-50). A member with a full scope (300 in-scope game sides, the CC0 Lichess fixture lines re-dated
// over the last months) is built by the real pipelines on a local Postgres (TEST_DATABASE_URL, private schema; the
// import through the in-process upstream mock, the analyses with the fake engine), then RECOMPUTE_WEAKNESS runs
// BENCH_RUNS times (default 30) through the real runner and handler. Per run: the wall time on this machine and the
// database round trips; the projected time adds BENCH_RTT_MS (default 200: Mumbai → us-east-1, data-model D22) per
// round trip. Exit 1 when the projected p95 is ≥ 2000 ms.
//
// FIX-1 (§9.4 "heal ≤ 4 s"): the heal of every row (a member analysed before P6) is GATED. It runs as the product runs
// it, in runs that heal at most WEAKNESS_HEAL_MAX_ROWS rows and stop computing after HEAL_BUDGET_MS of the machine's
// own time, then re-queue themselves. The budget is time, so a slower CPU heals fewer rows per run rather than taking
// longer; the rest of a run (reads, the compute of the profile) scales with the CPU. Projected per run = wall +
// (BENCH_CPU_FACTOR − 1) × the no-heal p95 wall (default 2.5: the 1-OCPU Ampere A1 against a laptop core) + round trips
// × BENCH_RTT_MS. Exit 1 when any heal run's projection is ≥ 4000 ms.
//
//   TEST_DATABASE_URL=postgresql://…@127.0.0.1:…/replay [TEST_WORKER_DATABASE_URL=…] pnpm --filter analysis-worker bench:weakness
import { IMPORT_T0 } from "../src/import/__tests__/harness";
import { setupInt, TEST_URL } from "../src/testing/pg";
import { WeaknessWorld, worldTag } from "../src/testing/weakness-world";

/** The bench's own knobs (not product configuration: read from the process, never from turbo's env list). */
const knobs: Readonly<Record<string, string | undefined>> = process.env;
const RUNS = Number(knobs.BENCH_RUNS ?? 30);
const RTT_MS = Number(knobs.BENCH_RTT_MS ?? 200);
const GAMES = Number(knobs.BENCH_GAMES ?? 360);
const BUDGET_MS = 2_000;
const HEAL_BUDGET_MS = 4_000;
const CPU_FACTOR = Number(knobs.BENCH_CPU_FACTOR ?? 2.5);

function pct(xs: readonly number[], p: number): number {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)] ?? 0;
}

async function main(): Promise<number> {
  if (!TEST_URL) {
    console.error("bench:weakness needs TEST_DATABASE_URL (a local Postgres after migrate deploy)");
    return 2;
  }
  const env = await setupInt("wkbench");
  const world = new WeaknessWorld(env, worldTag());
  try {
    const member = await world.member("paying", "wkbench", "Asia/Kolkata");
    world.imp.upstream.addLichessMany("knightowl88", GAMES, IMPORT_T0 - 3_600_000, 4 * 3_600_000);
    const t0 = Date.now();
    await world.importAccount(member, "LICHESS", "knightowl88");
    await world.due(["ANALYZE_GAME"], member.id);
    // The member's whole window, as a paying member's backlog eventually analyses it.
    let analysed = 0;
    for (;;) {
      const n = await world.drainAnalysesOf(member.id);
      analysed += n;
      await world.arm(member.id);
      await world.recompute(member.id);
      await world.due(["ANALYZE_GAME"], member.id);
      if (n === 0) break;
    }
    const snap = (await world.snapshots(member.id))[0]!;
    console.log(
      `member built in ${Math.round((Date.now() - t0) / 1000)} s: ${analysed} analyses, snapshot ${snap.status}, ` +
        `${snap.gamesAnalysed} analysed of ${snap.gamesInScope} in scope`,
    );

    const wall: number[] = [];
    const trips: number[] = [];
    for (let i = 0; i < RUNS; i++) {
      await world.arm(member.id);
      const r0 = world.db.counters.roundTrips;
      const s0 = performance.now();
      const { out } = await world.recompute(member.id);
      wall.push(performance.now() - s0);
      trips.push(world.db.counters.roundTrips - r0);
      if (out !== "done") throw new Error(`run ${i} ended ${out}`);
    }
    const projected = wall.map((w, i) => w + trips[i]! * RTT_MS);
    console.log(
      `RECOMPUTE_WEAKNESS × ${RUNS} (no heal): wall p50 ${pct(wall, 50).toFixed(0)} ms, p95 ${pct(wall, 95).toFixed(0)} ms; ` +
        `round trips per run ${Math.min(...trips)}–${Math.max(...trips)} (claim + reads + one batch)`,
    );
    console.log(`projected with ${RTT_MS} ms per round trip: p50 ${pct(projected, 50).toFixed(0)} ms, p95 ${pct(projected, 95).toFixed(0)} ms (budget < ${BUDGET_MS} ms)`);

    // One heal of every analysed row (a member analysed before P6).
    await env.owner.query(
      `UPDATE game_players SET stats = '{}', "errorThemes" = '{}', "errorLog" = '{}', "errorThemeN" = '{}', "weaknessInputsV" = 0
        WHERE "userId" = $1 AND accuracy IS NOT NULL`,
      [member.id],
    );
    const healRuns: { wall: number; trips: number; healed: number }[] = [];
    await world.arm(member.id);
    for (let guard = 0; guard < 50; guard++) {
      const h0 = performance.now();
      const r0 = world.db.counters.roundTrips;
      const { out } = await world.recompute(member.id);
      if (out !== "done") throw new Error(`heal run ${guard} ended ${out}`);
      const result = (await world.job(member.id))?.result ?? {};
      healRuns.push({ wall: performance.now() - h0, trips: world.db.counters.roundTrips - r0, healed: Number(result.healed ?? 0) });
      if (result.healRemaining === undefined) break;
    }
    const nonHeal = pct(wall, 95);
    const healProjected = healRuns.map((r) => r.wall + (CPU_FACTOR - 1) * nonHeal + r.trips * RTT_MS);
    const healWorst = Math.max(...healProjected);
    console.log(
      `heal of ${healRuns.reduce((n, r) => n + r.healed, 0)} rows in ${healRuns.length} runs of ≤ ${world.settings.healMaxRows}: ` +
        `wall per run max ${Math.max(...healRuns.map((r) => r.wall)).toFixed(0)} ms (${healRuns.map((r) => r.wall.toFixed(0)).join(", ")}); ` +
        `rows per run ${healRuns.map((r) => r.healed).join(", ")}; projected (CPU × ${CPU_FACTOR} on the non-heal part, ${RTT_MS} ms per round trip) ` +
        `max ${healWorst.toFixed(0)} ms (budget < ${HEAL_BUDGET_MS} ms per run)`,
    );
    if (healWorst >= HEAL_BUDGET_MS) {
      console.error(`FAIL: a heal run projects to ${healWorst.toFixed(0)} ms ≥ ${HEAL_BUDGET_MS} ms`);
      return 1;
    }

    const p95 = pct(projected, 95);
    if (p95 >= BUDGET_MS) {
      console.error(`FAIL: projected p95 ${p95.toFixed(0)} ms ≥ ${BUDGET_MS} ms`);
      return 1;
    }
    console.log(`OK: projected p95 ${p95.toFixed(0)} ms < ${BUDGET_MS} ms`);
    return 0;
  } finally {
    await world.close();
    await env.close();
  }
}

main().then(
  (code) => process.exit(code),
  (error: unknown) => {
    console.error(error);
    process.exit(1);
  },
);
