// Import settings of the worker (phase-04 plan §7.9, D4-09, §8.9; testing X12). Parsed once at boot by
// config/env.ts (`WorkerEnv.imports`); a bad value refuses the boot with a message that names the variable, never
// its value.
//
// | Variable                      | Default                 | Notes                                                    |
// |-------------------------------|-------------------------|----------------------------------------------------------|
// | IMPORT_WINDOW_MONTHS          | 12                      | the import window (D4-09)                                |
// | IMPORT_MAX_GAMES              | 2000                    | newest N games per account and run                       |
// | IMPORT_ANALYSE_EAGER_TRIAL    | 20                      | trialists: newest game at USER_OPENED + 19 IMPORT_NEWEST |
// | IMPORT_ANALYSE_EAGER          | 50                      | paying members                                           |
// | IMPORT_ANALYSE_CAP            | 200                     | analysed-without-opening budget per member               |
// | IMPORT_BACKLOG_SPREAD_DAYS    | 7                       | backlog slices (releaseImportBacklog)                    |
// | IMPORT_PAUSED                 | off                     | ops kill switch: the I/O lane claims nothing             |
// | CHESSCOM_API_BASE             | https://api.chess.com   | the e2e upstream mock elsewhere; refused in production   |
// | LICHESS_BASE_URL              | https://lichess.org     | same                                                     |
// | UPSTREAM_CONTACT              | hello@playchess.tech    | the User-Agent contact (R-CC-03)                         |
// | BILLING_PAYWALL               | on                      | `off` = every user counts as a member (the web's switch) |
//
// The provider base URLs are test hooks: with APP_ENV=production anything but the real providers is refused (the
// worker must never import from a mock in production, and never send a production User-Agent to a mock). With
// APP_ENV=test an unset URL is a closed loopback port, never the real provider (a test never calls Chess.com or
// Lichess by accident).
import { CHESSCOM_API_BASE_DEFAULT } from "@repo/chess-import/chesscom/client";
import { LICHESS_BASE_URL_DEFAULT } from "@repo/chess-import/lichess/client";
import { DEFAULT_CONTACT, normaliseBaseUrl, userAgent } from "@repo/chess-import/http";
import { IMPORT_MAX_GAMES_DEFAULT, IMPORT_WINDOW_MONTHS_DEFAULT } from "@repo/chess-import/window";
import { IMPORT_ANALYSE_CAP_DEFAULT, IMPORT_BACKLOG_SPREAD_DAYS_DEFAULT } from "@repo/db/import-backlog";
import { EnvError, type AppEnvName } from "../config/env";

export const IMPORT_ANALYSE_EAGER_TRIAL_DEFAULT = 20;
export const IMPORT_ANALYSE_EAGER_DEFAULT = 50;

export interface ImportSettings {
  /** IMPORT_PAUSED: the I/O lane claims nothing (lanes.ts). */
  paused: boolean;
  windowMonths: number;
  maxGames: number;
  eagerTrial: number;
  eager: number;
  cap: number;
  spreadDays: number;
  chesscomBaseUrl: string;
  lichessBaseUrl: string;
  contact: string;
  /** BILLING_PAYWALL !== off. */
  paywall: boolean;
}

type RawEnv = Readonly<Record<string, string | undefined>>;

function str(raw: RawEnv, name: string): string | null {
  const v = raw[name]?.trim();
  return v ? v : null;
}

function int(raw: RawEnv, name: string, min: number, max: number, fallback: number): number {
  const v = str(raw, name);
  if (v === null) return fallback;
  if (!/^\d+$/.test(v)) throw new EnvError(`${name} must be an integer`);
  const n = Number(v);
  if (n < min || n > max) throw new EnvError(`${name} must be within ${min}..${max}`);
  return n;
}

function onOff(raw: RawEnv, name: string, fallback: boolean): boolean {
  const v = str(raw, name)?.toLowerCase();
  if (v === undefined || v === null) return fallback;
  if (["on", "1", "true", "yes"].includes(v)) return true;
  if (["off", "0", "false", "no"].includes(v)) return false;
  throw new EnvError(`${name} must be on or off`);
}

/**
 * What an unset provider URL means with APP_ENV=test: a closed loopback port (9, discard), so a test worker that did
 * not point the providers at a mock fails its import with a connection error instead of calling Chess.com or
 * Lichess (FIX-1: the boot backstop of a P3 full-worker int test had swept other files' accounts and imported them
 * from the real providers).
 */
export const TEST_UNSET_PROVIDER_BASE = "http://127.0.0.1:9";

function baseUrl(raw: RawEnv, name: string, real: string, appEnv: AppEnvName): string {
  const v = str(raw, name);
  if (v === null) return appEnv === "test" ? `${TEST_UNSET_PROVIDER_BASE}/${name.toLowerCase()}-unset` : real;
  let url: string;
  try {
    url = normaliseBaseUrl(v, name);
  } catch (error) {
    throw new EnvError(error instanceof Error ? error.message : `${name} is invalid`);
  }
  if (appEnv === "production" && url !== real) {
    throw new EnvError(`${name} is a test hook: only ${real} is accepted with APP_ENV=production`);
  }
  return url;
}

export function parseImportSettings(raw: RawEnv, appEnv: AppEnvName): ImportSettings {
  const contact = str(raw, "UPSTREAM_CONTACT") ?? DEFAULT_CONTACT;
  try {
    userAgent(contact);
  } catch {
    throw new EnvError("UPSTREAM_CONTACT must be a plain address");
  }
  const eager = int(raw, "IMPORT_ANALYSE_EAGER", 0, 500, IMPORT_ANALYSE_EAGER_DEFAULT);
  const eagerTrial = int(raw, "IMPORT_ANALYSE_EAGER_TRIAL", 0, 500, IMPORT_ANALYSE_EAGER_TRIAL_DEFAULT);
  const cap = int(raw, "IMPORT_ANALYSE_CAP", 1, 10_000, IMPORT_ANALYSE_CAP_DEFAULT);
  if (eager > cap || eagerTrial > cap) throw new EnvError("IMPORT_ANALYSE_EAGER(_TRIAL) must not exceed IMPORT_ANALYSE_CAP");
  return {
    paused: onOff(raw, "IMPORT_PAUSED", false),
    windowMonths: int(raw, "IMPORT_WINDOW_MONTHS", 1, 24, IMPORT_WINDOW_MONTHS_DEFAULT),
    maxGames: int(raw, "IMPORT_MAX_GAMES", 1, 10_000, IMPORT_MAX_GAMES_DEFAULT),
    eagerTrial,
    eager,
    cap,
    spreadDays: int(raw, "IMPORT_BACKLOG_SPREAD_DAYS", 1, 60, IMPORT_BACKLOG_SPREAD_DAYS_DEFAULT),
    chesscomBaseUrl: baseUrl(raw, "CHESSCOM_API_BASE", CHESSCOM_API_BASE_DEFAULT, appEnv),
    lichessBaseUrl: baseUrl(raw, "LICHESS_BASE_URL", LICHESS_BASE_URL_DEFAULT, appEnv),
    contact,
    paywall: str(raw, "BILLING_PAYWALL")?.toLowerCase() !== "off",
  };
}

/** The defaults (tests, scripts). */
export function defaultImportSettings(overrides: Partial<ImportSettings> = {}): ImportSettings {
  return { ...parseImportSettings({}, "test"), ...overrides };
}
