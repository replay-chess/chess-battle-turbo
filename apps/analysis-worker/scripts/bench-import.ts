// `pnpm --filter analysis-worker bench:import` (phase-04 plan §9.7, §12.9 DoD; interface check §5: P3's benches live
// in scripts/). One INITIAL import of 2,000 Chess.com games and one of 2,000 Lichess games for a paying member, each
// a real IMPORT_SYNC job (claim → runner → handler → finish batch) on the wall clock:
//
//   - a LOCAL Postgres only (TEST_DATABASE_URL, the int-test database after `prisma migrate deploy` + the role
//     scripts; TEST_WORKER_DATABASE_URL = role replay_worker when set), never Neon: the script refuses other hosts;
//   - 200 ms injected on every database round trip (a `pg` driver wrapper: the Mumbai → us-east-1 RTT, §9.4);
//   - the in-process upstream mock (src/import/__tests__/upstream.ts) as the provider transport: Chess.com answers
//     after UPSTREAM_LATENCY_MS, the Lichess export streams at the anonymous 20 games/s (50 ms a line, real time);
//   - the worker's real provider clients and gates.
//
// Budgets (exit 1 when one is missed): Chess.com ≤ 90 s and ≤ 41 statements (claim included); Lichess ≤ 150 s;
// first chunk ≤ 15 s for both; never two requests in flight to one provider (the mock's counter and the gate's).
// Prints one JSON report (and writes it with --out <file>); the peak RSS is sampled every 250 ms.
//
//   TEST_DATABASE_URL=… [TEST_WORKER_DATABASE_URL=…] pnpm --filter analysis-worker bench:import [--out f.json]
//     [--rtt-ms 200] [--games 2000] [--only chesscom|lichess]
import { writeFileSync } from "node:fs";
import { JOB_MAX_ATTEMPTS, JOB_PRIORITY } from "@repo/contracts/internal/jobs";
import { CountingDb, pgDriver, type Driver } from "../src/db/client";
import { importSyncHandler } from "../src/jobs/import-sync";
import { runJob } from "../src/jobs/runner";
import { ImportWorld } from "../src/import/__tests__/harness";
import { CHESSCOM_BASE, LICHESS_BASE } from "../src/import/__tests__/upstream";
import { defaultImportSettings } from "../src/import/settings";
import { silentLogger } from "../src/obs/log";
import { Metrics } from "../src/obs/metrics";
import { noopTelemetry } from "../src/obs/telemetry";
import { createProviders } from "../src/providers";
import { claimJob } from "../src/queue/claim";
import { realClock } from "../src/scheduler/clock";
import { RecordingEmitter } from "../src/socket/emit";
import { insertJob, run as RUN_ID, setupInt, TEST_URL } from "../src/testing/pg";

export const BUDGET = {
  chesscomMs: 90_000,
  chesscomStatements: 41,
  lichessMs: 150_000,
  firstChunkMs: 15_000,
} as const;
/** Chess.com's answer time in the mock (a month JSON from api.chess.com is typically 100–400 ms). */
export const UPSTREAM_LATENCY_MS = 250;
/** The anonymous Lichess export rate (R-LI-05): 20 games/s. */
export const LICHESS_MS_PER_GAME = 50;

export interface BenchArgs {
  out: string | null;
  rttMs: number;
  games: number;
  only: "chesscom" | "lichess" | null;
}

export function parseArgs(argv: readonly string[]): BenchArgs {
  const args: BenchArgs = { out: null, rttMs: 200, games: 2_000, only: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => {
      const v = argv[++i];
      if (v === undefined) throw new Error(`${a} needs a value`);
      return v;
    };
    if (a === "--out") args.out = next();
    else if (a === "--rtt-ms") args.rttMs = Number(next());
    else if (a === "--games") args.games = Number(next());
    else if (a === "--only") {
      const v = next();
      if (v !== "chesscom" && v !== "lichess") throw new Error("--only takes chesscom or lichess");
      args.only = v;
    } else throw new Error(`unknown argument ${a}`);
  }
  if (!Number.isInteger(args.rttMs) || args.rttMs < 0 || args.rttMs > 2_000) throw new Error("--rtt-ms must be 0..2000");
  if (!Number.isInteger(args.games) || args.games < 100 || args.games > 10_000) throw new Error("--games must be 100..10000");
  return args;
}

