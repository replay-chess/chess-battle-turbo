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
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parse as parseEnv } from "dotenv";
import { P01_PERSONAS, type BillingColumns, type Persona } from "../../e2e/personas/p01";
import { PERSONA_LETTER, letterEmail, poolEmail, POOL_SIZE, roleOfEmail } from "../../e2e/fixtures/users";
import {
  DEV_ENV_FILE,
  MAX_TARGET_USERS,
  SeedGuardError,
  assertDevTarget,
  assertUserTripwire,
  hostOf,
  resolveEnvVar,
} from "../../prisma/seed-guards";

export const PERSONAS: Record<string, Persona> = { ...P01_PERSONAS };

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

/** Loads DIRECT_URL from the shell or .env.development.local (never .env.local). */
function resolveTargetUrl(): { url: string; origin: string } {
  const webDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
  let fileValues: Record<string, string> = {};
  try {
    fileValues = parseEnv(readFileSync(path.join(webDir, DEV_ENV_FILE)));
  } catch {
    // CI has no env file; the shell must provide the URL.
  }
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
    log(`[personas] dry run: ${JSON.stringify(row)}`);
    return { email, persona: persona.name, row, applied: false };
  }

  const { PrismaClient } = await import("../../app/generated/prisma/index.js");
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
    log(`[personas] applied ${persona.name} to ${email}`);
    return { email, persona: persona.name, row, applied: true };
  } finally {
    await db.$disconnect();
  }
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
