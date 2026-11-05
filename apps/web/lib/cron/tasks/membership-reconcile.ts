/**
 * Cron task `membership-reconcile` (plan §7.8, P1-18): heals billing rows whose
 * non-terminal subscription period ended more than an hour ago without a webhook
 * moving them on (a missed renewal or expiry event).
 *
 * At most 50 users a day, oldest period end first. For each: Dodo
 * `subscriptions.retrieve`, calls spaced 200 ms apart, then the billing
 * compare-and-set apply (`applySubscriptionSnapshot`, source "api"), and a Clerk
 * claims sync in `after()` when the apply wrote. P10 extends this task.
 */
import type { SubscriptionSnapshot } from "@/lib/billing/entitlement-rules";
import type { CronContext, CronTask } from "./index";

export const RECONCILE_LIMIT = 50;
export const RECONCILE_SPACING_MS = 200;
/** Stop after this many Dodo failures in a row (an outage, a bad key). */
export const RECONCILE_MAX_CONSECUTIVE_ERRORS = 3;

/** Served by `users_subscriptionStatus_idx`; filter on period end (plan §6.3). */
export const RECONCILE_CANDIDATES_SQL = `SELECT "id", "subscriptionId" FROM "users"
WHERE "subscriptionStatus" IN ('active', 'on_hold', 'past_due', 'pending')
  AND "currentPeriodEnd" < (now() AT TIME ZONE 'UTC') - interval '1 hour'
  AND "dodoCustomerId" IS NOT NULL
  AND "subscriptionId" IS NOT NULL
ORDER BY "currentPeriodEnd"
LIMIT $1`;

export type ReconcileCandidate = { id: bigint; subscriptionId: string };

/** `changed` = the apply wrote the row (claims need a sync). */
export type ReconcileOutcome = "changed" | "unchanged" | "stale" | "unmatched" | "error";

export type ReconcileDeps = {
  /** False skips the task (e.g. no Dodo API key in this environment). */
  enabled: () => boolean;
  listCandidates: (limit: number) => Promise<ReconcileCandidate[]>;
  retrieve: (subscriptionId: string) => Promise<SubscriptionSnapshot>;
  apply: (snapshot: SubscriptionSnapshot, userId: bigint) => Promise<ReconcileOutcome>;
  /** Clerk claims sync for a user whose row changed; runs in `after()`. */
  syncClaims?: (userId: bigint) => Promise<void>;
  /** Logs a per-user failure (never the payload). */
  onError: (userId: bigint, err: unknown) => void;
};

/**
 * Maps what `applySubscriptionSnapshot` returns to an outcome. Handles both the
 * Phase 0 shape (an entitlement summary, or null when no user matched or the
 * snapshot was stale) and the F4b compare-and-set shape (`{ status, changed? }`).
 */
export function outcomeOf(result: unknown): ReconcileOutcome {
  if (result === null || result === undefined) return "unmatched";
  if (typeof result === "object" && "status" in result) {
    const { status, changed } = result as { status: unknown; changed?: unknown };
    if (status === "applied") return changed === false ? "unchanged" : "changed";
    if (status === "stale") return "stale";
    if (status === "unmatched") return "unmatched";
    if (status === "error") return "error";
  }
  return "changed";
}

const defaultDeps: ReconcileDeps = {
  enabled: () => Boolean(process.env.DODO_PAYMENTS_API_KEY),
  async listCandidates(limit) {
    const { prisma } = await import("@/lib/prisma");
    return prisma.$queryRawUnsafe<ReconcileCandidate[]>(RECONCILE_CANDIDATES_SQL, limit);
  },
  async retrieve(subscriptionId) {
    const { dodo } = await import("@/lib/dodo");
    return dodo.subscriptions.retrieve(subscriptionId);
  },
  async apply(snapshot, userId) {
    const { applySubscriptionSnapshot } = await import("@/lib/billing/entitlement");
    const result: unknown = await applySubscriptionSnapshot(snapshot, { source: "api", userId });
    return outcomeOf(result);
  },
  onError(userId, err) {
    void import("@/lib/logger")
      .then(({ logger }) =>
        logger.warn(
          `[cron] membership-reconcile: user ${userId} failed: ${err instanceof Error ? err.message : String(err)}`,
        ),
      )
      .catch(() => {});
  },
  // syncClaims: wired to `syncClerkClaims` from lib/auth/claims.ts once 1B·F4b lands.
};

export function createMembershipReconcile(overrides: Partial<ReconcileDeps> = {}): CronTask {
  const deps: ReconcileDeps = { ...defaultDeps, ...overrides };
  return {
    name: "membership-reconcile",
    async run(ctx: CronContext) {
      if (!deps.enabled()) return { count: 0, detail: { disabled: 1 } };

      const candidates = (await deps.listCandidates(RECONCILE_LIMIT)).slice(0, RECONCILE_LIMIT);
      const tally = { checked: 0, changed: 0, unchanged: 0, stale: 0, unmatched: 0, errors: 0, skipped: 0 };
      let consecutiveErrors = 0;

      for (const [i, candidate] of candidates.entries()) {
        if (i > 0) await ctx.sleep(RECONCILE_SPACING_MS);
        if (ctx.clock() >= ctx.deadlineMs || consecutiveErrors >= RECONCILE_MAX_CONSECUTIVE_ERRORS) {
          tally.skipped = candidates.length - i;
          break;
        }
        tally.checked++;
        let outcome: ReconcileOutcome;
        try {
          const snapshot = await deps.retrieve(candidate.subscriptionId);
          outcome = await deps.apply(snapshot, candidate.id);
        } catch (err) {
          deps.onError(candidate.id, err);
          outcome = "error";
        }
        consecutiveErrors = outcome === "error" ? consecutiveErrors + 1 : 0;
        if (outcome === "error") tally.errors++;
        else tally[outcome]++;

        const sync = deps.syncClaims;
        if (outcome === "changed" && sync) {
          const userId = candidate.id;
          ctx.after(() => sync(userId));
        }
      }

      return { count: tally.checked, detail: tally };
    },
  };
}

export const membershipReconcile = createMembershipReconcile();
