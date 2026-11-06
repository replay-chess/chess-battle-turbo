// Socket server environment (phase-02 plan 7.9). Parsed once at boot; a bad value stops the process with a message
// that names the variable and never its value. No dotenv: the server reads only the environment it is given
// (compose `env_file` on OCI, an explicit `set -a; source …` locally), so apps/web-socket/.env (production URLs) can
// never leak into a local run.
import { parseKeyRing, type KeyRing } from "@repo/contracts/internal/auth";
import { parseSocketKeyRing, SOCKET_TOKEN_BARE_KID } from "@repo/contracts/socket/token";
import { AppEnv } from "@repo/contracts/http/system";

export type AppEnvName = "dev" | "production" | "test" | "local";

export interface ServerEnv {
  appEnv: AppEnvName;
  port: number;
  /** Exact origins allowed to open a socket (plan 7.4.1 `allowRequest`); empty = any (only in test/local). */
  allowedOrigins: string[];
  /** v1 handlers for clients without `proto: 2` (until the parity gate). */
  protocolV1: boolean;
  /** SOCKET_TOKEN_SECRET (user tokens). */
  socketKeys: KeyRing;
  /** INTERNAL_API_SECRET (service HMAC keys, plan 7.5.1). */
  internalKeys: KeyRing;
  webAppUrl: string | null;
  databaseUrl: string | null;
  journalDir: string | null;
  /** `TIMING_PROFILE=fast` (APP_ENV=test only). */
  timingProfile: "real" | "fast";
  /** Tuning overrides (plan 7.9: "env only for tests and tuning"). Undefined = the plan default. */
  overrides: {
    checkpointPlies?: number;
    checkpointMaxAgeMs?: number;
    graceMs?: number;
    firstMoveMs?: number;
    rematchMs?: number;
    resumeMaxWaitMs?: number;
  };
  posthog: { key: string; host: string } | null;
  sentryDsn: string | null;
  logLevel: "debug" | "info" | "warn" | "error";
  /** `x-forwarded-for` is trusted for the per-IP guard (Caddy in front on OCI). */
  trustProxy: boolean;
}

export class EnvError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EnvError";
  }
}

type RawEnv = Readonly<Record<string, string | undefined>>;

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

function keyRing(name: string, parse: () => KeyRing): KeyRing {
  try {
    return parse();
  } catch (error) {
    // parseKeyRing never echoes key material; keep only its message.
    throw new EnvError(`${name}: ${error instanceof Error ? error.message : "invalid key ring"}`);
  }
}

/**
 * Parses the environment. Throws EnvError on anything the server must not start with:
 * - APP_ENV missing or unknown (the token `env` check depends on it);
 * - TIMING_PROFILE set with any APP_ENV other than `test` (plan 7.9: the process exits at boot);
 * - ALLOWED_ORIGINS unset in dev/production (the origin check fails closed);
 * - SOCKET_TOKEN_SECRET without a key outside test/local.
 */
