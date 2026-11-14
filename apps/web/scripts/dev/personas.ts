/**
 * Persona reset tool (phase-01 plan §6.5, §12.0; CT X4).
 *
 * Writes a named persona's state onto a pool user (E2E_POOL_01…24) or the
 * dedicated persona user S. Shared users A–R, the admin and real users are
 * refused. Used by `leasePersona()` (e2e/fixtures/lease.ts) and by hand on dev.
 *
 *   cd apps/web
 *   npx tsx scripts/dev/personas.ts --list
 *   npx tsx scripts/dev/personas.ts --reset E2E_POOL_03 --persona payment_banner [--dry-run]
 *   npx tsx scripts/dev/personas.ts --reset S --persona payment_banner
 *
 * Guards (prisma/seed-guards.ts, 1A·P6), all before any write:
 * - DIRECT_URL comes from the shell (an E2E run exports .env.test) or from
 *   .env.development.local, never .env.local (old prod). Hosts only are printed.
 * - The host must be the dev endpoint, or a local Docker Postgres (CI).
 * - User-count tripwire.
 * - One UPDATE by email inside a transaction; nothing is created or deleted.
 *
 * Each later phase adds its personas file to PERSONAS below.
 *
 * Phase 3 personas (e2e/personas/p03.ts) also own games: after the billing UPDATE the reset deletes the user's games
 * and writes the persona's review fixtures with the P3 seed writers (@repo/db/seed/review: `clearMemberGames`,
 * `writePersonaFixtures`), which carry the same guards (no shared letter, the user-count tripwire).
 *
 * Phase 4 (e2e/personas/p04.ts, phase-04 plan 6.7): every reset first removes any P4 state of the user
 * (@repo/db/seed/p04-personas `clearP04State`: trial-ledger rows by email and handle, queued jobs, imported games,
 * links with their cursors and runs); a P4 persona then writes its own (`writeP04Persona`: onboarding and M4
 * billing columns, links, runs, cursors, imported fixture games). The ledger hashes come from
 * lib/billing/trial-ledger.ts, so HASH_PEPPER must be set (`.env.test` / `.env.development.local`). Finally the
 * user's Clerk claims are re-synced (development Clerk key only), so middleware sees `onboarded` / `entitled` at once.
 *
 * Phase 5 (e2e/personas/p05.ts, phase-05 plan 6.7): every reset then removes the user's P5 rows (@repo/db/seed/p05-personas
 * `clearP05State`: bank, cards, attempts, sessions, days, mastery, profile, their reports); a P5 persona writes its own
 * (`writeP05Persona`: its analysed games, the bank built from their key moments, schedules relative to `now`, the
 * profile and streak). The domain functions come from their owners (./p05-deps.ts). `dev-trial` writes P4's
 * `import-trial` state first. The dev seed of the plan's names (`member`, `caughtup`, …) is e2e/scripts/seed-training.ts.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parse as parseEnv } from "dotenv";
import { P01_PERSONAS, type BillingColumns, type Persona } from "../../e2e/personas/p01";
import { P03_PERSONAS, isP03Persona } from "../../e2e/personas/p03";
import { P04_PERSONAS, isP04Persona } from "../../e2e/personas/p04";
import { P05_PERSONAS, isP05Persona } from "../../e2e/personas/p05";
import { PERSONA_LETTER, letterEmail, poolEmail, POOL_SIZE, roleOfEmail } from "../../e2e/fixtures/users";
import { computeClaims, type ClaimsRecord } from "../../lib/auth/claims";
import {
  DEV_ENV_FILE,
  MAX_TARGET_USERS,
  SeedGuardError,
  assertDevTarget,
  assertUserTripwire,
  hostOf,
  resolveEnvVar,
} from "@repo/db/seed-guards";

export const PERSONAS: Record<string, Persona> = { ...P01_PERSONAS, ...P03_PERSONAS, ...P04_PERSONAS, ...P05_PERSONAS };

/** Plan §4 personas row: the user-count tripwire comes from prisma/seed-guards.ts (SPEC 11.2 guard 5, <= 60). */
export const PERSONA_USER_TRIPWIRE = MAX_TARGET_USERS;

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

