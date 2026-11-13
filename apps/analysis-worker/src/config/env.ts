// Analysis worker environment (phase-03 plan §7.9, §8.12 boot guards, §11.2 rule 10, TST X12). Parsed once at boot;
// a bad value stops the process with a message that names the variable and never its value. No dotenv: the worker
// reads only the environment it is given (compose `env_file` on OCI, an explicit `set -a; source .env.local-dev`
// locally), so a stray .env with production URLs can never leak into a local run.
//
// Boot guards (the worker refuses to start, exit 1):
// - APP_ENV missing or unknown;
// - WORKER_FAULT set unless APP_ENV is dev or test (so never in production);
// - ENGINE=fake unless APP_ENV=test (so never in production or on the dev box);
// - ENGINE_PROFILE / ENGINE_THREADS / ENGINE_HASH_MB that differ from the frozen `sf18-v1` profile (determinism);
// - WORKER_DATABASE_URL missing, using the Neon owner role in dev/production/local, pointing a dev or local worker
//   anywhere but a local Postgres or the dev endpoint, a production worker at the dev endpoint, or a test worker at a
//   non-local host;
// - INTERNAL_API_SECRET without `wk` as its signing kid, without a key of a caller it accepts (ws, webwk, opswk), or
//   with a `web` or `ops` key (the socket accepts those; a worker must never hold them: CT/internal/auth.ts);
// - WS_INTERNAL_URL missing in dev/production;
// - P4: IMPORT_FAULTS_ALLOWED on with APP_ENV=production (the provider fault table is a test hook, dev/faults.ts), and
//   CHESSCOM_API_BASE / LICHESS_BASE_URL other than the real providers with APP_ENV=production (import/settings.ts).
import {
  parseKeyRing,
  restrictKeyRing,
  WORKER_ACCEPTED_KIDS,
  WORKER_FORBIDDEN_KIDS,
  type KeyRing,
} from "@repo/contracts/internal/auth";
import { AppEnv } from "@repo/contracts/http/system";
import { WORKER_PORT } from "@repo/contracts/internal/kick";
import { ENGINE_PROFILE } from "@repo/chess-analysis/version";
import { isDevHost } from "@repo/db/seed-guards";
import { hostname } from "node:os";
import { parseImportSettings, type ImportSettings } from "../import/settings";
import { FaultsAllowedError, parseFaultsAllowed } from "../dev/faults";
import { parseFault, type Fault } from "./faults";

export type AppEnvName = "dev" | "production" | "test" | "local";
export type LogLevel = "debug" | "info" | "warn" | "error";

export interface WorkerEnv {
  appEnv: AppEnvName;
  port: number;
  /** 0.0.0.0 inside the container (dev/production: the docker network), 127.0.0.1 for test and local runs. */
  host: string;
  databaseUrl: string;
  /** `neon` = @neondatabase/serverless over HTTP (P3-D11); `pg` = a plain Postgres (CI, local Docker). */
  dbDriver: "neon" | "pg";
  /** The full INTERNAL_API_SECRET ring; its signing kid is `wk` (the worker's emits and load probes). */
  internalKeys: KeyRing;
  /** The same ring restricted to the kids the worker accepts (WORKER_ACCEPTED_KIDS). */
  acceptKeys: KeyRing;
  /** The socket server's base URL for `/internal/emit` and `/internal/load`; null = no emits, no lag pause. */
  wsInternalUrl: string | null;
  /** `lockedBy` prefix; the boot id is appended at runtime. Unique per concurrently running worker. */
  workerId: string;
  engine: {
    kind: "stockfish" | "fake";
    path: string;
    threads: number;
    hashMb: number;
    profile: string;
    /** Lower the engine process priority (nice 19). A harmless extra next to the cgroup slice (P3-D8). */
    nice: boolean;
  };
  evalCache: { enabled: boolean; path: string; seedUrl: string | null; maxGb: number };
  lagPauseMs: number;
  /** The env fault hook (dev/test only). */
  fault: Fault | null;
  sentryDsn: string | null;
  posthog: { key: string; host: string } | null;
  logLevel: LogLevel;
  /** P4 imports (phase-04 §7.9): window, analysis budget, provider base URLs (production: the real ones only). */
  imports: ImportSettings;
  /** P4 (§7.7.4): IMPORT_FAULTS_ALLOWED, the provider fault table and `/internal/dev/fault` (never in production). */
  faultsAllowed: boolean;
}

