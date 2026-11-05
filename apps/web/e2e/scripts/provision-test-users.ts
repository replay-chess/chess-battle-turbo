/**
 * Provisioning for E2E test users (registry: e2e/fixtures/users.ts).
 *
 * Creates the letter users (default E through P) via the Clerk REST API and
 * prints the .env.test entries.
 *
 * Usage:
 *   cd apps/web
 *   set -a && source .env.test && set +a
 *   npx tsx e2e/scripts/provision-test-users.ts
 *
 * Entitlement (optional):
 *   npx tsx e2e/scripts/provision-test-users.ts --entitle
 *   E2E_ENTITLE_USERS=true npx tsx e2e/scripts/provision-test-users.ts
 *
 * With --entitle (or E2E_ENTITLE_USERS=true) the script also marks each test
 * user's `users` row as an active Player subscriber so the account can play
 * with BILLING_PAYWALL=on. Requires DATABASE_URL (the E2E/dev database,
 * never production). Rows are upserted by email: an existing row is updated
 * in place, a missing one is created the same way /api/user/sync would.
 * Without the flag, behavior is unchanged and the database is never touched.
 * Global setup runs the same upsert for A–P on every run (entitleSharedMembers).
 *
 * Persona pool (phase-01 plan §12.0, CT X4):
 *   npx tsx e2e/scripts/provision-test-users.ts --pool [--pool-range 1-24]
 * creates the permanent pool users E2E_POOL_01…24 (and the persona user S)
 * in Clerk, plus an unentitled `users` row each. `leasePersona()` resets them
 * with scripts/dev/personas.ts. Pool users sign in with a Clerk ticket, so no
 * password is stored. Run it once per Clerk instance.
 *
 * Read-only fixtures:
 *   npx tsx e2e/scripts/provision-test-users.ts --restore-qr
 * gives Q a used trial and clears every billing column of R (the states
 * e2e/fixtures/health.ts checks).
 */

/* eslint-disable turbo/no-undeclared-env-vars -- one-off script run by hand, not a turbo task */
import crypto from "node:crypto";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { PrismaClient } from "../../app/generated/prisma";
import {
  POOL_SIZE,
  SHARED_MEMBER_LETTERS,
  displayNameFor,
  letterEmail,
  letterEmailDefault,
  poolEmail,
  poolEnvKey,
  poolId,
} from "../fixtures/users";

/** Product id stored on entitled fixture rows; never a real Dodo product (see lib/billing/products.ts). */
export const E2E_FIXTURE_PRODUCT_ID = "e2e-fixture";

function generatePassword(): string {
  return crypto.randomBytes(12).toString("base64url") + "!Aa1";
}

