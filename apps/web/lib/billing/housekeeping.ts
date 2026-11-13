// Billing housekeeping (phase-04 plan 7.11, 6.1): a checkout that never completed leaves `pendingCheckout*` on the
// users row. The activation DAL compares a recorded payment failure with `pendingCheckoutAt`, and the onboarding
// resolver treats a fresh pending checkout as "activating", so the columns are cleared once they are a day old and the
// user is still not entitled (an entitled user's columns are cleared by the fan-out the moment the trial starts).
//
//   clearStaleCheckoutsSql(now) → Prisma.Sql   one UPDATE, guarded by the same "entitled" rule as isEntitled()
//   clearStaleCheckouts(db, now) → rows cleared (idempotent: a second run clears 0)
//
// Run daily by the cron task `stale-checkout` (lib/cron/tasks/stale-checkout.ts).
import { Prisma } from "@repo/db";

/** A pending checkout older than this is abandoned for good (the resolver gives up after 30 min, PENDING_CHECKOUT_TTL_MS). */
export const STALE_CHECKOUT_AFTER_MS = 24 * 60 * 60_000;

/** Anything that runs one Prisma.Sql statement (rawDb(prisma), a transaction client, a test fake). */
export type HousekeepingDb = { $executeRaw(query: Prisma.Sql): PromiseLike<number> };

export function clearStaleCheckoutsSql(now: Date): Prisma.Sql {
  if (Number.isNaN(now.getTime())) throw new Error("clearStaleCheckoutsSql: invalid now");
  const at = now.toISOString();
  const cutoff = new Date(now.getTime() - STALE_CHECKOUT_AFTER_MS).toISOString();
  // Entitled (entitlement-rules.ts isEntitled): active; on_hold/past_due inside the paid period; cancelled at period
  // end inside the period. Everyone else is "not entitled".
  return Prisma.sql`UPDATE users SET "pendingCheckoutSessionId" = NULL, "pendingCheckoutPlan" = NULL, "pendingCheckoutAt" = NULL
WHERE "pendingCheckoutAt" IS NOT NULL
  AND "pendingCheckoutAt" < ${cutoff}::timestamp(3)
  AND NOT (
    COALESCE("subscriptionStatus", '') = 'active'
    OR (COALESCE("subscriptionStatus", '') IN ('on_hold', 'past_due') AND "currentPeriodEnd" > ${at}::timestamp(3))
    OR (COALESCE("subscriptionStatus", '') = 'cancelled' AND "cancelAtPeriodEnd" AND "currentPeriodEnd" > ${at}::timestamp(3))
  )`;
}

export async function clearStaleCheckouts(db: HousekeepingDb, now: Date): Promise<number> {
  return db.$executeRaw(clearStaleCheckoutsSql(now));
}
