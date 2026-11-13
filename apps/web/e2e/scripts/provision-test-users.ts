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
 *
 * Onboarded (phase-04 plan §3, testing X4, X17): the letter users A–R are
 * provisioned onboarded, never through the onboarding API: `onboarded`,
 * `onboardingStep = DONE` and `onboardedAt` on the row, and the Clerk
 * `publicMetadata` claims (`onboarded: true`, P1's claim set) written through
 * the Backend API of the DEVELOPMENT instance (`syncFixtureClaims`). Global
 * setup does it for A–P on every run; `--restore-qr` for Q and R. There is no
 * `--fresh <letter>` mode: shared letters are never reset to an onboarding
 * state (exact onboarding states come from the P4 personas of the lease pool,
 * e2e/personas/p04.ts).
 */

/* eslint-disable turbo/no-undeclared-env-vars -- one-off script run by hand, not a turbo task */
import crypto from "node:crypto";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { PrismaClient } from "@repo/db";
import { computeClaims, type ClaimsRecord, type RcPublicMetadata } from "../../lib/auth/claims";
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

/**
 * The onboarding columns of a provisioned fixture user (A–R): finished onboarding, as P4's resolver would leave it.
 * `onboardedAt` is only set when missing (the first provisioning), so repeated runs do not move it.
 */
export function onboardedFields(now: Date = new Date()) {
  return { onboarded: true, onboardingStep: "DONE" as const, onboardedAt: now };
}

/** Same as onboardedFields, for an `update`: keeps an existing `onboardedAt`. */
async function markOnboarded(db: UserDb, email: string, now: Date): Promise<void> {
  const row = await db.user.findUnique({ where: { email }, select: { onboardedAt: true } });
  if (!row) return;
  await db.user.update({
    where: { email },
    data: { onboarded: true, onboardingStep: "DONE", ...(row.onboardedAt ? {} : { onboardedAt: now }) },
  });
}

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
      ...onboardedFields(now),
      ...entitlement,
      stats: { create: {} },
    },
  });
  await markOnboarded(db, email, now);
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
  await syncFixtureClaims(db, SHARED_MEMBER_LETTERS.map((l) => letterEmail(l)), now);
  return n;
}

/** The `ClaimsRecord` columns plus the Clerk id, for the claims sync. */
const CLAIMS_COLUMNS = {
  googleId: true,
  onboarded: true,
  role: true,
  subscriptionId: true,
  subscriptionStatus: true,
  currentPeriodEnd: true,
  cancelAtPeriodEnd: true,
  trialStartedAt: true,
} as const;

type ClerkLookup = { id: string; public_metadata?: unknown; email_addresses?: { email_address: string }[] };

/** Pure: the claims a fixture row should carry and whether Clerk's copy differs (only P1's claim keys compared). */
export function claimsToWrite(row: ClaimsRecord, current: unknown, now: Date): RcPublicMetadata | null {
  const claims = computeClaims(row, now);
  const md = current && typeof current === "object" ? (current as Record<string, unknown>) : {};
  const same = (Object.keys(claims) as (keyof RcPublicMetadata)[]).every((k) => md[k] === claims[k]);
  return same ? null : claims;
}

/**
 * Writes P1's claims (with `onboarded: true` after provisioning) to the Clerk users of `emails`, development
 * instance only (`sk_test_`): one lookup for all of them, one PATCH per user whose claims differ. Rows whose Clerk
 * user does not exist yet (a fresh Clerk instance) are skipped; the first sign-in provisions and syncs them.
 * Returns the number of users written.
 */
export async function syncFixtureClaims(
  db: UserDb,
  emails: readonly string[],
  now: Date = new Date(),
  opts: { key?: string; fetchImpl?: typeof fetch } = {},
): Promise<number> {
  const key = opts.key ?? process.env.CLERK_SECRET_KEY;
  const doFetch = opts.fetchImpl ?? fetch;
  if (!key?.startsWith("sk_test_") || emails.length === 0) return 0;
  const params = new URLSearchParams({ limit: String(Math.min(emails.length, 100)) });
  for (const e of emails) params.append("email_address", e);
  const res = await doFetch(`https://api.clerk.com/v1/users?${params}`, {
    headers: { Authorization: `Bearer ${key}` },
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`Clerk user lookup for the fixture claims answered ${res.status}`);
  const users = (await res.json()) as ClerkLookup[];
  let written = 0;
  for (const u of users) {
    const email = u.email_addresses?.[0]?.email_address?.toLowerCase();
    if (!email) continue;
    const row = await db.user.findUnique({ where: { email }, select: CLAIMS_COLUMNS });
    if (!row) continue;
    const claims = claimsToWrite(row, u.public_metadata, now);
    if (!claims) continue;
    const patch = await doFetch(`https://api.clerk.com/v1/users/${encodeURIComponent(u.id)}/metadata`, {
      method: "PATCH",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ public_metadata: claims }),
      signal: AbortSignal.timeout(20_000),
    });
    if (!patch.ok) throw new Error(`Clerk metadata PATCH for a fixture user answered ${patch.status}`);
    written++;
  }
  return written;
}

/**
 * Provisions one registered fixture user (a letter, A–R) onboarded: the row's onboarding columns and the Clerk
 * claims. The auth fixture calls it when `GET /api/me` reports a letter user as not onboarded (a fresh database whose
 * first sign-in just created the row). Never for pool or throwaway users: their state is the spec's.
 */
export async function provisionOnboarded(db: UserDb, email: string, now: Date = new Date()): Promise<void> {
  await markOnboarded(db, email, now);
  await syncFixtureClaims(db, [email], now);
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
        ...onboardedFields(now),
        ...fields,
        stats: { create: {} },
      },
    });
    await markOnboarded(db, email, now);
    console.log(`  Restored ${letter}: ${email}`);
  }
  await syncFixtureClaims(db, ["Q", "R"].map((l) => letterEmail(l)), now);
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
      const { PrismaClient } = await import("@repo/db");
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
