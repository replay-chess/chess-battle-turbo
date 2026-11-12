// The e2e analysis worker (phase-03 plan §12.3 "CI runs the worker from source with ENGINE=fake; on dev, the real
// engine"; WP-C hand-back §7). Started by playwright.config.ts as a webServer on :3003, from source, with an explicit
// environment (the worker has no dotenv, so apps/analysis-worker/.env* is never read by accident):
//
//   local Postgres (CI, Docker)  APP_ENV=test, ENGINE=fake (E2E_WORKER_ENGINE=stockfish + ENGINE_PATH for the real
//                                engine), WORKER_DATABASE_URL = E2E_WORKER_DATABASE_URL (role replay_worker) or the run's
//                                DATABASE_URL. Kick faults (`fault` in the signed kick body) are honoured.
//   the Neon dev branch          APP_ENV=dev, the native Stockfish of apps/analysis-worker/.env.local-dev (ENGINE_PATH),
//                                role replay_worker from that file. Kick faults are ignored there (APP_ENV=test only);
//                                E2E_WORKER_FAULT passes one WORKER_FAULT env hook through.
//
// Keys: one INTERNAL_API_SECRET ring per run holds `web`, `ws`, `wk` and `webwk`. Each process signs with its own
// kid, so the ring is reordered per process (`ringSignedBy`): the web signs with `web` (the ring as given; worker calls
// with `webwk`), the socket with `ws` (fixtures/socket-server.ts), the worker with `wk`. The worker gets only the keys
// it may hold (`workerRing`: wk, ws, webwk, opswk; never the web's or ops' socket keys, FIX-1). Values are never logged.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseEnv } from "dotenv";

const WEB_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const WK_DIR = path.resolve(WEB_DIR, "../analysis-worker");

/** E2E_PORT_OFFSET (fixtures/socket-server.ts) moves the worker with the other local servers (3003, :3002, sink 4011). */
const PORT_OFFSET = Number(process.env.E2E_PORT_OFFSET ?? 0) || 0;
export const WORKER_PORT = 3003 + PORT_OFFSET;
export const WORKER_URL = `http://127.0.0.1:${WORKER_PORT}`;
/** From source, no watch (`tsx src/main.ts`), as CI runs it. */
export const WORKER_SERVER_COMMAND = "pnpm --filter analysis-worker exec tsx src/main.ts";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);
/** Branch `dev` of Neon project withered-cake-82837167. */
const DEV_HOST = /^ep-fancy-dust-b8b3dp81(-pooler)?\.c-14\.us-east-1\.aws\.neon\.tech$/;

export class WorkerFixtureError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorkerFixtureError";
  }
}

type Env = Readonly<Record<string, string | undefined>>;

function hostOf(url: string | undefined): string {
  try {
    return url ? new URL(url).hostname : "";
  } catch {
    return "";
  }
}

/** True when the run's database is a local Postgres (CI, Docker): the worker is a test worker there. */
export function e2eDatabaseIsLocal(env: Env = process.env): boolean {
  return LOCAL_HOSTS.has(hostOf(env.DIRECT_URL || env.DATABASE_URL));
}

/** Kick-body faults (`hold_queue`, `pause_at`, `fail_at_ply`, …) need an APP_ENV=test worker, i.e. a local database. */
export function workerFaultsHonoured(env: Env = process.env): boolean {
  return e2eDatabaseIsLocal(env);
}

/**
 * The ring with `kid` as its signing key (its first entry): "web:a,ws:b,wk:c" signed by `wk` → "wk:c,web:a,ws:b".
 * A ring without `kid` is returned unchanged; a bare legacy value (no ":") too. Pure; never logs key material.
 */
export function ringSignedBy(raw: string | undefined, kid: string): string {
  const value = raw?.trim() ?? "";
  if (!value.includes(":")) return value;
  const entries = value.split(",").map((e) => e.trim()).filter(Boolean);
  const own = entries.filter((e) => e.slice(0, e.indexOf(":")) === kid);
  if (own.length === 0) return value;
  return [...own, ...entries.filter((e) => e.slice(0, e.indexOf(":")) !== kid)].join(",");
}

