// Target resolution and guards shared by the Phase 3 dev seeds (`seed/{review,perf-archive,smoke}.ts`) and the
// backfills (`scripts/backfill/*.ts`). Phase-03 plan §6.8, §6.9; the P1 guards live in `prisma/seed-guards.ts`.
//
// Every writer here:
//   1. takes DIRECT_URL (else DATABASE_URL) from the shell, or from apps/web/.env.development.local, never from
//      .env.local (that file can still point at the old production database), and says which one is in effect;
//   2. accepts only the Neon dev endpoint (DEV_HOST_ALLOWLIST) or a local Postgres (Docker, CI);
//   3. stops when the target has more than MAX_TARGET_USERS users (the production tripwire), before any write;
//   4. prints hosts only, never a URL or a credential;
//   5. is a dry run unless `--apply` is passed.
// There is no override flag: pointing a writer anywhere else needs a code change.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseEnv } from "dotenv";
import {
  DEV_ENV_FILE,
  MAX_TARGET_USERS,
  SeedGuardError,
  assertUserTripwire,
  hostOf,
  isDevHost,
  resolveEnvVar,
} from "../prisma/seed-guards";
import type { SqlClient } from "../src/live/types";
import { Prisma } from "#generated";

export { SeedGuardError } from "../prisma/seed-guards";

/** Hosts a local Postgres answers on (Docker on the laptop, the CI service container). */
export const LOCAL_HOSTS: ReadonlySet<string> = new Set(["localhost", "127.0.0.1", "::1", "[::1]", "postgres"]);

export function isLocalHost(host: string): boolean {
  return LOCAL_HOSTS.has(host.toLowerCase());
}

/** The Neon dev endpoint or a local Postgres; anything else throws. Returns the host. */
export function assertWriteTarget(url: string | undefined | null): string {
  const host = hostOf(url);
  if (isLocalHost(host) || isDevHost(host)) return host;
  throw new SeedGuardError(`refusing to write: ${host} is neither the Neon dev endpoint nor a local Postgres`);
}

export interface ResolvedTarget {
  url: string;
  host: string;
  /** Where the URL came from: "shell", "file" (.env.development.local) or "shell (differs from file)". */
  origin: string;
  kind: "neon-dev" | "local";
}

/** The web app's directory (where .env.development.local lives). */
export const WEB_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "apps", "web");

/**
 * Guard 1 + 2: the target URL (DIRECT_URL preferred: seeds and backfills hold a transaction open, which the Neon
 * pooler in transaction mode handles, but the direct endpoint keeps statement timings honest).
 */
export function resolveWriteTarget(env: NodeJS.ProcessEnv = process.env, webDir: string = WEB_DIR): ResolvedTarget {
  let fileValues: Record<string, string> = {};
  try {
    fileValues = parseEnv(readFileSync(path.join(webDir, DEV_ENV_FILE)));
  } catch {
    // CI and the integration tests have no env file; the shell provides the URL.
  }
  const resolved = resolveEnvVar(
    "DIRECT_URL",
    env.DIRECT_URL || env.DATABASE_URL,
    fileValues.DIRECT_URL || fileValues.DATABASE_URL,
  );
  const host = assertWriteTarget(resolved.value);
  return {
    url: resolved.value,
    host,
    origin: resolved.origin === "file" ? DEV_ENV_FILE : resolved.origin,
    kind: isLocalHost(host) ? "local" : "neon-dev",
  };
}

/**
 * Guard 3: the user-count tripwire. Returns the count. The integration suites' synthetic users (`…@test.invalid`, a
 * reserved TLD no real account can have) are not counted: CI seeds the perf archive after every `*.int.test.ts` ran
 * on the same database, and their leftovers (≈ 80 users) tripped the guard on a throwaway CI database
 * (regression: tripwire-test-users).
 */
export async function checkTripwire(db: SqlClient, max: number = MAX_TARGET_USERS): Promise<number> {
  const rows = await db.$queryRaw<{ n: bigint }[]>(
    Prisma.sql`SELECT count(*)::bigint AS n FROM users WHERE COALESCE(email, '') NOT LIKE '%@test.invalid'`,
  );
  const n = rows[0]?.n ?? -1n;
  assertUserTripwire(n, max);
  return Number(n);
}

/** `--name value` / `--name=value` parsing shared by the CLIs. Unknown flags throw. */
export function parseFlags(
  argv: readonly string[],
  spec: { booleans: readonly string[]; values: readonly string[] },
): { flags: Set<string>; values: Map<string, string> } {
  const flags = new Set<string>();
  const values = new Map<string, string>();
  const args = argv.filter((a) => a !== "--");
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    const eq = a.indexOf("=");
    const name = eq > 0 ? a.slice(0, eq) : a;
    if (spec.booleans.includes(name) && eq < 0) {
      flags.add(name);
      continue;
    }
    if (spec.values.includes(name)) {
      const v = eq > 0 ? a.slice(eq + 1) : args[++i];
      if (v === undefined || v === "" || (eq < 0 && v.startsWith("--"))) throw new SeedGuardError(`${name} needs a value`);
      values.set(name, v);
      continue;
    }
    throw new SeedGuardError(`unknown argument ${a}`);
  }
  return { flags, values };
}

/** A positive integer flag value. */
export function positiveInt(name: string, raw: string | undefined, fallback: number, max: number): number {
  if (raw === undefined) return fallback;
  if (!/^[1-9]\d*$/.test(raw)) throw new SeedGuardError(`${name} must be a positive integer (got ${raw})`);
  const n = Number(raw);
  if (n > max) throw new SeedGuardError(`${name} must be at most ${max} (got ${n})`);
  return n;
}

/** Prints an error without its stack or any value that could carry a URL. */
export function reportFailure(tool: string, err: unknown): void {
  const msg = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
  console.error(`\n${tool} failed: ${msg}`);
  process.exitCode = 1;
}

/** True when this module file is the process entry point (`tsx <file>`). */
export function isEntryPoint(metaUrl: string): boolean {
  const entry = process.argv[1];
  return !!entry && path.resolve(entry) === fileURLToPath(metaUrl);
}
