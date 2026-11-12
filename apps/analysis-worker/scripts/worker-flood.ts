// The worker throughput and co-location gates (phase-03 plan §9.1 "Worker throughput ≥ 60 games/hour", "Socket
// co-location: loop lag p99 < 50 ms while the worker runs flat out"; §12.7; FIX-1). It floods the RUNNING worker with
// the 60 bench games (DB/seed/bench.ts, average 60 plies) at BACKLOG and measures it from the outside:
//
//   1. reset the bench games (their reviews, analyses and jobs; analysisStatus NONE) and enqueue all of them at
//      BACKLOG in one batch, then one signed kick (`reason: backfill`), as the backfill does;
//   2. every POLL_MS: how many are DONE / FAILED (one statement), and, with --colocation, the socket's
//      `GET /internal/load` (signed `wk`, the same probe the lag pause reads) for its loop-lag p99;
//   3. the worker's `/internal/metrics` before and after (signed `opswk`, else `webwk`): the cache hits and misses,
//      the emits per event, the engine's nodes per second.
//
// Gates (exit 1 when one fails): ≥ 60 games/hour; no failed game; 0 per-game emits (`analysis:progress`, `writing`,
// `done`: a BACKLOG job without a watcher only joins the per-user `analysis:batch`, P3-D26); with --colocation, the
// socket's loop-lag p99 < 50 ms over the run (the P3-D8 fallback to `cpus: 0.5` otherwise). The JSON report goes to
// --out (default perf/results/p03-worker-throughput-<sha>.json beside the repo, else the working directory).
//
// Stage B, on the dev VM (the worker container has the worker's env: WORKER_DATABASE_URL = replay_worker on the dev
// branch, INTERNAL_API_SECRET with wk + opswk, WS_INTERNAL_URL):
//   pnpm --filter @repo/db exec tsx seed/bench.ts --apply                          (once, from a machine with DIRECT_URL)
//   docker compose exec -T analysis-worker node dist/worker-flood.cjs --out /tmp/p03-worker-throughput.json
//   co-location: start that with --colocation, then run k6 `ws-ramp` (250 → 1,000 sockets) against the dev socket
//   while it runs (perf/k6/README.md "P3 co-location"); the run lasts about an hour at the gate rate.
// Locally against the Docker stack: `pnpm --filter analysis-worker exec tsx scripts/worker-flood.ts --games 6`.
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { OPS_TO_WORKER_KID, parseKeyRing, signInternal, WEB_TO_WORKER_KID, type KeyRing } from "@repo/contracts/internal/auth";
import { JOB_PRIORITY } from "@repo/contracts/internal/jobs";
import { KICK_PATH, WorkerMetricsResponse } from "@repo/contracts/internal/kick";
import { enqueueAnalysisSql } from "@repo/db/jobs";
import { createDb, fromPrisma, stmt, type Db, type Statement } from "../src/db/client";
import { LOAD_PATH, LoadSample } from "../src/socket/load";

export const BENCH_TAG = "bench";
export const POLL_MS = 15_000;
export const LOAD_SAMPLE_MS = 5_000;
export const GATE = { gamesPerHourMin: 60, lagP99MaxMs: 50 } as const;
/** Events a BACKLOG job without a watcher must never send per game (P3-D26 banding). */
export const PER_GAME_EVENTS = ["analysis:progress", "analysis:writing", "analysis:done", "analysis:queued"] as const;
const METRICS_PATH = "/internal/metrics";

export interface FloodArgs {
  games: number;
  workerUrl: string;
  wsUrl: string | null;
  colocation: boolean;
  timeoutMin: number;
  out: string | null;
}

export function parseArgs(argv: readonly string[], env: Readonly<Record<string, string | undefined>>): FloodArgs {
  const args: FloodArgs = {
    games: 60,
    workerUrl: env.WORKER_URL ?? `http://127.0.0.1:${env.PORT ?? 3003}`,
    wsUrl: env.WS_INTERNAL_URL ?? null,
    colocation: false,
    timeoutMin: 150,
    out: null,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const value = () => {
      const v = argv[++i];
      if (v === undefined) throw new Error(`${a} needs a value`);
      return v;
    };
    if (a === "--games") args.games = Number(value());
    else if (a === "--worker-url") args.workerUrl = value();
    else if (a === "--ws-url") args.wsUrl = value();
    else if (a === "--colocation") args.colocation = true;
    else if (a === "--timeout-min") args.timeoutMin = Number(value());
    else if (a === "--out") args.out = value();
    else throw new Error(`unknown argument ${a}`);
  }
  if (!Number.isInteger(args.games) || args.games < 1 || args.games > 500) throw new Error("--games must be 1..500");
  if (!(args.timeoutMin > 0)) throw new Error("--timeout-min must be positive");
  if (args.colocation && !args.wsUrl) throw new Error("--colocation needs WS_INTERNAL_URL or --ws-url");
  return args;
}

