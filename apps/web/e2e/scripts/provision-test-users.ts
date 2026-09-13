/**
 * One-time provisioning script for E2E test users E through P.
 *
 * Creates 12 Clerk users via the REST API and prints the .env.test entries.
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
 * with BILLING_PAYWALL=on. Requires DATABASE_URL (the E2E/perf database,
 * never production). Rows are upserted by email: an existing row is updated
 * in place, a missing one is created the same way /api/user/sync would.
 * Without the flag, behavior is unchanged and the database is never touched.
 */

/* eslint-disable turbo/no-undeclared-env-vars -- one-off script run by hand, not a turbo task */
import crypto from "node:crypto";
import type { PrismaClient } from "../../app/generated/prisma";

const CLERK_SECRET_KEY = process.env.CLERK_SECRET_KEY;
if (!CLERK_SECRET_KEY) {
  console.error("CLERK_SECRET_KEY must be set. Source .env.test first.");
  process.exit(1);
}

const args = new Set(process.argv.slice(2));
const ENTITLE =
  args.has("--entitle") || process.env.E2E_ENTITLE_USERS?.toLowerCase() === "true";

if (ENTITLE && !process.env.DATABASE_URL) {
  console.error("DATABASE_URL must be set to entitle users. Source .env.test first.");
  process.exit(1);
}

const LETTERS = "EFGHIJKLMNOP".split("");

/** Product id stored on entitled fixture rows; never a real Dodo product. */
const E2E_FIXTURE_PRODUCT_ID = "e2e-fixture";

function generatePassword(): string {
  return crypto.randomBytes(12).toString("base64url") + "!Aa1";
}

/** Mirrors the 6-character code /api/user/sync assigns to new users. */
function generateUserCode(): string {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

async function createClerkUser(
  letter: string,
  password: string,
): Promise<{ id: string; email: string }> {
  const email = `e2e-player${letter.toLowerCase()}@chessbattle.dev`;
  const res = await fetch("https://api.clerk.com/v1/users", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${CLERK_SECRET_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      email_address: [email],
      password,
      first_name: `TestPlayer${letter}`,
      last_name: "E2E",
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    // If user already exists, that's fine — just warn
    if (res.status === 422 && text.includes("already been taken")) {
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
  const params = new URLSearchParams({ email_address: email, limit: "1" });
  const res = await fetch(`https://api.clerk.com/v1/users?${params}`, {
    headers: { Authorization: `Bearer ${CLERK_SECRET_KEY}` },
  });
  if (!res.ok) return null;
  const data = (await res.json()) as Array<{ id: string }>;
  return data[0]?.id ?? null;
}

/**
 * Marks a test user as an active Player subscriber. The fields match what
 * lib/billing/entitlement.ts writes for a real subscription, with fixture
 * identifiers so the rows are easy to recognize and never collide with Dodo.
 */
async function entitleUser(
  db: PrismaClient,
  letter: string,
  email: string,
  clerkUserId: string | null,
): Promise<void> {
  const now = new Date();
  const periodEnd = new Date(now);
  periodEnd.setFullYear(periodEnd.getFullYear() + 1);

  const entitlement = {
    plan: "player",
    planInterval: "month",
    subscriptionId: `e2e_${email}`,
    subscriptionStatus: "active",
    subscriptionProductId: E2E_FIXTURE_PRODUCT_ID,
    currentPeriodEnd: periodEnd,
    cancelAtPeriodEnd: false,
    subscriptionUpdatedAt: now,
  };

  const user = await db.user.upsert({
    where: { email },
    update: entitlement,
    create: {
      // /api/user/sync relinks googleId by email on first sign-in, so a
      // placeholder is safe when the Clerk id could not be resolved.
      googleId: clerkUserId ?? `e2e_pending_${email}`,
      email,
      name: `TestPlayer${letter} E2E`,
      code: generateUserCode(),
      isActive: true,
      onboarded: true,
      ...entitlement,
      stats: { create: {} },
    },
  });
  console.log(`  Entitled: ${email} (${user.referenceId})`);
}

async function main() {
  console.log("Provisioning 12 E2E test users (E through P)...\n");

  const envLines: string[] = [];
  const created: Array<{ letter: string; email: string; id: string }> = [];

  for (const letter of LETTERS) {
    const password = generatePassword();
    const { id, email } = await createClerkUser(letter, password);
    console.log(`  Created: ${email}`);
    created.push({ letter, email, id });

    envLines.push(`E2E_USER_${letter}_EMAIL=${email}`);
    envLines.push(`E2E_USER_${letter}_PASSWORD=${password}`);
  }

  if (ENTITLE) {
    console.log("\nEntitling test users (active Player plan, fixture subscription)...\n");
    const { PrismaClient } = await import("../../app/generated/prisma");
    const db = new PrismaClient();
    try {
      for (const { letter, email, id } of created) {
        const clerkUserId = id === "existing" ? await findClerkUserId(email) : id;
        await entitleUser(db, letter, email, clerkUserId);
      }
    } finally {
      await db.$disconnect();
    }
  }

  console.log("\n# Append these lines to apps/web/.env.test:\n");
  console.log(envLines.join("\n"));
  console.log();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