/**
 * The worker's ring from a run ring: its own `wk` first, then only the keys of its callers (ws, webwk, opswk). The
 * worker refuses to boot with a `web` or `ops` key (CT/internal/auth.ts WORKER_FORBIDDEN_KIDS). A bare value is kept.
 */
export function workerRing(raw: string | undefined): string {
  const value = ringSignedBy(raw, "wk");
  if (!value.includes(":")) return value;
  const allowed = new Set(["wk", "ws", "webwk", "opswk"]);
  return value
    .split(",")
    .map((e) => e.trim())
    .filter((e) => allowed.has(e.slice(0, e.indexOf(":"))))
    .join(",");
}

/** The kids of a ring, in order (no key material). */
export function ringKids(raw: string | undefined): string[] {
  const value = raw?.trim() ?? "";
  if (!value) return [];
  if (!value.includes(":")) return ["web"];
  return value.split(",").map((e) => e.trim().slice(0, e.trim().indexOf(":")));
}

function workerDevFile(): Record<string, string> {
  try {
    return parseEnv(readFileSync(path.join(WK_DIR, ".env.local-dev")));
  } catch {
    return {};
  }
}

/**
 * The full environment of the e2e worker. `strict` refuses a ring without `wk` (the worker would refuse to boot);
 * the config-time call (also evaluated by `--list` in jobs with no secrets) only warns.
 */
export function workerServerEnv(opts: { strict?: boolean; sinkPort?: number; env?: Env } = {}): Record<string, string> {
  const env = opts.env ?? process.env;
  const ring = workerRing(env.INTERNAL_API_SECRET);
  if (!ringKids(ring).includes("wk") || !ringKids(ring).includes("webwk")) {
    const msg =
      "INTERNAL_API_SECRET needs `wk` and `webwk` keys: the e2e worker signs its emits with wk, the web kicks it with webwk (add web, ws, wk and webwk keys)";
    if (opts.strict) throw new WorkerFixtureError(msg);
    console.warn(`[analysis-worker] ${msg}`);
  }
  const local = e2eDatabaseIsLocal(env);
  const devFile = local ? {} : workerDevFile();
  const databaseUrl = local
    ? env.E2E_WORKER_DATABASE_URL || env.DATABASE_URL || ""
    : env.E2E_WORKER_DATABASE_URL || devFile.WORKER_DATABASE_URL || devFile.DATABASE_URL || "";
  const dbHost = hostOf(databaseUrl);
  if (databaseUrl && !LOCAL_HOSTS.has(dbHost) && !DEV_HOST.test(dbHost)) {
    throw new WorkerFixtureError(`refusing to run the e2e worker against ${dbHost}: only a local Postgres or the Neon dev branch`);
  }
  const engine = local ? (env.E2E_WORKER_ENGINE ?? "fake") : "stockfish";
  const out: Record<string, string> = {
    APP_ENV: local ? "test" : "dev",
    PORT: String(WORKER_PORT),
    WORKER_DATABASE_URL: databaseUrl,
    INTERNAL_API_SECRET: ring,
    WS_INTERNAL_URL: `http://127.0.0.1:${3002 + PORT_OFFSET}`,
    WORKER_ID: `e2e-${local ? "test" : "dev"}`,
    ENGINE: engine,
    EVAL_CACHE: local ? "off" : "on",
    EVAL_CACHE_PATH: env.E2E_WORKER_EVAL_CACHE_PATH || devFile.EVAL_CACHE_PATH || path.join(WEB_DIR, "test-results", "worker-evals.sqlite"),
    SENTRY_DSN: "",
    POSTHOG_HOST: `http://127.0.0.1:${opts.sinkPort ?? Number(env.POSTHOG_SINK_PORT ?? 4011 + PORT_OFFSET)}`,
    POSTHOG_PROJECT_KEY: "phc_e2e_local_sink",
    LOG_LEVEL: env.E2E_WORKER_LOG_LEVEL ?? "warn",
  };
  const enginePath = env.ENGINE_PATH || devFile.ENGINE_PATH;
  if (engine === "stockfish" && enginePath) out.ENGINE_PATH = enginePath;
  if (env.E2E_WORKER_FAULT) out.WORKER_FAULT = env.E2E_WORKER_FAULT;
  return out;
}