// ── statements (the worker role's grants: games.analysisStatus, its own rows, jobs) ───────────────────────────────
export interface BenchGame {
  id: string;
  ref: string;
  plies: number;
}

export function benchGamesStatement(limit: number): Statement {
  return stmt(
    `SELECT id::text AS id, "referenceId" AS ref, "plyCount" AS plies FROM games
      WHERE "gameData"->>'p3Seed' = $1 AND status = 'COMPLETED' ORDER BY "completedAt", id LIMIT $2`,
    [BENCH_TAG, limit],
  );
}

/** Back to "never analysed": reviews, analyses and jobs gone, analysisStatus NONE (as the smoke resets its game). */
export function resetStatements(ids: readonly string[]): Statement[] {
  const keys = ids.map((id) => `analyze:${id}`);
  return [
    stmt(`DELETE FROM player_reviews WHERE "gameId" = ANY($1::bigint[])`, [ids]),
    stmt(`DELETE FROM game_analyses WHERE "gameId" = ANY($1::bigint[])`, [ids]),
    stmt(`DELETE FROM jobs WHERE "dedupeKey" = ANY($1::text[])`, [keys]),
    stmt(`UPDATE games SET "analysisStatus" = 'NONE', "updatedAt" = (now() AT TIME ZONE 'UTC') WHERE id = ANY($1::bigint[])`, [ids]),
  ];
}

export function enqueueStatements(games: readonly BenchGame[]): Statement[] {
  return games.map((g, k) =>
    fromPrisma(
      enqueueAnalysisSql({ gameId: BigInt(g.id), gameRef: g.ref, priority: JOB_PRIORITY.BACKLOG, reason: "backfill", fairSeq: k }),
    ),
  );
}

export function progressStatement(ids: readonly string[]): Statement {
  return stmt(
    `SELECT count(*) FILTER (WHERE "analysisStatus" = 'DONE')::int AS done,
            count(*) FILTER (WHERE "analysisStatus" = 'FAILED')::int AS failed,
            count(*) FILTER (WHERE "analysisStatus" = 'SKIPPED')::int AS skipped
       FROM games WHERE id = ANY($1::bigint[])`,
    [ids],
  );
}

// ── the report ─────────────────────────────────────────────────────────────────────────────────────────────────────
export interface FloodReport {
  at: string;
  games: { enqueued: number; done: number; failed: number; skipped: number; averagePlies: number };
  elapsedSec: number;
  gamesPerHour: number;
  cache: { hits: number; misses: number; hitRatio: number | null };
  engineNps: number | null;
  perGameEmits: Record<string, number>;
  batchEmits: number;
  lag: { samples: number; p99MaxMs: number | null; p99OfP99Ms: number | null } | null;
  gate: typeof GATE & { pass: boolean; failures: string[] };
}

type Metrics = WorkerMetricsResponse;

function delta(after: Record<string, number> | undefined, before: Record<string, number> | undefined, key: string): number {
  return Math.max(0, (after?.[key] ?? 0) - (before?.[key] ?? 0));
}

export function percentile(values: readonly number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)]!;
}

