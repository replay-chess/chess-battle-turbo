/**
 * Shared rules of the Phase 4 backfills (phase-04 plan 6.6; data-model 11.6):
 *   linked-accounts.ts (B5), onboarding.ts (B6), trial-ledger.ts (B9), clerk-onboarded-claims.ts (B12).
 *
 * Every one of them:
 *   - is a dry run by default (counts and a sample, no write); `--apply` writes;
 *   - works in keyset batches of 500 (`id > $cursor ORDER BY id LIMIT 500`) and is idempotent through its predicate,
 *     so a second `--apply` finds nothing to do;
 *   - refuses to run unless the database host is allowed: the Neon dev endpoint (prisma/seed-guards.ts
 *     DEV_HOST_ALLOWLIST), a local Postgres (Docker, CI), or a host listed in BACKFILL_ALLOWED_HOSTS (comma-separated
 *     exact host names; P13 sets it to the production direct host for the launch window only, then unsets it);
 *   - stops at the user-count tripwire (≤ 60 users) on the dev endpoint and on a local Postgres; a host admitted only
 *     through BACKFILL_ALLOWED_HOSTS is the explicit production window, where the listing is the consent;
 *   - writes one `audit_logs` row per `--apply` run through `audit(db, {category: SYSTEM, action: "backfill.<name>",
 *     actorKind: SYSTEM, meta: counts})`;
 *   - reads DIRECT_URL (else DATABASE_URL) from the shell, else from .env.development.local, never .env.local (it
 *     can still point at the old production database), and prints hosts and counts only.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseEnv } from "dotenv";
import { Prisma, type PrismaClient } from "@repo/db";
import {
  DEV_ENV_FILE,
  MAX_TARGET_USERS,
  SeedGuardError,
  assertUserTripwire,
  hostOf,
  isDevHost,
  resolveEnvVar,
} from "@repo/db/seed-guards";
import { audit, type AuditMetaValue } from "../../lib/audit";

export { SeedGuardError } from "@repo/db/seed-guards";

/** Rows per keyset batch (data-model 11.6). */
export const BATCH_SIZE = 500;

export type BackfillName = "linked_accounts" | "onboarding" | "trial_ledger" | "clerk_onboarded_claims";

/** Loopback hosts and the CI service name: a throwaway Postgres. */
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]", "postgres"]);

export type TargetKind = "local" | "neon-dev" | "listed";

/** BACKFILL_ALLOWED_HOSTS → exact, lower-cased host names (blank entries ignored; no wildcards). */
export function allowedHostsFromEnv(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((h) => h.trim().toLowerCase())
    .filter((h) => h !== "");
}

/** The host check (before any query). Returns the host and why it is allowed; throws SeedGuardError otherwise. */
export function assertBackfillHost(
  url: string | undefined | null,
  env: Record<string, string | undefined> = process.env,
): { host: string; kind: TargetKind } {
  const host = hostOf(url);
  if (LOCAL_HOSTS.has(host)) return { host, kind: "local" };
  if (isDevHost(host)) return { host, kind: "neon-dev" };
  if (allowedHostsFromEnv(env.BACKFILL_ALLOWED_HOSTS).includes(host)) return { host, kind: "listed" };
  throw new SeedGuardError(
    `refusing: database host ${host} is not in BACKFILL_ALLOWED_HOSTS (the Neon dev endpoint, a local Postgres, or a listed host)`,
  );
}

const WEB_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

/** The database URL in effect: the shell's DIRECT_URL / DATABASE_URL, else .env.development.local's. */
export function resolveBackfillUrl(
  env: Record<string, string | undefined> = process.env,
  webDir: string = WEB_DIR,
): { url: string; origin: string } {
  let file: Record<string, string> = {};
  try {
    file = parseEnv(readFileSync(path.join(webDir, DEV_ENV_FILE)));
  } catch {
    // CI and the integration tests have no env file: the shell provides the URL.
  }
  const resolved = resolveEnvVar("DIRECT_URL", env.DIRECT_URL || env.DATABASE_URL, file.DIRECT_URL || file.DATABASE_URL);
  return { url: resolved.value, origin: resolved.origin === "file" ? DEV_ENV_FILE : resolved.origin };
}