export function loadEnv(raw: RawEnv = process.env): ServerEnv {
  const appEnvRaw = str(raw, "APP_ENV");
  const appEnvParsed = AppEnv.safeParse(appEnvRaw);
  if (!appEnvParsed.success) throw new EnvError("APP_ENV must be one of dev, production, test, local");
  const appEnv = appEnvParsed.data;

  const profileRaw = str(raw, "TIMING_PROFILE");
  if (profileRaw !== null && appEnv !== "test") {
    throw new EnvError("TIMING_PROFILE is a test hook: it is refused unless APP_ENV=test");
  }
  if (profileRaw !== null && profileRaw !== "real" && profileRaw !== "fast") {
    throw new EnvError("TIMING_PROFILE must be real or fast");
  }

  const allowedOrigins = (str(raw, "ALLOWED_ORIGINS") ?? "")
    .split(",")
    .map((o) => o.trim().replace(/\/+$/, ""))
    .filter(Boolean);
  if (allowedOrigins.length === 0 && (appEnv === "dev" || appEnv === "production")) {
    throw new EnvError("ALLOWED_ORIGINS is required when APP_ENV is dev or production");
  }
  for (const origin of allowedOrigins) {
    if (!/^https?:\/\/[^/\s]+$/.test(origin)) throw new EnvError("ALLOWED_ORIGINS must list origins like https://host");
  }

  const internalKeys = keyRing("INTERNAL_API_SECRET", () => parseKeyRing(raw.INTERNAL_API_SECRET));
  let socketKeys = keyRing("SOCKET_TOKEN_SECRET", () => parseSocketKeyRing(raw.SOCKET_TOKEN_SECRET));
  // Plan 7.1.7: during the WP-D rollout the web app may still sign v2 tokens with the old bare shared secret
  // (read under kid `s0`). Accepted outside production only, and only when the ring has no `s0` of its own.
  const legacy = str(raw, "LEGACY_INTERNAL_API_SECRET");
  if (legacy && appEnv !== "production" && !socketKeys.keys.has(SOCKET_TOKEN_BARE_KID)) {
    const keys = new Map(socketKeys.keys);
    keys.set(SOCKET_TOKEN_BARE_KID, Buffer.from(legacy, "utf8"));
    socketKeys = { signingKid: socketKeys.signingKid ?? SOCKET_TOKEN_BARE_KID, keys };
  }
  if (socketKeys.keys.size === 0 && (appEnv === "dev" || appEnv === "production")) {
    throw new EnvError("SOCKET_TOKEN_SECRET is required when APP_ENV is dev or production");
  }

  const posthogKey = str(raw, "POSTHOG_PROJECT_KEY");
  const logLevelRaw = str(raw, "LOG_LEVEL") ?? (appEnv === "test" ? "warn" : "info");
  if (!["debug", "info", "warn", "error"].includes(logLevelRaw)) throw new EnvError("LOG_LEVEL must be debug, info, warn or error");

  return {
    appEnv,
    port: int(raw, "PORT", 0, 65_535) ?? 3002,
    allowedOrigins,
    protocolV1: flag(raw, "PROTOCOL_V1", false),
    socketKeys,
    internalKeys,
    webAppUrl: str(raw, "WEB_APP_URL"),
    databaseUrl: str(raw, "DATABASE_URL"),
    journalDir: str(raw, "JOURNAL_DIR"),
    timingProfile: profileRaw === "fast" ? "fast" : "real",
    overrides: {
      checkpointPlies: int(raw, "CHECKPOINT_PLIES", 1, 200),
      checkpointMaxAgeMs: int(raw, "CHECKPOINT_MAX_AGE_MS", 100, 600_000),
      graceMs: int(raw, "GRACE_MS", 100, 600_000),
      firstMoveMs: int(raw, "FIRST_MOVE_MS", 100, 600_000),
      rematchMs: int(raw, "REMATCH_MS", 100, 600_000),
      resumeMaxWaitMs: int(raw, "RESUME_MAX_WAIT_MS", 100, 600_000),
    },
    posthog: posthogKey ? { key: posthogKey, host: str(raw, "POSTHOG_HOST") ?? "https://us.i.posthog.com" } : null,
    sentryDsn: str(raw, "SENTRY_DSN"),
    logLevel: logLevelRaw as ServerEnv["logLevel"],
    trustProxy: flag(raw, "TRUST_PROXY", appEnv === "dev" || appEnv === "production"),
  };
}

/** True when an Origin header may open a socket. A request without Origin (non-browser client) is allowed. */
export function originAllowed(env: Pick<ServerEnv, "allowedOrigins" | "appEnv">, origin: string | undefined): boolean {
  if (!origin) return true;
  if (env.allowedOrigins.length === 0) return env.appEnv === "test" || env.appEnv === "local";
  return env.allowedOrigins.includes(origin.replace(/\/+$/, ""));
}