export function summarise(input: {
  games: readonly BenchGame[];
  done: number;
  failed: number;
  skipped: number;
  elapsedMs: number;
  before: Metrics;
  after: Metrics;
  lagP99s: readonly number[] | null;
  nowIso: string;
}): FloodReport {
  const { before, after } = input;
  const hits = Math.max(0, after.cache.hitsMemory + after.cache.hitsDisk - before.cache.hitsMemory - before.cache.hitsDisk);
  const misses = Math.max(0, after.cache.misses - before.cache.misses);
  const perGameEmits = Object.fromEntries(PER_GAME_EVENTS.map((e) => [e, delta(after.emits, before.emits, e)]));
  const hours = input.elapsedMs / 3_600_000;
  const gamesPerHour = hours > 0 ? Math.round((input.done / hours) * 10) / 10 : 0;
  const lag = input.lagP99s
    ? { samples: input.lagP99s.length, p99MaxMs: input.lagP99s.length ? Math.max(...input.lagP99s) : null, p99OfP99Ms: percentile(input.lagP99s, 99) }
    : null;
  const failures: string[] = [];
  if (input.done < input.games.length) failures.push(`${input.games.length - input.done} of ${input.games.length} games not DONE`);
  if (gamesPerHour < GATE.gamesPerHourMin) failures.push(`${gamesPerHour} games/hour < ${GATE.gamesPerHourMin}`);
  if (input.failed > 0) failures.push(`${input.failed} failed`);
  const emitted = Object.entries(perGameEmits).filter(([, n]) => n > 0);
  if (emitted.length) failures.push(`per-game emits: ${emitted.map(([e, n]) => `${e} ×${n}`).join(", ")}`);
  if (lag && (lag.p99OfP99Ms === null || lag.p99OfP99Ms >= GATE.lagP99MaxMs)) failures.push(`socket loop lag p99 ${lag.p99OfP99Ms ?? "unread"} ms ≥ ${GATE.lagP99MaxMs}`);
  return {
    at: input.nowIso,
    games: {
      enqueued: input.games.length,
      done: input.done,
      failed: input.failed,
      skipped: input.skipped,
      averagePlies: input.games.reduce((n, g) => n + g.plies, 0) / Math.max(1, input.games.length),
    },
    elapsedSec: Math.round(input.elapsedMs / 1000),
    gamesPerHour,
    cache: { hits, misses, hitRatio: hits + misses > 0 ? Math.round((hits / (hits + misses)) * 1000) / 1000 : null },
    engineNps: after.engine.nps ?? null,
    perGameEmits,
    batchEmits: delta(after.emits, before.emits, "analysis:batch"),
    lag,
    gate: { ...GATE, pass: failures.length === 0, failures },
  };
}

// ── HTTP (signed) ──────────────────────────────────────────────────────────────────────────────────────────────────
/** The kid this tool signs worker calls with: ops' worker key in the container, else the web's. */
export function workerKid(keys: KeyRing): string {
  if (keys.keys.has(OPS_TO_WORKER_KID)) return OPS_TO_WORKER_KID;
  if (keys.keys.has(WEB_TO_WORKER_KID)) return WEB_TO_WORKER_KID;
  throw new Error(`INTERNAL_API_SECRET has no ${OPS_TO_WORKER_KID} or ${WEB_TO_WORKER_KID} key`);
}

async function signedFetch(base: string, path: string, keys: KeyRing, kid: string, method: "GET" | "POST", body = ""): Promise<Response> {
  const headers: Record<string, string> = { ...signInternal({ keys, kid, method, path, body, nowMs: Date.now() }) };
  if (body) headers["content-type"] = "application/json";
  return fetch(`${base.replace(/\/+$/, "")}${path}`, { method, headers, ...(body ? { body } : {}), signal: AbortSignal.timeout(5_000) });
}

async function readMetrics(args: FloodArgs, keys: KeyRing): Promise<Metrics> {
  const res = await signedFetch(args.workerUrl, METRICS_PATH, keys, workerKid(keys), "GET");
  if (!res.ok) throw new Error(`worker metrics: HTTP ${res.status}`);
  return WorkerMetricsResponse.parse(await res.json());
}

async function readLag(args: FloodArgs, keys: KeyRing): Promise<number | null> {
  try {
    const res = await signedFetch(args.wsUrl!, LOAD_PATH, keys, "wk", "GET");
    if (!res.ok) return null;
    return LoadSample.parse(await res.json()).loopLagP99Ms;
  } catch {
    return null;
  }
}

