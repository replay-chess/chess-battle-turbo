// Safety guards for scripts that write to the dev database (SPEC §11.2, 05 §4.2).
//
// Pure functions only: no I/O, no Prisma import. The content seed
// (`prisma/seed-content.ts`) and the persona tool (`scripts/dev/personas.ts`,
// 1Q·1) call these before any write.
//
// The allow-list names the CURRENT dev endpoint: branch `dev` of Neon project
// `withered-cake-82837167`. H10 (moving dev to its own Neon project) is
// deferred; when it lands, change DEV_HOST_ALLOWLIST to the new endpoint host.
// There is deliberately no override flag: changing the target needs a code edit.

/** The only env file the dev-write scripts load. Never `.env.local` (old prod). */
export const DEV_ENV_FILE = ".env.development.local";

/** Dev endpoint host, direct or `-pooler`. */
export const DEV_HOST_ALLOWLIST = /^ep-fancy-dust-b8b3dp81(-pooler)?\.c-14\.us-east-1\.aws\.neon\.tech$/;

/**
 * Abort when the target has more users than this (SPEC 11.2 guard 5: `SELECT count(*) FROM users` <= 60).
 * Dev has ~24, about 49 once the e2e persona pool (24) and S are provisioned (1Q·1); old prod had 104.
 * scripts/dev/personas.ts uses the same limit. Raise it only by changing the SPEC first.
 */
export const MAX_TARGET_USERS = 60;

export class SeedGuardError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SeedGuardError";
  }
}

/** Hostname of a Postgres URL. Throws a guard error (never echoing the URL) when it does not parse. */
export function hostOf(url: string | undefined | null): string {
  if (!url || url.trim() === "") throw new SeedGuardError("database URL is empty");
  let parsed: URL;
  try {
    parsed = new URL(url.trim());
  } catch {
    throw new SeedGuardError("database URL does not parse (value not printed)");
  }
  if (parsed.protocol !== "postgres:" && parsed.protocol !== "postgresql:") {
    throw new SeedGuardError(`database URL has protocol ${parsed.protocol}, expected postgres:`);
  }
  const host = parsed.hostname.toLowerCase();
  if (!host) throw new SeedGuardError("database URL has no host");
  return host;
}

export function isDevHost(host: string): boolean {
  return DEV_HOST_ALLOWLIST.test(host.toLowerCase());
}

/** Guard 2: the target must be the dev endpoint. Returns its host. */
export function assertDevTarget(url: string | undefined | null): string {
  const host = hostOf(url);
  if (!isDevHost(host)) {
    throw new SeedGuardError(`refusing to write: target host ${host} is not the dev endpoint`);
  }
  return host;
}

/** Guard 4: a source database must be neither the target nor any dev host. Returns the source host. */
export function assertSourceNotTarget(sourceUrl: string | undefined | null, targetHost: string): string {
  const host = hostOf(sourceUrl);
  if (host === targetHost.toLowerCase()) {
    throw new SeedGuardError(`refusing: source host ${host} equals the target host`);
  }
  if (isDevHost(host)) {
    throw new SeedGuardError(`refusing: source host ${host} is a dev endpoint`);
  }
  return host;
}

/** Guard 5: the user-count tripwire. */
export function assertUserTripwire(userCount: number | bigint, max: number = MAX_TARGET_USERS): void {
  const n = typeof userCount === "bigint" ? Number(userCount) : userCount;
  if (!Number.isFinite(n) || n < 0) {
    throw new SeedGuardError(`user tripwire: could not read the user count (${String(userCount)})`);
  }
  if (n > max) {
    throw new SeedGuardError(`user tripwire: target has ${n} users (> ${max}); it looks like production`);
  }
}

export type EnvOrigin = "file" | "shell" | "shell (differs from file)";

export interface ResolvedEnvVar {
  value: string;
  origin: EnvOrigin;
}

/**
 * Guard 1 helper. dotenv never overrides an exported variable, so a value
 * exported in the shell wins over the file. This says which one is in effect.
 * `shellValue` is the variable as it was BEFORE loading the file.
 */
export function resolveEnvVar(
  name: string,
  shellValue: string | undefined,
  fileValue: string | undefined,
): ResolvedEnvVar {
  if (shellValue !== undefined && shellValue !== "") {
    return {
      value: shellValue,
      origin: fileValue !== undefined && fileValue !== shellValue ? "shell (differs from file)" : "shell",
    };
  }
  if (fileValue !== undefined && fileValue !== "") return { value: fileValue, origin: "file" };
  throw new SeedGuardError(`${name} is not set in ${DEV_ENV_FILE} or the shell`);
}
