/**
 * B12 Clerk onboarded-claim backfill (phase-04 plan 6.6; data-model 11.6). Onboarding v3's middleware rule reads the
 * `onboarded` claim from the session token (`sessionClaims.md`, P1 lib/auth/claims.ts); a member who onboarded on the
 * legacy flow but whose Clerk `publicMetadata.onboarded` is not `true` would be sent back to `/onboarding`.
 *
 *   cd apps/web
 *   npx tsx scripts/backfill/clerk-onboarded-claims.ts            # dry run: reads Clerk, writes nothing
 *   npx tsx scripts/backfill/clerk-onboarded-claims.ts --apply    # writes the claim where it is missing
 *
 * For every active `onboarded = true` user (batches of 500 by id) whose Clerk user's `publicMetadata.onboarded !== true`,
 * merges the user's claims into `publicMetadata` (`PATCH /v1/users/{id}/metadata`, a deep merge: keys this module does
 * not own are kept). The value written is P1's full claim set from `computeClaims()` (so `onboarded: true` plus the
 * `v`, `entitled`, `lapsed`, `trialUsed` and `role` the row implies), never a partial claims object. Clerk calls are
 * spaced to 5 requests per second (lookups of 100 users each, then one write per user).
 *
 * Predicate: Clerk `publicMetadata.onboarded !== true` (idempotent: a rerun finds every claim in place).
 * Verification (plan 6.6): a fresh session token of a sample of 20 users shows the claim (stage B, by hand); the
 * script's own check is a second dry run reporting `to update 0`.
 *
 * Env: CLERK_SECRET_KEY from the shell, else .env.development.local. On the dev endpoint or a local Postgres the key
 * must be a development key (sk_test_). A production key needs a host listed in BACKFILL_ALLOWED_HOSTS and
 * CLAIMS_BACKFILL_CONFIRM=production (P13). Prints ids and counts only (no emails, names or keys).
 * Guards and the audit row: ./p04-common.ts.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseEnv } from "dotenv";
import { Prisma } from "@repo/db";
import { DEV_ENV_FILE } from "@repo/db/seed-guards";
import { computeClaims, type ClaimsRecord, type RcPublicMetadata } from "../../lib/auth/claims";
import {
  BATCH_SIZE,
  eachBatch,
  isEntryPoint,
  openBackfillDb,
  parseBackfillArgs,
  recordBackfill,
  reportFailure,
  SeedGuardError,
  sleep,
  type BackfillDb,
  type TargetKind,
} from "./p04-common";

/** Clerk's Backend API base (tests point the client at a local fake). */
export const CLERK_API = "https://api.clerk.com/v1";
/** 5 requests per second (plan 6.6 B12). */
export const CLERK_SPACING_MS = 200;
/** Users per Clerk lookup (`GET /users?user_id=…&limit=100`). */
export const CLERK_LOOKUP_SIZE = 100;

export type ClerkUserMeta = { id: string; public_metadata: unknown };

export interface ClerkApi {
  listUsers(ids: readonly string[]): Promise<ClerkUserMeta[]>;
  mergePublicMetadata(id: string, publicMetadata: RcPublicMetadata): Promise<void>;
}

