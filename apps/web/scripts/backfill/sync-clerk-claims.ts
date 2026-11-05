/**
 * Clerk claims backfill (phase-01 plan §6.5, §8.4; 1B·F4b).
 *
 * For every active `users` row (batches of 100 ordered by id) computes `RcPublicMetadata` and writes
 * it to the Clerk user's publicMetadata only when it differs. Idempotent: a rerun finds nothing to do.
 * Clerk calls are 120 ms apart (Clerk BAPI rate limit on dev: 100 requests / 10 s).
 *
 *   cd apps/web
 *   npx tsx scripts/backfill/sync-clerk-claims.ts --dry-run    # counts and a sample, no writes
 *   npx tsx scripts/backfill/sync-clerk-claims.ts              # writes the differing users
 *
 * Env: DATABASE_URL and CLERK_SECRET_KEY from the shell, else from .env.development.local (never
 * .env.local). Guards: the database host must be the dev endpoint and the Clerk key a development key
 * (sk_test_). The production run is P13; it needs `--allow-production` together with
 * CLAIMS_BACKFILL_CONFIRM=production, and is not used in P1. Prints hosts and counts only: no emails,
 * names or keys.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parse as parseEnv } from "dotenv";
import { DEV_ENV_FILE, hostOf, isDevHost } from "../../prisma/seed-guards";
import { CLAIMS_SELECT, claimsMatch, computeClaims, type ClaimsRecord, type RcPublicMetadata } from "../../lib/auth/claims";

export const BATCH_SIZE = 100;
export const CALL_SPACING_MS = 120;
const CLERK_API = "https://api.clerk.com/v1";

export type ClaimsRow = ClaimsRecord & { id: bigint; googleId: string };
export type ClerkUserMeta = { id: string; public_metadata: unknown };

export interface BatchPlan {
  updates: Array<{ userId: bigint; clerkUserId: string; claims: RcPublicMetadata; changedKeys: string[] }>;
  unchanged: number;
  missingInClerk: number;
}

/** Pure: which rows of a batch need a write. */
export function planBatch(rows: readonly ClaimsRow[], clerkUsers: readonly ClerkUserMeta[], now: Date): BatchPlan {
  const byId = new Map(clerkUsers.map((u) => [u.id, u.public_metadata]));
  const plan: BatchPlan = { updates: [], unchanged: 0, missingInClerk: 0 };
  for (const row of rows) {
    if (!byId.has(row.googleId)) {
      plan.missingInClerk++;
      continue;
    }
    const current = byId.get(row.googleId);
    const claims = computeClaims(row, now);
    if (claimsMatch(current, claims)) {
      plan.unchanged++;
      continue;
    }
    const md = (current && typeof current === "object" ? current : {}) as Record<string, unknown>;
    const changedKeys = Object.keys(claims).filter((k) => md[k] !== claims[k as keyof RcPublicMetadata]);
    plan.updates.push({ userId: row.id, clerkUserId: row.googleId, claims, changedKeys });
  }
  return plan;
}

export class BackfillGuardError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BackfillGuardError";
  }
}

/** Dev database and a development Clerk key, unless the P13 production override is given in full. */
export function assertBackfillTarget(
  databaseUrl: string | undefined,
  clerkKey: string | undefined,
  opts: { allowProduction: boolean; confirm: string | undefined },
): { host: string; clerk: "development" | "production" } {
  const host = hostOf(databaseUrl);
  if (!clerkKey) throw new BackfillGuardError("CLERK_SECRET_KEY is not set");
  const clerk = clerkKey.startsWith("sk_test_") ? "development" : "production";
  const production = opts.allowProduction && opts.confirm === "production";
  if (!production) {
    if (!isDevHost(host)) throw new BackfillGuardError(`refusing: database host ${host} is not the dev endpoint`);
    if (clerk !== "development") throw new BackfillGuardError("refusing: CLERK_SECRET_KEY is not a development key (sk_test_)");
  }
  return { host, clerk };
}