/** A driver that waits `rttMs` before every round trip and remembers when the first chunk statement committed. */
export function latencyDriver(inner: Driver, rttMs: number) {
  const d = {
    firstChunkAt: null as number | null,
    async run(ss: Parameters<Driver["run"]>[0], tx: boolean) {
      if (rttMs > 0) await new Promise((r) => setTimeout(r, rttMs));
      const out = await inner.run(ss, tx);
      if (d.firstChunkAt === null && ss.some((s) => s.text.includes("jsonb_to_recordset"))) d.firstChunkAt = performance.now();
      return out;
    },
    close: () => inner.close(),
  };
  return d;
}

export interface CaseReport {
  provider: "chesscom" | "lichess";
  games: number;
  imported: number;
  status: string;
  wallMs: number;
  firstChunkMs: number | null;
  statements: number;
  roundTrips: number;
  upstreamRequests: number;
  maxConcurrentUpstream: number;
  gateMaxInFlight: number;
  pass: boolean;
  failures: string[];
}

async function benchCase(provider: "chesscom" | "lichess", args: BenchArgs, w: ImportWorld, label: string): Promise<CaseReport> {
  const env = w.env;
  const settings = defaultImportSettings({ chesscomBaseUrl: CHESSCOM_BASE, lichessBaseUrl: LICHESS_BASE, maxGames: args.games });
  const clock = realClock();
  const now = clock.now();
  // The Lichess export's games name the fixture player, so the member links that name (the ids are tagged per run).
  const username = provider === "chesscom" ? `bench_cc_${label}` : "knightowl88";
  if (provider === "chesscom") {
    // 12 months up to the current one, 10 % over the cap: the fixture pool repeats a few games the import skips
    // (chess960, unrated, a FEN that disagrees with its PGN), and the newest `games` are imported.
    w.upstream.addChessComMany(username, now, 12, Math.ceil((args.games * 1.1) / 12));
    w.upstream.latencyMs = UPSTREAM_LATENCY_MS;
  } else {
    // The pool has no unsupported games (aborted / unstarted are left out), so exactly `games` lines.
    w.upstream.addLichessMany(username, args.games, now - 3_600_000, 3_600_000);
    w.upstream.latencyMs = UPSTREAM_LATENCY_MS;
    w.upstream.lichessPace = { advance: (ms) => new Promise((r) => setTimeout(r, ms)), msPerLine: LICHESS_MS_PER_GAME };
  }
  const u = await w.member("paying", `bench${provider}`);
  // Membership relative to the real clock (the harness dates its members to the test epoch).
  await env.owner.query(
    `UPDATE users SET "subscriptionStatus" = 'active', "currentPeriodEnd" = now() + interval '30 days',
            "trialStartedAt" = now() - interval '40 days', "trialEndsAt" = now() - interval '33 days' WHERE id = $1`,
    [u.id],
  );
  const db = provider === "chesscom" ? "CHESSCOM" : "LICHESS";
  const la = await w.link(u, db, username);
  const run = await w.run(u, la, db, "INITIAL");
  await insertJob(env, {
    kind: "IMPORT_SYNC",
    priority: JOB_PRIORITY.IMPORT_SYNC_INITIAL,
    payload: { v: 1, linkedAccountId: la, runId: run.id, trigger: "INITIAL" },
    dedupeKey: `import:${la}`,
    maxAttempts: JOB_MAX_ATTEMPTS.IMPORT_SYNC,
  });

  const driver = latencyDriver(pgDriver(env.workerUrl), args.rttMs);
  const cdb = new CountingDb(driver);
  const providers = createProviders({ settings, clock, fetch: w.upstream.fetch });
  const metrics = new Metrics({ workerId: "bench", bootId: "00000001", version: "0", profile: "sf18-v1" }, now);
  const me = "bench-worker-0000aai1";
  const t0 = performance.now();
  const job = await claimJob(cdb, me, ["IMPORT_SYNC"], 1);
  if (!job) throw new Error("the bench job is not due");
  const result = await runJob(job, {
    db: cdb,
    clock,
    log: silentLogger,
    metrics,
    telemetry: noopTelemetry,
    emitter: new RecordingEmitter(),
    me,
    appEnv: "test",
    handlers: { IMPORT_SYNC: importSyncHandler({ providers, settings }) },
    engine: null,
    evalCache: null,
    evalCacheMaxBytes: 0,
    lag: null,
    stopSignal: new AbortController().signal,
    isWatched: () => false,
    takeFault: () => null,
  });
  const wallMs = Math.round(performance.now() - t0);
  await cdb.close();
  const { rows } = await env.owner.query<{ imported: number; status: string }>(
    `SELECT imported, status::text AS status FROM import_runs WHERE id = $1`,
    [run.id],
  );
  const imported = Number(rows[0]?.imported ?? 0);
  const status = rows[0]?.status ?? "missing";
  const firstChunkMs = driver.firstChunkAt === null ? null : Math.round(driver.firstChunkAt - t0);
  const gate = providers.gates.of(provider).stats;
  const failures: string[] = [];
  if (result !== "done" || status !== "DONE") failures.push(`run ended ${result}/${status}`);
  if (imported !== args.games) failures.push(`imported ${imported} of ${args.games}`);
  const budgetMs = provider === "chesscom" ? BUDGET.chesscomMs : BUDGET.lichessMs;
  if (wallMs > budgetMs) failures.push(`${wallMs} ms > ${budgetMs} ms`);
  if (firstChunkMs === null || firstChunkMs > BUDGET.firstChunkMs) failures.push(`first chunk ${firstChunkMs} ms > ${BUDGET.firstChunkMs} ms`);
  if (provider === "chesscom" && cdb.counters.statements > BUDGET.chesscomStatements) {
    failures.push(`${cdb.counters.statements} statements > ${BUDGET.chesscomStatements}`);
  }
  if (w.upstream.maxActive[provider] > 1 || gate.maxInFlight > 1) failures.push("two requests in flight to one provider");
  w.upstream.latencyMs = 0;
  w.upstream.lichessPace = null;
  return {
    provider,
    games: args.games,
    imported,
    status,
    wallMs,
    firstChunkMs,
    statements: cdb.counters.statements,
    roundTrips: cdb.counters.roundTrips,
    upstreamRequests: w.upstream.to(provider).length,
    maxConcurrentUpstream: w.upstream.maxActive[provider],
    gateMaxInFlight: gate.maxInFlight,
    pass: failures.length === 0,
    failures,
  };
}