/** HTTP client over Clerk's Backend API, with every call (reads and writes) spaced by `spacingMs`. */
export function clerkHttpApi(opts: {
  key: string;
  baseUrl?: string;
  spacingMs?: number;
  fetchImpl?: typeof fetch;
  sleepImpl?: (ms: number) => Promise<void>;
}): ClerkApi {
  const base = opts.baseUrl ?? CLERK_API;
  const spacing = opts.spacingMs ?? CLERK_SPACING_MS;
  const doFetch = opts.fetchImpl ?? fetch;
  const wait = opts.sleepImpl ?? sleep;
  let last = 0;
  async function call<T>(pathAndQuery: string, init?: RequestInit): Promise<T> {
    const gap = last + spacing - Date.now();
    if (last > 0 && gap > 0) await wait(gap);
    last = Date.now();
    const res = await doFetch(`${base}${pathAndQuery}`, {
      ...init,
      headers: { Authorization: `Bearer ${opts.key}`, "Content-Type": "application/json" },
    });
    if (!res.ok) {
      const where = (pathAndQuery.split("?")[0] ?? "").replace(/user_[A-Za-z0-9]+/, "user_…");
      throw new Error(`Clerk ${init?.method ?? "GET"} ${where}: ${res.status}`);
    }
    return (await res.json()) as T;
  }
  return {
    listUsers: (ids) =>
      ids.length === 0
        ? Promise.resolve([])
        : call<ClerkUserMeta[]>(`/users?limit=${ids.length}&${ids.map((id) => `user_id=${encodeURIComponent(id)}`).join("&")}`),
    mergePublicMetadata: async (id, publicMetadata) => {
      await call(`/users/${encodeURIComponent(id)}/metadata`, { method: "PATCH", body: JSON.stringify({ public_metadata: publicMetadata }) });
    },
  };
}

/** Development key on the dev endpoint / local Postgres; a production key only in the listed P13 window, confirmed. */
export function assertClerkKey(key: string | undefined, kind: TargetKind, confirm: string | undefined): "development" | "production" {
  if (!key) throw new SeedGuardError("CLERK_SECRET_KEY is not set");
  const instance = key.startsWith("sk_test_") ? "development" : "production";
  if (instance === "production" && !(kind === "listed" && confirm === "production")) {
    throw new SeedGuardError(
      "refusing: CLERK_SECRET_KEY is a production key; it needs a BACKFILL_ALLOWED_HOSTS host and CLAIMS_BACKFILL_CONFIRM=production",
    );
  }
  return instance;
}

type ClaimsRow = ClaimsRecord & { id: bigint; googleId: string };

function onboardedUsersSql(cursor: bigint, limit: number): Prisma.Sql {
  return Prisma.sql`
    SELECT id, "googleId", onboarded, role::text AS role, "subscriptionId", "subscriptionStatus", "cancelAtPeriodEnd",
           ("currentPeriodEnd" AT TIME ZONE 'UTC') AS "currentPeriodEnd", ("trialStartedAt" AT TIME ZONE 'UTC') AS "trialStartedAt"
      FROM users
     WHERE id > ${cursor} AND onboarded AND "isActive"
     ORDER BY id LIMIT ${limit}`;
}

/** Pure: which rows need the claim. Rows Clerk does not know (seed users, deleted Clerk users) are counted apart. */
export function planClaims(rows: readonly ClaimsRow[], clerkUsers: readonly ClerkUserMeta[], now: Date) {
  const byId = new Map(clerkUsers.map((u) => [u.id, u.public_metadata]));
  const out = { updates: [] as { userId: bigint; clerkUserId: string; claims: RcPublicMetadata }[], claimed: 0, missingInClerk: 0 };
  for (const row of rows) {
    if (!byId.has(row.googleId)) {
      out.missingInClerk++;
      continue;
    }
    const md = byId.get(row.googleId);
    if (md && typeof md === "object" && (md as Record<string, unknown>).onboarded === true) {
      out.claimed++;
      continue;
    }
    out.updates.push({ userId: row.id, clerkUserId: row.googleId, claims: computeClaims(row, now) });
  }
  return out;
}

export interface ClerkClaimsBackfillResult {
  apply: boolean;
  onboardedUsers: number;
  /** `googleId` is not a Clerk id (seeded legends, system users). */
  notClerk: number;
  missingInClerk: number;
  alreadyClaimed: number;
  toUpdate: number;
  updated: number;
  failed: number;
  batches: number;
}