export class EnvError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EnvError";
  }
}

type RawEnv = Readonly<Record<string, string | undefined>>;

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]", "postgres"]);
const OWNER_ROLES = new Set(["neondb_owner"]);
const DEFAULT_ENGINE_PATH = "/usr/local/bin/stockfish";
const DEFAULT_CACHE_PATH = "/data/evalcache/evals.sqlite";

function str(raw: RawEnv, name: string): string | null {
  const v = raw[name]?.trim();
  return v ? v : null;
}

function int(raw: RawEnv, name: string, min: number, max: number): number | undefined {
  const v = str(raw, name);
  if (v === null) return undefined;
  if (!/^\d+$/.test(v)) throw new EnvError(`${name} must be an integer`);
  const n = Number(v);
  if (n < min || n > max) throw new EnvError(`${name} must be within ${min}..${max}`);
  return n;
}

function flag(raw: RawEnv, name: string, fallback: boolean): boolean {
  const v = str(raw, name)?.toLowerCase();
  if (v === undefined || v === null) return fallback;
  if (["on", "1", "true", "yes"].includes(v)) return true;
  if (["off", "0", "false", "no"].includes(v)) return false;
  throw new EnvError(`${name} must be on or off`);
}

function httpUrl(raw: RawEnv, name: string): string | null {
  const v = str(raw, name);
  if (v === null) return null;
  let url: URL;
  try {
    url = new URL(v);
  } catch {
    throw new EnvError(`${name} is not a URL`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new EnvError(`${name} must be http(s)`);
  return v.replace(/\/+$/, "");
}

/** Checks the database URL against the environment. Never echoes the URL (it holds a password). */
function databaseTarget(appEnv: AppEnvName, url: string): { driver: "neon" | "pg" } {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new EnvError("WORKER_DATABASE_URL does not parse");
  }
  if (parsed.protocol !== "postgres:" && parsed.protocol !== "postgresql:") {
    throw new EnvError("WORKER_DATABASE_URL must be a postgres:// URL");
  }
  const host = parsed.hostname.toLowerCase();
  const role = decodeURIComponent(parsed.username);
  const local = LOCAL_HOSTS.has(host);
  // `local` (a developer's machine, the .env.example default) is held to the dev rules: a local run must never reach
  // the production branch, the old project or any other Neon host, and never as the owner role (FIX-1).
  if (appEnv !== "test" && OWNER_ROLES.has(role)) {
    throw new EnvError(`WORKER_DATABASE_URL uses the owner role ${role}: the worker runs as replay_worker`);
  }
  if ((appEnv === "dev" || appEnv === "local") && !local && !isDevHost(host)) {
    throw new EnvError(`WORKER_DATABASE_URL host ${host} is not a local Postgres or the dev endpoint (APP_ENV=${appEnv})`);
  }
  if (appEnv === "production" && isDevHost(host)) {
    throw new EnvError("WORKER_DATABASE_URL points a production worker at the dev endpoint");
  }
  if (appEnv === "test" && !local) {
    throw new EnvError(`WORKER_DATABASE_URL host ${host} is not local (APP_ENV=test)`);
  }
  return { driver: host.endsWith(".neon.tech") ? "neon" : "pg" };
}

function keyRing(raw: RawEnv): KeyRing {
  try {
    return parseKeyRing(raw.INTERNAL_API_SECRET, { bareKid: "wk" });
  } catch (error) {
    // parseKeyRing never echoes key material; keep only its message.
    throw new EnvError(`INTERNAL_API_SECRET: ${error instanceof Error ? error.message : "invalid key ring"}`);
  }
}

/** Parses and checks the environment. Throws EnvError on anything the worker must not start with. */
/**
 * WORKER_ID when none is set: `<APP_ENV>-<host>`, so two machines that both leave it unset never share an id (the
 * reaper treats rows of another boot of the same id as orphans). It was `<APP_ENV>-worker`, which a laptop worker
 * and the dev VM (WORKER_ID=dev-worker) would have shared on the same database (FIX-2). At most 30 characters.
 */
export function defaultWorkerId(appEnv: string, host: string = hostname()): string {
  const slug = host
    .toLowerCase()
    .replace(/\.local$/, "")
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `${appEnv}-${slug || "host"}`.slice(0, 30).replace(/-+$/, "");
}

export function loadEnv(raw: RawEnv = process.env): WorkerEnv {
  const appEnvParsed = AppEnv.safeParse(str(raw, "APP_ENV"));
  if (!appEnvParsed.success) throw new EnvError("APP_ENV must be one of dev, production, test, local");
  const appEnv = appEnvParsed.data;

  // ── Test hooks (TST X12) ──────────────────────────────────────────────────────────────────────────────────────
  const faultRaw = str(raw, "WORKER_FAULT");
  let fault: Fault | null = null;
  if (faultRaw !== null) {
    if (appEnv !== "dev" && appEnv !== "test") {
      throw new EnvError(`WORKER_FAULT is a test hook: it is refused with APP_ENV=${appEnv}`);
    }
    try {
      fault = parseFault(faultRaw);
    } catch (error) {
      throw new EnvError(`WORKER_FAULT: ${error instanceof Error ? error.message : "invalid"}`);
    }
  }
  let faultsAllowed: boolean;
  try {
    faultsAllowed = parseFaultsAllowed(raw, appEnv);
  } catch (error) {
    if (error instanceof FaultsAllowedError) throw new EnvError(error.message);
    throw error;
  }
  const engineKind = (str(raw, "ENGINE") ?? "stockfish").toLowerCase();
  if (engineKind !== "stockfish" && engineKind !== "fake") throw new EnvError("ENGINE must be stockfish or fake");
  if (engineKind === "fake" && appEnv !== "test") {
    throw new EnvError(`ENGINE=fake is a test hook: it is refused with APP_ENV=${appEnv}`);
  }

  // ── The engine profile is code, not configuration (determinism, §8.13) ────────────────────────────────────────
  const profile = str(raw, "ENGINE_PROFILE") ?? ENGINE_PROFILE.id;
  if (profile !== ENGINE_PROFILE.id) {
    throw new EnvError(`ENGINE_PROFILE must be ${ENGINE_PROFILE.id} (the profile this build grades with)`);
  }
  const threads = int(raw, "ENGINE_THREADS", 1, 64) ?? ENGINE_PROFILE.threads;
  if (threads !== ENGINE_PROFILE.threads) throw new EnvError(`ENGINE_THREADS must be ${ENGINE_PROFILE.threads} (profile ${profile})`);
  const hashMb = int(raw, "ENGINE_HASH_MB", 1, 65_536) ?? ENGINE_PROFILE.hashMb;
  if (hashMb !== ENGINE_PROFILE.hashMb) throw new EnvError(`ENGINE_HASH_MB must be ${ENGINE_PROFILE.hashMb} (profile ${profile})`);

  // ── Database (P3-D11; role replay_worker) ───────────────────────────────────────────────────────────────────
  const databaseUrl = str(raw, "WORKER_DATABASE_URL");
  if (databaseUrl === null) throw new EnvError("WORKER_DATABASE_URL is required");
  const { driver } = databaseTarget(appEnv, databaseUrl);

  // ── Internal auth (P3-D21) ──────────────────────────────────────────────────────────────────────────────────
  const internalKeys = keyRing(raw);
  if (appEnv !== "local" && internalKeys.signingKid !== "wk") {
    throw new EnvError("INTERNAL_API_SECRET must list the worker's own kid `wk` first");
  }
  const forbidden = WORKER_FORBIDDEN_KIDS.filter((kid) => internalKeys.keys.has(kid));
  if (forbidden.length > 0) {
    throw new EnvError(
      `INTERNAL_API_SECRET holds the ${forbidden.join(", ")} key: the worker must hold only wk and its callers' keys (${WORKER_ACCEPTED_KIDS.join(", ")})`,
    );
  }
  const acceptKeys = restrictKeyRing(internalKeys, WORKER_ACCEPTED_KIDS);
  if (appEnv !== "local" && acceptKeys.keys.size === 0) {
    throw new EnvError(`INTERNAL_API_SECRET holds no key the worker accepts (${WORKER_ACCEPTED_KIDS.join(", ")})`);
  }

  const wsInternalUrl = httpUrl(raw, "WS_INTERNAL_URL");
  if (wsInternalUrl === null && (appEnv === "dev" || appEnv === "production")) {
    throw new EnvError(`WS_INTERNAL_URL is required with APP_ENV=${appEnv}`);
  }

  const workerId = str(raw, "WORKER_ID") ?? defaultWorkerId(appEnv);
  // lockedBy is varchar(40): "<workerId>-<8-char boot id>".
  if (!/^[a-z0-9][a-z0-9-]{0,29}$/.test(workerId)) throw new EnvError("WORKER_ID must be 1-30 chars of a-z, 0-9 and -");

  const cacheEnabled = flag(raw, "EVAL_CACHE", true);
  const cachePath = str(raw, "EVAL_CACHE_PATH") ?? DEFAULT_CACHE_PATH;
  const seedUrl = httpUrl(raw, "EVAL_CACHE_SEED_URL");
  const maxGb = int(raw, "EVAL_CACHE_MAX_GB", 1, 64) ?? 4;

  const posthogKey = str(raw, "POSTHOG_PROJECT_KEY");
  const logLevel = (str(raw, "LOG_LEVEL") ?? (appEnv === "test" ? "warn" : "info")) as LogLevel;
  if (!["debug", "info", "warn", "error"].includes(logLevel)) throw new EnvError("LOG_LEVEL must be debug, info, warn or error");

  return {
    appEnv,
    port: int(raw, "PORT", 0, 65_535) ?? WORKER_PORT,
    host: appEnv === "dev" || appEnv === "production" ? "0.0.0.0" : "127.0.0.1",
    databaseUrl,
    dbDriver: driver,
    internalKeys,
    acceptKeys,
    wsInternalUrl,
    workerId,
    engine: {
      kind: engineKind,
      path: str(raw, "ENGINE_PATH") ?? DEFAULT_ENGINE_PATH,
      threads,
      hashMb,
      profile,
      nice: true,
    },
    evalCache: { enabled: cacheEnabled, path: cachePath, seedUrl, maxGb },
    lagPauseMs: int(raw, "LAG_PAUSE_MS", 1, 10_000) ?? 40,
    fault,
    sentryDsn: str(raw, "SENTRY_DSN"),
    posthog: posthogKey ? { key: posthogKey, host: str(raw, "POSTHOG_HOST") ?? "https://us.i.posthog.com" } : null,
    logLevel,
    imports: parseImportSettings(raw, appEnv),
    faultsAllowed,
  };
}

/** A kick body's `fault` is honoured only in APP_ENV=test (§7.5); elsewhere it is ignored, never an error. */
export function kickFaultsHonoured(appEnv: AppEnvName): boolean {
  return appEnv === "test";
}