/** Dev endpoint or a local Docker Postgres (CI). Returns the host. */
export function assertPersonaTarget(url: string | undefined | null): string {
  const host = hostOf(url);
  if (LOCAL_HOSTS.has(host)) return host;
  return assertDevTarget(url);
}

/**
 * Resolves `--reset` to an email: `E2E_POOL_07`, `07`, `7`, `S`, or a pool/S
 * email. Anything else (shared letters, admin, real users) is refused.
 */
export function resolvePersonaTarget(arg: string, env: Record<string, string | undefined> = process.env): string {
  const a = arg.trim();
  const pool = /^(?:E2E_POOL_)?(\d{1,2})$/i.exec(a);
  if (pool) {
    const n = Number(pool[1]);
    if (n < 1 || n > POOL_SIZE) throw new SeedGuardError(`pool user ${a} is outside 1..${POOL_SIZE}`);
    return poolEmail(n, env);
  }
  if (a.toUpperCase() === PERSONA_LETTER) return letterEmail(PERSONA_LETTER, env);
  if (/^[A-R]$/i.test(a)) {
    throw new SeedGuardError(`refusing: ${a.toUpperCase()} is a shared E2E user; personas run on pool users or S`);
  }
  if (a.includes("@")) {
    const role = roleOfEmail(a, env);
    if (role === "pool" || role === "persona") return a;
    throw new SeedGuardError(`refusing: ${a} is not a pool user or S (role: ${role ?? "not an E2E user"})`);
  }
  throw new SeedGuardError(`--reset expects E2E_POOL_NN, NN, S or a pool email; got "${a}"`);
}

export function getPersona(name: string): Persona {
  const persona = PERSONAS[name];
  if (!persona) throw new SeedGuardError(`unknown persona "${name}" (known: ${Object.keys(PERSONAS).join(", ")})`);
  return persona;
}

/** The column values one reset writes. Pure, for tests and --dry-run. */
export function personaRow(email: string, persona: Persona, now: Date) {
  const b: BillingColumns = persona.billing(now);
  return {
    plan: b.plan,
    planInterval: b.planInterval,
    subscriptionId: b.hasSubscription ? `e2e_persona_${email}` : null,
    subscriptionStatus: b.subscriptionStatus,
    subscriptionProductId: b.subscriptionProductId,
    currentPeriodEnd: b.currentPeriodEnd,
    cancelAtPeriodEnd: b.cancelAtPeriodEnd,
    subscriptionUpdatedAt: b.subscriptionUpdatedAt,
    trialStartedAt: b.trialStartedAt,
    trialEndsAt: b.trialEndsAt,
  };
}

type ResetOptions = { now?: Date; dryRun?: boolean; databaseUrl?: string; log?: (line: string) => void };

function devEnvFile(): Record<string, string> {
  const webDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
  try {
    return parseEnv(readFileSync(path.join(webDir, DEV_ENV_FILE)));
  } catch {
    return {}; // CI has no env file; the shell provides the values.
  }
}

/** HASH_PEPPER and CLERK_SECRET_KEY from the shell, else .env.development.local (P4 resets need both). */
function p04Env(): { pepper: string | undefined; clerkKey: string | undefined } {
  const file = devEnvFile();
  return { pepper: process.env.HASH_PEPPER || file.HASH_PEPPER, clerkKey: process.env.CLERK_SECRET_KEY || file.CLERK_SECRET_KEY };
}

/** Loads DIRECT_URL from the shell or .env.development.local (never .env.local). */
function resolveTargetUrl(): { url: string; origin: string } {
  const fileValues = devEnvFile();
  const resolved = resolveEnvVar(
    "DIRECT_URL",
    process.env.DIRECT_URL || process.env.DATABASE_URL,
    fileValues.DIRECT_URL || fileValues.DATABASE_URL,
  );
  return { url: resolved.value, origin: resolved.origin };
}

