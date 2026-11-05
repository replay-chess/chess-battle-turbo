/**
 * Clerk claims (plan phase-01 §8.4). The user's billing and onboarding state is mirrored into Clerk
 * `publicMetadata`; the session token template `{"md": "{{user.public_metadata}}"}` puts it in the JWT
 * as `sessionClaims.md`, so middleware can gate pages without a database read.
 *
 * `entitled` and `lapsed` are gate hints only: every API decides from the database (CDL §6.2).
 *
 * Writers in P1: the Dodo webhook (after an applied snapshot), `POST /api/billing/refresh` and the
 * `membership-reconcile` cron task (when their compare-and-set wrote), the Clerk `user.created`
 * webhook, and `scripts/backfill/sync-clerk-claims.ts`.
 */
import { isEntitled, type EntitlementCore } from "@/lib/billing/entitlement-rules";

export interface RcPublicMetadata {
  v: 1;
  onboarded: boolean;
  entitled: boolean;
  lapsed: boolean;
  trialUsed: boolean;
  role: "ADMIN" | "USER";
}

/** The keys this module owns inside `publicMetadata`. Anything else there is left alone. */
export const CLAIM_KEYS = ["v", "onboarded", "entitled", "lapsed", "trialUsed", "role"] as const satisfies readonly (keyof RcPublicMetadata)[];

/** Claims of a user row Clerk has not heard about yet (the `user.created` webhook writes these). */
export const NEW_USER_CLAIMS: RcPublicMetadata = Object.freeze({
  v: 1,
  onboarded: false,
  entitled: false,
  lapsed: false,
  trialUsed: false,
  role: "USER",
});

/** The columns `computeClaims` reads. */
export type ClaimsRecord = EntitlementCore & {
  onboarded: boolean;
  role: string;
  subscriptionId: string | null;
  trialStartedAt: Date | null;
};

/** Prisma `select` for `ClaimsRecord` plus what `syncClerkClaims` needs. */
export const CLAIMS_SELECT = {
  id: true,
  googleId: true,
  isActive: true,
  onboarded: true,
  role: true,
  subscriptionId: true,
  subscriptionStatus: true,
  currentPeriodEnd: true,
  cancelAtPeriodEnd: true,
  trialStartedAt: true,
} as const;

/** Pure: `entitled = isEntitled(record, now)`; `lapsed = !entitled && (trialUsed || subscriptionId != null)`. */
export function computeClaims(record: ClaimsRecord, now: Date): RcPublicMetadata {
  const entitled = isEntitled(record, now);
  const trialUsed = record.trialStartedAt !== null && record.trialStartedAt !== undefined;
  return {
    v: 1,
    onboarded: Boolean(record.onboarded),
    entitled,
    lapsed: !entitled && (trialUsed || record.subscriptionId !== null),
    trialUsed,
    role: record.role === "ADMIN" ? "ADMIN" : "USER",
  };
}

/** True when `current` (a user's publicMetadata) already holds exactly `claims` for our keys. */
export function claimsMatch(current: unknown, claims: RcPublicMetadata): boolean {
  if (!current || typeof current !== "object") return false;
  const md = current as Record<string, unknown>;
  return CLAIM_KEYS.every((key) => md[key] === claims[key]);
}

export type ClaimsSyncResult = "updated" | "unchanged" | "skipped" | "failed";

export interface ClaimsDeps {
  /** Re-reads the user by id (one statement). */
  readUser(userId: bigint): Promise<(ClaimsRecord & { googleId: string; isActive: boolean }) | null>;
  /** The Clerk user's current publicMetadata. */
  getMetadata(clerkUserId: string): Promise<unknown>;
  /** Clerk `updateUserMetadata` (merges top-level keys). */
  updateMetadata(clerkUserId: string, publicMetadata: RcPublicMetadata): Promise<void>;
  /** Sentry warning `claims_sync_failed` (no payload, no PII). */
  warn(message: string, context: Record<string, string>): void;
  now(): Date;
}

async function defaultDeps(): Promise<ClaimsDeps> {
  const [{ prisma }, { clerkClient }, Sentry] = await Promise.all([
    import("@/lib/prisma"),
    import("@clerk/nextjs/server"),
    import("@sentry/nextjs"),
  ]);
  return {
    readUser: (userId) => prisma.user.findUnique({ where: { id: userId }, select: CLAIMS_SELECT }),
    async getMetadata(clerkUserId) {
      const user = await (await clerkClient()).users.getUser(clerkUserId);
      return user.publicMetadata;
    },
    async updateMetadata(clerkUserId, publicMetadata) {
      await (await clerkClient()).users.updateUserMetadata(clerkUserId, { publicMetadata: { ...publicMetadata } });
    },
    warn(message, context) {
      Sentry.captureMessage(message, { level: "warning", tags: context });
    },
    now: () => new Date(),
  };
}

/**
 * Re-reads the user, computes the claims and writes them to Clerk only when they differ from the
 * current publicMetadata. Never throws: a failure is reported as the Sentry warning
 * `claims_sync_failed` (callers run this inside `after()`, so it must not break a webhook).
 */
export async function syncClerkClaims(userId: bigint, deps?: ClaimsDeps): Promise<void> {
  await syncClerkClaimsDetailed(userId, deps);
}

/** `syncClerkClaims` with the result, for tests and the backfill. */
export async function syncClerkClaimsDetailed(userId: bigint, deps?: ClaimsDeps): Promise<ClaimsSyncResult> {
  let d: ClaimsDeps | undefined = deps;
  try {
    d ??= await defaultDeps();
    const user = await d.readUser(userId);
    if (!user || !user.isActive || !user.googleId) return "skipped";
    const claims = computeClaims(user, d.now());
    const current = await d.getMetadata(user.googleId);
    if (claimsMatch(current, claims)) return "unchanged";
    await d.updateMetadata(user.googleId, claims);
    return "updated";
  } catch (err) {
    const status = err && typeof err === "object" && "status" in err ? String((err as { status: unknown }).status) : "none";
    try {
      d?.warn("claims_sync_failed", { user: String(userId), status });
    } catch {
      // Reporting must not throw either.
    }
    return "failed";
  }
}