function gitSha(): string {
  try {
    return execFileSync("git", ["rev-parse", "--short", "HEAD"], { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
  } catch {
    return "nogit";
  }
}

function defaultOut(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  return resolve(here, "../../../perf/results", `p03-worker-throughput-${gitSha()}.json`);
}

export interface FloodDeps {
  db: Db;
  keys: KeyRing;
  sleep(ms: number): Promise<void>;
  now(): number;
  log(line: string): void;
  metrics(): Promise<Metrics>;
  kick(): Promise<number>;
  lag(): Promise<number | null>;
}

/** The run (exported for the integration test, which injects the worker side). */
export async function flood(args: FloodArgs, deps: FloodDeps): Promise<FloodReport> {
  const games = (await deps.db.query(benchGamesStatement(args.games))).map(
    (r): BenchGame => ({ id: String(r.id), ref: String(r.ref), plies: Number(r.plies) }),
  );
  if (games.length < args.games) {
    throw new Error(`found ${games.length} of ${args.games} bench games: run \`pnpm --filter @repo/db exec tsx seed/bench.ts --apply\` first`);
  }
  const ids = games.map((g) => g.id);
  await deps.db.batch(resetStatements(ids));
  const before = await deps.metrics();
  const started = deps.now();
  await deps.db.batch(enqueueStatements(games));
  deps.log(`enqueued ${games.length} bench games at BACKLOG; kick → HTTP ${await deps.kick()}`);

  const lagP99s: number[] = [];
  let progress = { done: 0, failed: 0, skipped: 0 };
  const deadline = started + args.timeoutMin * 60_000;
  let nextPoll = started;
  for (;;) {
    if (args.colocation) {
      const lag = await deps.lag();
      if (lag !== null) lagP99s.push(lag);
    }
    if (deps.now() >= nextPoll) {
      const [row] = await deps.db.query(progressStatement(ids));
      progress = { done: Number(row?.done ?? 0), failed: Number(row?.failed ?? 0), skipped: Number(row?.skipped ?? 0) };
      deps.log(`${Math.round((deps.now() - started) / 1000)} s: ${progress.done} done, ${progress.failed} failed of ${games.length}`);
      if (progress.done + progress.failed + progress.skipped >= games.length) break;
      nextPoll = deps.now() + POLL_MS;
    }
    if (deps.now() >= deadline) {
      deps.log(`timeout after ${args.timeoutMin} min`);
      break;
    }
    await deps.sleep(args.colocation ? LOAD_SAMPLE_MS : POLL_MS);
  }
  const elapsedMs = deps.now() - started;
  const after = await deps.metrics();
  return summarise({ games, ...progress, elapsedMs, before, after, lagP99s: args.colocation ? lagP99s : null, nowIso: new Date(deps.now()).toISOString() });
}

export async function main(argv = process.argv.slice(2), env: Readonly<Record<string, string | undefined>> = process.env): Promise<number> {
  const args = parseArgs(argv, env);
  const url = env.WORKER_DATABASE_URL;
  if (!url) throw new Error("WORKER_DATABASE_URL is required (role replay_worker; the dev branch or a local Postgres)");
  const host = new URL(url).hostname;
  const db = createDb({ url, driver: host.endsWith(".neon.tech") ? "neon" : "pg" });
  const keys = parseKeyRing(env.INTERNAL_API_SECRET, { bareKid: "wk" });
  try {
    const report = await flood(args, {
      db,
      keys,
      sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
      now: () => Date.now(),
      log: (line) => process.stderr.write(`${line}\n`),
      metrics: () => readMetrics(args, keys),
      kick: async () =>
        (await signedFetch(args.workerUrl, KICK_PATH, keys, workerKid(keys), "POST", JSON.stringify({ v: 1, reason: "backfill", kinds: ["ANALYZE_GAME"] }))).status,
      lag: () => readLag(args, keys),
    });
    const out = args.out ?? defaultOut();
    mkdirSync(dirname(out), { recursive: true });
    const json = JSON.stringify(report, null, 2);
    writeFileSync(out, `${json}\n`);
    process.stdout.write(`${json}\n`);
    process.stderr.write(`${report.gate.pass ? "PASS" : `FAIL: ${report.gate.failures.join("; ")}`} (${out})\n`);
    return report.gate.pass ? 0 : 1;
  } finally {
    await db.close();
  }
}

// By file name, not `require.main === module`: bench.cjs bundles this module too, and in one CJS bundle every module
// sees the bundle's `module`, so that check would start a flood whenever the bench runs.
const isEntry = /worker-flood\.(ts|cjs)$/.test(process.argv[1] ?? "");
if (isEntry) {
  main().then(
    (code) => process.exit(code),
    (error: unknown) => {
      process.stderr.write(`worker-flood failed: ${error instanceof Error ? error.message : String(error)}\n`);
      process.exit(1);
    },
  );
}