function loadEnv(): { databaseUrl?: string; clerkKey?: string; source: string } {
  const webDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
  let file: Record<string, string> = {};
  try {
    file = parseEnv(readFileSync(path.join(webDir, DEV_ENV_FILE)));
  } catch {
    // shell only
  }
  const pick = (name: string) => (process.env[name] ? { v: process.env[name], from: "shell" } : { v: file[name], from: DEV_ENV_FILE });
  const db = pick("DATABASE_URL");
  const clerk = pick("CLERK_SECRET_KEY");
  return { databaseUrl: db.v, clerkKey: clerk.v, source: `DATABASE_URL from ${db.from}, CLERK_SECRET_KEY from ${clerk.from}` };
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function clerk<T>(key: string, pathAndQuery: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${CLERK_API}${pathAndQuery}`, {
    ...init,
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  if (!res.ok) throw new Error(`Clerk ${init?.method ?? "GET"} ${pathAndQuery.split("?")[0]?.replace(/user_[A-Za-z0-9]+/, "user_…")}: ${res.status}`);
  return (await res.json()) as T;
}

export interface BackfillResult {
  dryRun: boolean;
  active: number;
  missingInClerk: number;
  unchanged: number;
  toUpdate: number;
  updated: number;
  failed: number;
}

export async function syncClerkClaimsBackfill(opts: { dryRun: boolean; allowProduction?: boolean; log?: (l: string) => void }): Promise<BackfillResult> {
  const log = opts.log ?? ((l: string) => console.log(l));
  const env = loadEnv();
  const target = assertBackfillTarget(env.databaseUrl, env.clerkKey, {
    allowProduction: Boolean(opts.allowProduction),
    confirm: process.env.CLAIMS_BACKFILL_CONFIRM,
  });
  log(`[claims] ${opts.dryRun ? "DRY RUN" : "WRITE"}: database ${target.host}, Clerk ${target.clerk} instance (${env.source})`);

  const { PrismaClient } = await import("../../app/generated/prisma/index.js");
  const db = new PrismaClient({ datasourceUrl: env.databaseUrl });
  const key = env.clerkKey!;
  const now = new Date();
  const result: BackfillResult = { dryRun: opts.dryRun, active: 0, missingInClerk: 0, unchanged: 0, toUpdate: 0, updated: 0, failed: 0 };
  const sample: string[] = [];

  try {
    let cursor: bigint | undefined;
    for (;;) {
      const rows: ClaimsRow[] = await db.user.findMany({
        where: { isActive: true, ...(cursor !== undefined ? { id: { gt: cursor } } : {}) },
        orderBy: { id: "asc" },
        take: BATCH_SIZE,
        select: CLAIMS_SELECT,
      });
      if (rows.length === 0) break;
      cursor = rows[rows.length - 1]!.id;
      result.active += rows.length;

      const ids = rows.map((r) => r.googleId).filter((id) => id.startsWith("user_"));
      const query = ids.map((id) => `user_id=${encodeURIComponent(id)}`).join("&");
      const clerkUsers = ids.length ? await clerk<ClerkUserMeta[]>(key, `/users?limit=${BATCH_SIZE}&${query}`) : [];
      await sleep(CALL_SPACING_MS);

      const plan = planBatch(rows, clerkUsers, now);
      result.missingInClerk += plan.missingInClerk;
      result.unchanged += plan.unchanged;
      result.toUpdate += plan.updates.length;
      for (const u of plan.updates) {
        if (sample.length < 10) sample.push(`users.id ${u.userId}: ${u.changedKeys.join(", ")}`);
        if (opts.dryRun) continue;
        try {
          await clerk(key, `/users/${encodeURIComponent(u.clerkUserId)}/metadata`, {
            method: "PATCH",
            body: JSON.stringify({ public_metadata: u.claims }),
          });
          result.updated++;
        } catch (err) {
          result.failed++;
          log(`[claims] users.id ${u.userId}: ${err instanceof Error ? err.message : "failed"}`);
        }
        await sleep(CALL_SPACING_MS);
      }
      if (rows.length < BATCH_SIZE) break;
    }
  } finally {
    await db.$disconnect();
  }

  for (const line of sample) log(`[claims]   ${line}`);
  log(
    `[claims] active ${result.active}; in Clerk ${result.active - result.missingInClerk} (missing ${result.missingInClerk}); ` +
      `unchanged ${result.unchanged}; ${opts.dryRun ? "would update" : "to update"} ${result.toUpdate}` +
      (opts.dryRun ? "" : `; updated ${result.updated}; failed ${result.failed}`),
  );
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  syncClerkClaimsBackfill({
    dryRun: process.argv.includes("--dry-run"),
    allowProduction: process.argv.includes("--allow-production"),
  })
    .then((r) => {
      if (r.failed > 0) process.exit(1);
    })
    .catch((err) => {
      console.error(err instanceof Error ? err.message : err);
      process.exit(1);
    });
}