export async function runClerkOnboardedClaimsBackfill(
  db: BackfillDb,
  opts: { apply: boolean; clerk: ClerkApi; now?: Date; log?: (line: string) => void; batchSize?: number },
): Promise<ClerkClaimsBackfillResult> {
  const log = opts.log ?? (() => {});
  const now = opts.now ?? new Date();
  const r: ClerkClaimsBackfillResult = {
    apply: opts.apply,
    onboardedUsers: 0,
    notClerk: 0,
    missingInClerk: 0,
    alreadyClaimed: 0,
    toUpdate: 0,
    updated: 0,
    failed: 0,
    batches: 0,
  };
  r.batches = await eachBatch(async (cursor, n) => {
    const rows = await db.$queryRaw<ClaimsRow[]>(onboardedUsersSql(cursor, n));
    r.onboardedUsers += rows.length;
    const clerkRows = rows.filter((row) => row.googleId.startsWith("user_"));
    r.notClerk += rows.length - clerkRows.length;
    for (let i = 0; i < clerkRows.length; i += CLERK_LOOKUP_SIZE) {
      const slice = clerkRows.slice(i, i + CLERK_LOOKUP_SIZE);
      const plan = planClaims(slice, await opts.clerk.listUsers(slice.map((row) => row.googleId)), now);
      r.missingInClerk += plan.missingInClerk;
      r.alreadyClaimed += plan.claimed;
      r.toUpdate += plan.updates.length;
      if (!opts.apply) continue;
      for (const u of plan.updates) {
        try {
          await opts.clerk.mergePublicMetadata(u.clerkUserId, u.claims);
          r.updated++;
        } catch (err) {
          r.failed++;
          log(`[claims] users.id ${u.userId}: ${err instanceof Error ? err.message : "failed"}`);
        }
      }
    }
    return { last: rows.at(-1)?.id ?? null, size: rows.length };
  }, opts.batchSize ?? BATCH_SIZE);
  if (opts.apply) {
    await recordBackfill(db, "clerk_onboarded_claims", {
      onboardedUsers: r.onboardedUsers,
      notClerk: r.notClerk,
      missingInClerk: r.missingInClerk,
      alreadyClaimed: r.alreadyClaimed,
      toUpdate: r.toUpdate,
      updated: r.updated,
      failed: r.failed,
      batches: r.batches,
    });
  }
  return r;
}

function clerkKeyFromEnv(): { key: string | undefined; origin: string } {
  if (process.env.CLERK_SECRET_KEY) return { key: process.env.CLERK_SECRET_KEY, origin: "shell" };
  const webDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
  try {
    return { key: parseEnv(readFileSync(path.join(webDir, DEV_ENV_FILE))).CLERK_SECRET_KEY, origin: DEV_ENV_FILE };
  } catch {
    return { key: undefined, origin: "nowhere" };
  }
}

async function main() {
  const { apply } = parseBackfillArgs(process.argv.slice(2));
  const log = (l: string) => console.log(l);
  log(`mode     ${apply ? "APPLY" : "dry run (Clerk reads only; pass --apply to write)"}`);
  const { db, kind } = await openBackfillDb(log);
  try {
    const { key, origin } = clerkKeyFromEnv();
    const instance = assertClerkKey(key, kind, process.env.CLAIMS_BACKFILL_CONFIRM);
    log(`clerk    ${instance} instance (CLERK_SECRET_KEY from ${origin})`);
    const r = await runClerkOnboardedClaimsBackfill(db, { apply, clerk: clerkHttpApi({ key: key! }), log });
    log(
      `onboarded users ${r.onboardedUsers}; not Clerk users ${r.notClerk}; missing in Clerk ${r.missingInClerk}; ` +
        `claim present ${r.alreadyClaimed}; ${apply ? "to update" : "would update"} ${r.toUpdate}` +
        (apply ? `; updated ${r.updated}; failed ${r.failed}` : ""),
    );
    if (r.failed > 0) process.exitCode = 1;
  } finally {
    await db.$disconnect();
  }
}

if (isEntryPoint(import.meta.url)) main().catch((err: unknown) => reportFailure("backfill/clerk-onboarded-claims", err));
