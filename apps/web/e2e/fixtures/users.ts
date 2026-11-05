// E2E user registry (phase-01 plan §12.0, CT X4). Pure data and helpers: no
// Playwright import, so global setup, scripts and unit tests can load it.
//
// Roles:
// - A–P  shared members. Specs may only ADD data to them (create games, grade
//        cards) and must never assert absolute counts on them.
// - Q    trial used, read-only.        R  never trialled, read-only.
// - S    the dedicated payment-persona user (scripts/dev/personas.ts).
// - admin  E2E_ADMIN_EMAIL, a separate login, not a letter.
// - pool   E2E_POOL_01…24: permanent Clerk dev users that `leasePersona()`
//          resets to an exact state (e2e/fixtures/lease.ts).
// - throwaway  e2e-<flow>-<runId>@…+clerk_test, created by truly destructive
//          flows and removed by e2e/scripts/sweep-throwaway-users.ts after 2 h.

export const SHARED_MEMBER_LETTERS = "ABCDEFGHIJKLMNOP".split("") as readonly string[];
export const READ_ONLY_LETTERS = ["Q", "R"] as const;
export const PERSONA_LETTER = "S";
export const ALL_LETTERS = [...SHARED_MEMBER_LETTERS, ...READ_ONLY_LETTERS, PERSONA_LETTER] as readonly string[];

export const POOL_SIZE = 24;
/** Pool slots one Playwright worker may hold at once (slot = parallelIndex × this + index). */
export const POOL_SLOTS_PER_WORKER = 2;

export type UserRole = "shared-member" | "read-only" | "persona" | "admin" | "pool" | "throwaway";

/** Email domain of every provisioned E2E user ("+clerk_test" accepts code 424242 on Clerk dev). */
export const E2E_EMAIL_DOMAIN = "chessbattle.dev";

export function letterEmailDefault(letter: string): string {
  return `e2e-player${letter.toLowerCase()}+clerk_test@${E2E_EMAIL_DOMAIN}`;
}

/** Two-digit pool id, 1-based: poolId(1) === "01". */
export function poolId(n: number): string {
  if (!Number.isInteger(n) || n < 1 || n > POOL_SIZE) throw new Error(`pool user ${n} is outside 1..${POOL_SIZE}`);
  return String(n).padStart(2, "0");
}

export function poolEnvKey(n: number): string {
  return `E2E_POOL_${poolId(n)}_EMAIL`;
}

export function poolEmailDefault(n: number): string {
  return `e2e-pool${poolId(n)}+clerk_test@${E2E_EMAIL_DOMAIN}`;
}

type Env = Record<string, string | undefined>;

/** The email for a letter: `E2E_USER_<L>_EMAIL`, else the provisioning default. */
export function letterEmail(letter: string, env: Env = process.env): string {
  const l = letter.toUpperCase();
  if (!ALL_LETTERS.includes(l)) throw new Error(`unknown E2E user letter "${letter}"`);
  return env[`E2E_USER_${l}_EMAIL`] || letterEmailDefault(l);
}

export function poolEmail(n: number, env: Env = process.env): string {
  return env[poolEnvKey(n)] || poolEmailDefault(n);
}

export function adminEmail(env: Env = process.env): string | null {
  return env.E2E_ADMIN_EMAIL || null;
}

/** Display name the provisioning script gives a letter or pool user. */
export function displayNameFor(id: string): string {
  return /^\d+$/.test(id) ? `TestPool${poolId(Number(id))} E2E` : `TestPlayer${id.toUpperCase()} E2E`;
}

export function roleOfLetter(letter: string): UserRole {
  const l = letter.toUpperCase();
  if (SHARED_MEMBER_LETTERS.includes(l)) return "shared-member";
  if ((READ_ONLY_LETTERS as readonly string[]).includes(l)) return "read-only";
  if (l === PERSONA_LETTER) return "persona";
  throw new Error(`unknown E2E user letter "${letter}"`);
}

/** Local parts of permanent E2E users, never swept: e2e-player<x>, e2e-pool<NN>, e2e-admin…, e2e-persona…. */
export const PERMANENT_PATTERN = /^e2e-(player[a-z]|pool\d{2}|admin[a-z0-9]*|persona[a-z0-9]*)(\+[^@]*)?@/;

/**
 * Classifies an email. Anything that is not a registered user and starts with
 * `e2e-` is a throwaway user the sweeper may delete.
 */
export function roleOfEmail(email: string, env: Env = process.env): UserRole | null {
  const e = email.toLowerCase();
  if (adminEmail(env)?.toLowerCase() === e) return "admin";
  for (const l of ALL_LETTERS) {
    if (letterEmail(l, env).toLowerCase() === e || letterEmailDefault(l) === e) return roleOfLetter(l);
  }
  for (let n = 1; n <= POOL_SIZE; n++) {
    if (poolEmail(n, env).toLowerCase() === e || poolEmailDefault(n) === e) return "pool";
  }
  // Belt and braces: never classify the permanent naming patterns as throwaway,
  // with or without a "+tag" (older provisioning runs created e2e-playera@… too).
  if (PERMANENT_PATTERN.test(e)) return null;
  if (e.startsWith("e2e-") && e.endsWith(`@${E2E_EMAIL_DOMAIN}`)) return "throwaway";
  return null;
}

/** `e2e-<flow>-<runId>+clerk_test@chessbattle.dev` for a destructive flow (P10 deletion, P11 sign-up). */
export function throwawayEmail(flow: string, runId: string): string {
  const clean = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "").slice(0, 24);
  return `e2e-${clean(flow)}-${clean(runId)}+clerk_test@${E2E_EMAIL_DOMAIN}`;
}

/** Pool user number (1-based) for a worker's slot; throws when the pool is exhausted. */
export function poolSlot(parallelIndex: number, index = 0): number {
  if (index < 0 || index >= POOL_SLOTS_PER_WORKER) {
    throw new Error(`a worker may lease at most ${POOL_SLOTS_PER_WORKER} personas at once (index ${index})`);
  }
  const n = parallelIndex * POOL_SLOTS_PER_WORKER + index + 1;
  if (n > POOL_SIZE) {
    throw new Error(
      `persona pool exhausted: worker ${parallelIndex} slot ${index} needs pool user ${n} of ${POOL_SIZE}. ` +
        `Run with at most ${Math.floor(POOL_SIZE / POOL_SLOTS_PER_WORKER)} workers.`,
    );
  }
  return n;
}

/** Every email and display name of the registry, for the telemetry PII guard. */
export function knownIdentities(env: Env = process.env): string[] {
  const out = new Set<string>();
  for (const l of ALL_LETTERS) {
    out.add(letterEmail(l, env));
    out.add(displayNameFor(l));
  }
  for (let n = 1; n <= POOL_SIZE; n++) {
    out.add(poolEmail(n, env));
    out.add(displayNameFor(String(n)));
  }
  const admin = adminEmail(env);
  if (admin) out.add(admin);
  return [...out];
}

/**
 * Helpers that overwrite a user's state. Specs may call them only on pool
 * users (through leasePersona) or on throwaway users; users.test.ts fails a
 * spec that names a shared letter in the same file as one of these.
 */
export const MUTATING_HELPERS = ["resetPersona", "setPersona", "deleteUserRows", "--persona", "--reset"] as const;
