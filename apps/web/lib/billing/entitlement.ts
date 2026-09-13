import "server-only";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import {
  fieldsFromSnapshot,
  shouldApplySnapshot,
  summarizeEntitlement,
  type EntitlementRecord,
  type EntitlementSummary,
  type SubscriptionSnapshot,
} from "./entitlement-rules";
import { getProductCatalog } from "./products";

export type { EntitlementRecord, EntitlementSummary, SubscriptionSnapshot };
export { isEntitled } from "./entitlement-rules";

/** Prisma `select` covering everything entitlement needs. */
export const ENTITLEMENT_SELECT = {
  plan: true,
  planInterval: true,
  subscriptionId: true,
  subscriptionStatus: true,
  subscriptionProductId: true,
  currentPeriodEnd: true,
  cancelAtPeriodEnd: true,
  subscriptionUpdatedAt: true,
} as const;

export function summarizeUserEntitlement(record: EntitlementRecord): EntitlementSummary {
  return summarizeEntitlement(record, getProductCatalog());
}

interface ApplyOptions {
  /** When the event happened, used to discard stale, out-of-order webhooks. */
  eventTime?: Date | null;
  /** Where the snapshot came from, for logs. */
  source: "webhook" | "api";
  /** Restrict the update to this user when the caller already knows them. */
  userId?: bigint;
}

/**
 * Writes a Dodo subscription onto the matching user row.
 *
 * The user is found by Dodo customer ID first, then by email (which also
 * backfills the customer ID). Returns the updated entitlement, or null when no
 * user matched or the snapshot was older than what is stored.
 */
export async function applySubscriptionSnapshot(
  snapshot: SubscriptionSnapshot,
  options: ApplyOptions,
): Promise<EntitlementSummary | null> {
  const customerId = snapshot.customer?.customer_id;
  const email = snapshot.customer?.email;

  const user =
    (options.userId
      ? await prisma.user.findUnique({
          where: { id: options.userId },
          select: { id: true, dodoCustomerId: true, ...ENTITLEMENT_SELECT },
        })
      : null) ??
    (customerId
      ? await prisma.user.findUnique({
          where: { dodoCustomerId: customerId },
          select: { id: true, dodoCustomerId: true, ...ENTITLEMENT_SELECT },
        })
      : null) ??
    (email
      ? await prisma.user.findUnique({
          where: { email },
          select: { id: true, dodoCustomerId: true, ...ENTITLEMENT_SELECT },
        })
      : null);

  if (!user) {
    logger.warn(
      `[billing] No user for subscription ${snapshot.subscription_id} (customer ${customerId ?? "?"}, ${email ?? "no email"}) from ${options.source}`,
    );
    return null;
  }

  const eventTime = options.eventTime ?? null;
  if (!shouldApplySnapshot(user, snapshot, eventTime)) {
    logger.debug(
      `[billing] Ignoring stale ${snapshot.status} snapshot for ${snapshot.subscription_id} (${options.source})`,
    );
    return summarizeUserEntitlement(user);
  }

  const fields = fieldsFromSnapshot(snapshot, getProductCatalog(), eventTime);
  const updated = await prisma.user.update({
    where: { id: user.id },
    data: {
      ...fields,
      // Backfill the customer link when it is missing or belongs to this customer.
      ...(customerId && user.dodoCustomerId !== customerId && !user.dodoCustomerId
        ? { dodoCustomerId: customerId }
        : {}),
    },
    select: ENTITLEMENT_SELECT,
  });

  logger.info(
    `[billing] ${options.source}: user ${user.id} -> ${fields.subscriptionStatus} (${fields.planInterval}) until ${fields.currentPeriodEnd?.toISOString() ?? "?"}`,
  );

  return summarizeUserEntitlement(updated);
}
