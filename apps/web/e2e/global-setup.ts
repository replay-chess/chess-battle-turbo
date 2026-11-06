import { clerkSetup } from "@clerk/testing/playwright";
import { FullConfig } from "@playwright/test";
import type { PrismaClient } from "@repo/db";
import { assertFixtureHealth } from "./fixtures/health";
import { entitleSharedMembers } from "./scripts/provision-test-users";
import { sweepThrowawayUsers } from "./scripts/sweep-throwaway-users";

// Global setup (phase-01 plan §12.0, CT X3/X4):
// 1. run lock: one E2E run at a time on the shared dev database;
// 2. re-entitle the shared members A–P (idempotent upsert);
// 3. fixture health: fail clearly when A–P, Q or R drifted;
// 4. sweep throwaway Clerk users older than 2 h, fail near the Clerk user cap.
// Escape hatches for local debugging (never in CI): E2E_SKIP_RUN_LOCK=1,
// E2E_SKIP_ENTITLE=1, E2E_SKIP_HEALTH=1, E2E_SWEEP=0.

const RUN_LOCK_KEY = "rc-e2e-dev";
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

function dbUrl(): string | undefined {
  return process.env.DIRECT_URL || process.env.DATABASE_URL;
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
}

/** One connection, so the session-level advisory lock and its release use the same session. */
function singleConnection(url: string): string {
  const u = new URL(url);
  u.searchParams.set("connection_limit", "1");
  return u.toString();
}

async function newClient(url: string): Promise<PrismaClient> {
  const { PrismaClient } = await import("@repo/db");
  return new PrismaClient({ datasourceUrl: url });
}

/**
 * Takes pg_try_advisory_lock(hashtext('rc-e2e-dev')) on the dev DIRECT_URL and
 * keeps the connection open for the whole run. CI jobs on Docker Postgres
 * (localhost) skip it: each job has its own database.
 */
async function takeRunLock(url: string): Promise<(() => Promise<void>) | null> {
  if (LOCAL_HOSTS.has(hostOf(url)) || process.env.E2E_SKIP_RUN_LOCK === "1") return null;
  const db = await newClient(singleConnection(url));
  const [row] = await db.$queryRaw<Array<{ locked: boolean }>>`
    SELECT pg_try_advisory_lock(hashtext(${RUN_LOCK_KEY})) AS locked`;
  if (!row?.locked) {
    await db.$disconnect();
    throw new Error(
      "Another E2E run holds the dev database (advisory lock rc-e2e-dev): the owner's run, nightly or post-deploy. " +
        "Wait for it to finish, or set E2E_SKIP_RUN_LOCK=1 if you are sure no other run is active.",
    );
  }
  console.log(`[global-setup] run lock taken on ${hostOf(url)}`);
  return async () => {
    try {
      await db.$queryRaw`SELECT pg_advisory_unlock(hashtext(${RUN_LOCK_KEY}))`;
    } finally {
      await db.$disconnect();
    }
  };
}

export default async function globalSetup(_config: FullConfig) {
  const letters = "ABCDEFGHIJKLMNOP".split("");
  const required = letters.flatMap((l) => [`E2E_USER_${l}_EMAIL`, `E2E_USER_${l}_PASSWORD`]);
  // E2E_PUBLIC_ONLY=1 runs only the signed-out specs (no Clerk test users needed).
  if (process.env.E2E_PUBLIC_ONLY === "1") {
    if (process.env.CLERK_SECRET_KEY) await clerkSetup();
    return;
  }
  for (const key of required) {
    if (!process.env[key]) {
      throw new Error(`Missing required env var: ${key}. Create apps/web/.env.test with test credentials.`);
    }
  }
  await clerkSetup();

  const url = dbUrl();
  if (!url) throw new Error("DATABASE_URL / DIRECT_URL is not set; source apps/web/.env.test (never production).");
  const ci = Boolean(process.env.CI);

  const releaseLock = await takeRunLock(url);
  try {
    const db = await newClient(url);
    try {
      if (process.env.E2E_SKIP_ENTITLE !== "1" || ci) {
        const n = await entitleSharedMembers(db);
        console.log(`[global-setup] entitled ${n} shared members (A–P)`);
      }
      if (process.env.E2E_SKIP_HEALTH !== "1" || ci) {
        const warnings = await assertFixtureHealth(db);
        for (const w of warnings) console.warn(`[global-setup] fixture warning: ${w}`);
      }
    } finally {
      await db.$disconnect();
    }

    if (process.env.E2E_SWEEP !== "0" || ci) {
      await sweepThrowawayUsers({ log: (l) => console.log(`[global-setup] ${l}`) });
    }
  } catch (err) {
    await releaseLock?.();
    throw err;
  }

  // Playwright runs the returned function as global teardown.
  return async () => {
    await releaseLock?.();
  };
}