export async function main(argv: readonly string[] = process.argv.slice(2)): Promise<number> {
  const args = parseArgs(argv);
  if (!TEST_URL) {
    process.stderr.write("bench:import needs TEST_DATABASE_URL (a local Postgres after migrate deploy and the role scripts)\n");
    return 2;
  }
  const env = await setupInt("benchimport");
  const tag = RUN_ID.replace(/[^0-9]/g, "").slice(-8) || "1";
  const w = new ImportWorld(env, tag);
  let peakRss = process.memoryUsage().rss;
  const sampler = setInterval(() => {
    peakRss = Math.max(peakRss, process.memoryUsage().rss);
  }, 250);
  const cases: CaseReport[] = [];
  try {
    const label = tag.slice(-6);
    if (args.only !== "lichess") cases.push(await benchCase("chesscom", args, w, label));
    if (args.only !== "chesscom") cases.push(await benchCase("lichess", args, w, label));
  } finally {
    clearInterval(sampler);
    await w.close();
    await env.close();
  }
  const report = {
    v: 1,
    bench: "import",
    at: new Date().toISOString(),
    rttMs: args.rttMs,
    upstreamLatencyMs: UPSTREAM_LATENCY_MS,
    lichessMsPerGame: LICHESS_MS_PER_GAME,
    budget: BUDGET,
    peakRssMb: Math.round(peakRss / 1024 / 1024),
    cases,
    pass: cases.every((c) => c.pass),
  };
  const text = JSON.stringify(report, null, 2);
  process.stdout.write(`${text}\n`);
  if (args.out) writeFileSync(args.out, `${text}\n`);
  return report.pass ? 0 : 1;
}

if (process.argv[1] && /bench-import\.(ts|cjs|js)$/.test(process.argv[1])) {
  main().then(
    (code) => process.exit(code),
    (error: unknown) => {
      process.stderr.write(`bench:import failed: ${error instanceof Error ? error.message : String(error)}\n`);
      process.exit(1);
    },
  );
}