export async function resetPersona(target: string, personaName: string, opts: ResetOptions = {}) {
  const log = opts.log ?? ((line: string) => console.log(line));
  const email = resolvePersonaTarget(target);
  const persona = getPersona(personaName);
  const now = opts.now ?? new Date();
  const row = personaRow(email, persona, now);

  const { url, origin } = opts.databaseUrl ? { url: opts.databaseUrl, origin: "argument" } : resolveTargetUrl();
  const host = assertPersonaTarget(url);
  log(`[personas] target host ${host} (from ${origin}); ${email} → ${persona.name}`);
  if (opts.dryRun) {
    log(`[personas] dry run: ${JSON.stringify(row)}${isP03Persona(persona) ? ` games ${JSON.stringify(persona.games)}` : ""}`);
    return { email, persona: persona.name, row, applied: false, refs: {} as Record<string, string> };
  }

  // A P5 persona's domain functions are loaded and probed before the first write, so a missing module (or a changed
  // signature) fails the reset with nothing written instead of after the user row, games and P4 state are replaced.
  const p05Deps = isP05Persona(persona) ? await (await import("./p05-deps")).loadTrainingDeps() : undefined;

  const { PrismaClient } = await import("@repo/db");
  const db = new PrismaClient({ datasourceUrl: url });
  try {
    const [users] = await db.$queryRaw<Array<{ count: bigint }>>`SELECT count(*)::bigint AS count FROM users`;
    assertUserTripwire(users?.count ?? -1, PERSONA_USER_TRIPWIRE);
    const updated = await db.$transaction(async (tx) => {
      const n = await tx.$executeRaw`
        UPDATE users SET
          "plan" = ${row.plan},
          "planInterval" = ${row.planInterval},
          "subscriptionId" = ${row.subscriptionId},
          "subscriptionStatus" = ${row.subscriptionStatus},
          "subscriptionProductId" = ${row.subscriptionProductId},
          "currentPeriodEnd" = ${row.currentPeriodEnd},
          "cancelAtPeriodEnd" = ${row.cancelAtPeriodEnd},
          "subscriptionUpdatedAt" = ${row.subscriptionUpdatedAt},
          "trialStartedAt" = ${row.trialStartedAt},
          "trialEndsAt" = ${row.trialEndsAt},
          "updatedAt" = now()
        WHERE email = ${email}`;
      // M1 adds subscriptionSourceAt (the billing compare-and-set key). Clear it when
      // present so the next real webhook for this user is never judged stale.
      const [column] = await tx.$queryRaw<Array<{ has: boolean }>>`
        SELECT EXISTS (SELECT 1 FROM information_schema.columns
          WHERE table_name = 'users' AND column_name = 'subscriptionSourceAt') AS has`;
      if (column?.has && n > 0) await tx.$executeRaw`UPDATE users SET "subscriptionSourceAt" = NULL WHERE email = ${email}`;
      return n;
    });
    if (updated !== 1) {
      throw new SeedGuardError(
        `no users row for ${email}; provision the pool first (npx tsx e2e/scripts/provision-test-users.ts --pool)`,
      );
    }
    // Phase 3: the persona's games (exact: everything else of this user is deleted first).
    let refs: Record<string, string> = {};
    if (isP03Persona(persona)) {
      const { clearMemberGames, writePersonaFixtures } = await import("@repo/db/seed/review");
      if (persona.games.clear) {
        const n = await clearMemberGames(db, email);
        log(`[personas] cleared ${n} game(s) of ${email}`);
      }
      if (persona.games.fixtures.length > 0) refs = await writePersonaFixtures(db, email, persona.games.fixtures, { log });
    }
    // Phase 4: clear any P4 state (every reset), then write the P4 persona's; then the Clerk claims.
    const env = p04Env();
    if (!env.pepper) throw new SeedGuardError("HASH_PEPPER is not set (needed for the trial-ledger rows of a reset)");
    process.env.HASH_PEPPER ??= env.pepper;
    const { clearP04State, writeP04Persona } = await import("@repo/db/seed/p04-personas");
    const { trialLedgerEmailHash, handleHash } = await import("../../lib/billing/trial-ledger");
    const ledger = {
      emailHash: (e: string) => trialLedgerEmailHash(e),
      handleHash: (p: "chesscom" | "lichess", u: string, v: boolean) => handleHash(p, u, v),
    };
    const p04Name = isP04Persona(persona) ? persona.p04 : isP05Persona(persona) ? persona.p04 : undefined;
    if (p04Name) await writeP04Persona(db, email, p04Name, { now, ledger, log });
    else await clearP04State(db, email, { now, ledger, log });
    // Phase 5: clear the user's bank and training rows (every reset), then write the P5 persona's.
    const { clearP05State, writeP05Persona } = await import("@repo/db/seed/p05-personas");
    if (isP05Persona(persona) && p05Deps) {
      const p5 = await writeP05Persona(db, email, persona.p05, { now, deps: p05Deps, log });
      refs = { ...refs, ...p5.gameRefs };
    } else {
      await clearP05State(db, email, { log });
    }
    await syncPersonaClaims(db, email, env.clerkKey, now, log);
    log(`[personas] applied ${persona.name} to ${email}`);
    return { email, persona: persona.name, row, applied: true, refs };
  } finally {
    await db.$disconnect();
  }
}