/** Raw-SQL access the backfills need (the Prisma client or a transaction client). */
export type BackfillDb = Pick<PrismaClient, "$queryRaw" | "$executeRaw">;

/**
 * The user-count tripwire. Integration-suite users (`…@test.invalid`, a reserved TLD) are not counted, as in
 * @repo/db/seed/target `checkTripwire`.
 */
export async function checkBackfillTripwire(db: BackfillDb, kind: TargetKind, max: number = MAX_TARGET_USERS): Promise<number | null> {
  if (kind === "listed") return null;
  const rows = await db.$queryRaw<{ n: bigint }[]>(
    Prisma.sql`SELECT count(*)::bigint AS n FROM users WHERE COALESCE(email, '') NOT LIKE '%@test.invalid'`,
  );
  const n = rows[0]?.n ?? -1n;
  assertUserTripwire(n, max);
  return Number(n);
}

export interface BackfillCli {
  apply: boolean;
  flags: ReadonlySet<string>;
}

/** `--apply` / `--dry-run` (the default) plus the script's own boolean flags. Unknown arguments throw. */
export function parseBackfillArgs(argv: readonly string[], extra: readonly string[] = []): BackfillCli {
  const known = new Set(["--apply", "--dry-run", ...extra]);
  const flags = new Set<string>();
  for (const a of argv) {
    if (a === "--") continue;
    if (!known.has(a)) throw new SeedGuardError(`unknown argument ${a} (known: ${[...known].join(", ")})`);
    flags.add(a);
  }
  if (flags.has("--apply") && flags.has("--dry-run")) throw new SeedGuardError("pass either --apply or --dry-run, not both");
  return { apply: flags.has("--apply"), flags };
}

/** One audit_logs row for an applied run (meta: the counts; never an email, handle or token). */
export async function recordBackfill(db: BackfillDb, name: BackfillName, meta: Record<string, AuditMetaValue>): Promise<void> {
  await audit(db, {
    category: "SYSTEM",
    action: `backfill.${name}`,
    actorKind: "SYSTEM",
    targetType: "backfill",
    targetId: name,
    meta,
  });
}

/**
 * Keyset loop: `next(cursor)` handles one batch of at most BATCH_SIZE rows starting after `cursor` and returns the
 * last id it looked at (null when the batch was empty). Stops on an empty or short batch.
 */
export async function eachBatch(
  next: (cursor: bigint, limit: number) => Promise<{ last: bigint | null; size: number }>,
  limit: number = BATCH_SIZE,
): Promise<number> {
  let cursor = 0n;
  let batches = 0;
  for (;;) {
    const r = await next(cursor, limit);
    if (r.last === null || r.size === 0) break;
    batches++;
    cursor = r.last;
    if (r.size < limit) break;
  }
  return batches;
}

export interface OpenedBackfill {
  db: PrismaClient;
  host: string;
  kind: TargetKind;
  users: number | null;
}

/** Guards, then a Prisma client on the target (the caller disconnects). */
export async function openBackfillDb(log: (line: string) => void, env: Record<string, string | undefined> = process.env): Promise<OpenedBackfill> {
  const { url, origin } = resolveBackfillUrl(env);
  const { host, kind } = assertBackfillHost(url, env);
  const { PrismaClient } = await import("@repo/db");
  const db = new PrismaClient({ datasourceUrl: url });
  try {
    const users = await checkBackfillTripwire(db, kind);
    log(`target   ${host} (${kind}; URL from ${origin})${users === null ? "" : `; users ${users} (limit ${MAX_TARGET_USERS})`}`);
    return { db, host, kind, users };
  } catch (error) {
    await db.$disconnect();
    throw error;
  }
}

/** Prints an error without a stack or anything that could carry a URL, and sets the exit code. */
export function reportFailure(tool: string, err: unknown): void {
  const msg = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
  console.error(`\n${tool} failed: ${msg.replace(/postgres(?:ql)?:\/\/\S+/g, "<database url>")}`);
  process.exitCode = 1;
}

/** True when this module file is the process entry point (`tsx <file>`). */
export function isEntryPoint(metaUrl: string): boolean {
  const entry = process.argv[1];
  return !!entry && path.resolve(entry) === fileURLToPath(metaUrl);
}

export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