/** Mirrors the 6-character code /api/user/sync assigns to new users. */
function generateUserCode(): string {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

function clerkSecret(): string {
  const key = process.env.CLERK_SECRET_KEY;
  if (!key) {
    console.error("CLERK_SECRET_KEY must be set. Source .env.test first.");
    process.exit(1);
  }
  return key;
}

async function createClerkUser(
  email: string,
  firstName: string,
  password: string | null,
): Promise<{ id: string; email: string }> {
  const res = await fetch("https://api.clerk.com/v1/users", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${clerkSecret()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      email_address: [email],
      ...(password ? { password } : { skip_password_requirement: true }),
      first_name: firstName,
      last_name: "E2E",
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    // If user already exists, that's fine — just warn
    if (
      res.status === 422 &&
      (text.includes("already been taken") || text.includes("form_identifier_exists"))
    ) {
      console.warn(`  User ${email} already exists — skipping creation`);
      return { id: "existing", email };
    }
    throw new Error(`Failed to create ${email}: ${res.status} ${text}`);
  }

  const data = await res.json();
  return { id: data.id as string, email };
}

/** Looks up the Clerk user id for an email that already existed. */
async function findClerkUserId(email: string): Promise<string | null> {
  const key = process.env.CLERK_SECRET_KEY;
  if (!key) return null; // the row gets a placeholder; sign-in relinks it by email
  const params = new URLSearchParams({ email_address: email, limit: "1" });
  const res = await fetch(`https://api.clerk.com/v1/users?${params}`, {
    headers: { Authorization: `Bearer ${key}` },
  });
  if (!res.ok) return null;
  const data = (await res.json()) as Array<{ id: string }>;
  return data[0]?.id ?? null;
}

type UserDb = Pick<PrismaClient, "user">;

/** The billing columns of an entitled fixture member, valid for a year from `now`. */
export function entitlementFields(email: string, now: Date = new Date()) {
  const periodEnd = new Date(now);
  periodEnd.setFullYear(periodEnd.getFullYear() + 1);
  return {
    plan: "player",
    planInterval: "month",
    subscriptionId: `e2e_${email}`,
    subscriptionStatus: "active",
    subscriptionProductId: E2E_FIXTURE_PRODUCT_ID,
    currentPeriodEnd: periodEnd,
    cancelAtPeriodEnd: false,
    subscriptionUpdatedAt: now,
  };
}

/**
 * Marks a test user as an active Player subscriber. The fields match what
 * lib/billing/entitlement.ts writes for a real subscription, with fixture
 * identifiers so the rows are easy to recognize and never collide with Dodo.
 */
export async function entitleUser(
  db: UserDb,
  label: string,
  email: string,
  clerkUserId: string | null,
  now: Date = new Date(),
): Promise<string> {
  const entitlement = entitlementFields(email, now);
  const user = await db.user.upsert({
    where: { email },
    update: entitlement,
    create: {
      // /api/user/sync relinks googleId by email on first sign-in, so a
      // placeholder is safe when the Clerk id could not be resolved.
      googleId: clerkUserId ?? `e2e_pending_${email}`,
      email,
      name: displayNameFor(label),
      code: generateUserCode(),
      isActive: true,
      onboarded: true,
      ...entitlement,
      stats: { create: {} },
    },
  });
  return user.referenceId;
}

/**
 * Global setup's idempotent re-entitlement of the shared members A–P: every
 * run pushes their period end a year out, so it can never lapse mid-suite.
 */
export async function entitleSharedMembers(db: UserDb, now: Date = new Date()): Promise<number> {
  let n = 0;
  for (const letter of SHARED_MEMBER_LETTERS) {
    await entitleUser(db, letter, letterEmail(letter), null, now);
    n++;
  }
  return n;
}

/** Creates (or finds) an unentitled row for a pool or persona user. */
async function ensureUnentitledRow(db: UserDb, label: string, email: string, clerkUserId: string | null) {
  await db.user.upsert({
    where: { email },
    update: {},
    create: {
      googleId: clerkUserId ?? `e2e_pending_${email}`,
      email,
      name: displayNameFor(label),
      code: generateUserCode(),
      isActive: true,
      onboarded: true,
      stats: { create: {} },
    },
  });
}

/** Q: trial used long ago, no subscription. R: no billing state at all. */
export async function restoreReadOnlyUsers(db: UserDb, now: Date = new Date()) {
  const day = 24 * 3_600_000;
  const cleared = {
    plan: null,
    planInterval: null,
    subscriptionId: null,
    subscriptionStatus: null,
    subscriptionProductId: null,
    currentPeriodEnd: null,
    cancelAtPeriodEnd: false,
    subscriptionUpdatedAt: null,
    trialStartedAt: null,
    trialEndsAt: null,
  };
  for (const [letter, fields] of [
    ["Q", { ...cleared, trialStartedAt: new Date(now.getTime() - 60 * day), trialEndsAt: new Date(now.getTime() - 53 * day) }],
    ["R", cleared],
  ] as const) {
    const email = letterEmail(letter);
    await db.user.upsert({
      where: { email },
      update: fields,
      create: {
        googleId: (await findClerkUserId(email)) ?? `e2e_pending_${email}`,
        email,
        name: displayNameFor(letter),
        code: generateUserCode(),
        isActive: true,
        onboarded: true,
        ...fields,
        stats: { create: {} },
      },
    });
    console.log(`  Restored ${letter}: ${email}`);
  }
}

function parsePoolRange(args: string[]): number[] {
  const i = args.indexOf("--pool-range");
  const [from, to] = i >= 0 ? (args[i + 1] ?? "").split("-").map(Number) : [1, POOL_SIZE];
  const out: number[] = [];
  for (let n = from ?? 1; n <= (to ?? from ?? POOL_SIZE); n++) {
    poolId(n); // validates the range
    out.push(n);
  }
  return out;
}

async function main() {
  const argv = process.argv.slice(2);
  const args = new Set(argv);
  const ENTITLE = args.has("--entitle") || process.env.E2E_ENTITLE_USERS?.toLowerCase() === "true";
  const POOL = args.has("--pool");
  const RESTORE_QR = args.has("--restore-qr");
  clerkSecret();
  if ((ENTITLE || POOL || RESTORE_QR) && !process.env.DATABASE_URL) {
    console.error("DATABASE_URL must be set to write users rows. Source .env.test first.");
    process.exit(1);
  }

  const envLines: string[] = [];
  let db: PrismaClient | null = null;
  const getDb = async () => {
    if (!db) {
      const { PrismaClient } = await import("../../app/generated/prisma/index.js");
      db = new PrismaClient();
    }
    return db;
  };

  try {
    if (POOL) {
      const numbers = parsePoolRange(argv);
      console.log(`Provisioning persona pool users ${numbers.map(poolId).join(", ")} and S...\n`);
      const targets = [
        ...numbers.map((n) => ({ label: String(n), email: poolEmail(n), envKey: poolEnvKey(n) })),
        { label: "S", email: letterEmail("S"), envKey: "E2E_USER_S_EMAIL" },
      ];
      for (const t of targets) {
        const { id } = await createClerkUser(t.email, displayNameFor(t.label).replace(/ E2E$/, ""), null);
        const clerkUserId = id === "existing" ? await findClerkUserId(t.email) : id;
        await ensureUnentitledRow(await getDb(), t.label, t.email, clerkUserId);
        envLines.push(`${t.envKey}=${t.email}`);
        console.log(`  Ready: ${t.email}`);
      }
    } else if (!RESTORE_QR) {
      // Override with E2E_LETTERS=ABCD... (e.g. a fresh Clerk instance needs A through P).
      const letters = (process.env.E2E_LETTERS ?? "EFGHIJKLMNOP").toUpperCase().split("");
      console.log(`Provisioning ${letters.length} E2E test users (${letters.join("")})...\n`);
      const created: Array<{ letter: string; email: string; id: string }> = [];
      for (const letter of letters) {
        const password = generatePassword();
        // "+clerk_test" addresses accept the fixed code 424242 for any email
        // verification or second factor on Clerk development instances.
        const email = letterEmailDefault(letter);
        const { id } = await createClerkUser(email, `TestPlayer${letter}`, password);
        created.push({ letter, email, id });
        if (id === "existing") continue; // keep the password already in .env.test
        console.log(`  Created: ${email}`);
        envLines.push(`E2E_USER_${letter}_EMAIL=${email}`);
        envLines.push(`E2E_USER_${letter}_PASSWORD=${password}`);
      }

      if (ENTITLE) {
        console.log("\nEntitling test users (active Player plan, fixture subscription)...\n");
        for (const { letter, email, id } of created) {
          const clerkUserId = id === "existing" ? await findClerkUserId(email) : id;
          const ref = await entitleUser(await getDb(), letter, email, clerkUserId);
          console.log(`  Entitled: ${email} (${ref})`);
        }
      }
    }

    if (RESTORE_QR) {
      console.log("\nRestoring the read-only users Q and R...\n");
      await restoreReadOnlyUsers(await getDb());
    }
  } finally {
    if (db) await (db as PrismaClient).$disconnect();
  }

  if (envLines.length) {
    console.log("\n# Append these lines to apps/web/.env.test:\n");
    console.log(envLines.join("\n"));
    console.log();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