/** Writes the user's P1 claims to Clerk (development key only; a missing key or a non-Clerk user is logged, not fatal). */
async function syncPersonaClaims(
  db: { $queryRaw: <T>(q: TemplateStringsArray, ...v: unknown[]) => Promise<T> },
  email: string,
  clerkKey: string | undefined,
  now: Date,
  log: (line: string) => void,
) {
  if (!clerkKey?.startsWith("sk_test_")) {
    log("[personas] Clerk claims not synced (no development CLERK_SECRET_KEY)");
    return;
  }
  const rows = await db.$queryRaw<Array<ClaimsRecord & { googleId: string }>>`
    SELECT "googleId", onboarded, role::text AS role, "subscriptionId", "subscriptionStatus", "cancelAtPeriodEnd",
           ("currentPeriodEnd" AT TIME ZONE 'UTC') AS "currentPeriodEnd", ("trialStartedAt" AT TIME ZONE 'UTC') AS "trialStartedAt"
      FROM users WHERE email = ${email}`;
  const row = rows[0];
  if (!row?.googleId.startsWith("user_")) return;
  const { clerkHttpApi } = await import("../backfill/clerk-onboarded-claims");
  await clerkHttpApi({ key: clerkKey }).mergePublicMetadata(row.googleId, computeClaims(row, now));
  log("[personas] Clerk claims synced");
}

function parseArgs(argv: string[]) {
  const out: { reset?: string; persona?: string; dryRun: boolean; list: boolean } = { dryRun: false, list: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--reset") out.reset = argv[++i];
    else if (a === "--persona") out.persona = argv[++i];
    else if (a === "--dry-run") out.dryRun = true;
    else if (a === "--list") out.list = true;
    else throw new SeedGuardError(`unknown argument ${a}`);
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.list) {
    for (const p of Object.values(PERSONAS)) console.log(`${p.name.padEnd(18)} p${p.phase}  ${p.description}`);
    return;
  }
  if (!args.reset || !args.persona) {
    throw new SeedGuardError("usage: personas.ts --reset <E2E_POOL_NN|S> --persona <name> [--dry-run] | --list");
  }
  await resetPersona(args.reset, args.persona, { dryRun: args.dryRun });
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((err) => {
    console.error(err instanceof SeedGuardError ? `[personas] ${err.message}` : err);
    process.exit(1);
  });
}
