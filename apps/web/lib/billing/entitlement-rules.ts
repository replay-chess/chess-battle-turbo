/**
 * Pure entitlement rules. No database or network access, so this module can be
 * imported from anywhere and unit tested directly. The server-only wrapper in
 * `entitlement.ts` applies these rules to Prisma rows and Dodo payloads.
 */
import type { BillingInterval, ProductCatalog, ResolvedPlan } from "./plans";
import { resolvePlanFromProductId } from "./plans";

/** Dodo subscription statuses, mirrored from the SDK. */
export type SubscriptionStatus =
  | "pending"
  | "active"
  | "on_hold"
  | "paused"
  | "cancelled"
  | "failed"
  | "expired"
  | "past_due";

/** The fields on a user row that decide access. */
export interface EntitlementRecord {
  plan: string | null;
  planInterval: string | null;
  subscriptionId: string | null;
  subscriptionStatus: string | null;
  subscriptionProductId: string | null;
  currentPeriodEnd: Date | null;
  cancelAtPeriodEnd: boolean;
  subscriptionUpdatedAt: Date | null;
}

/**
 * Statuses that keep access until the paid period runs out. A failed renewal
 * that Dodo is retrying and a past-due invoice both leave the customer with
 * time they already paid for.
 *
 * `cancelled` is deliberately not here: Dodo keeps a period-end cancellation
 * `active` (with `cancel_at_next_billing_date=true`) until the billing date,
 * so a subscription that is already `cancelled` was cancelled immediately
 * (portal "cancel now", merchant cancel, refund) and access is revoked now.
 * `isEntitled` handles it explicitly.
 */
export const GRACE_STATUSES: readonly SubscriptionStatus[] = [
  "on_hold",
  "past_due",
];

/** Statuses after which a subscription will never grant access again. */
export const TERMINAL_STATUSES: readonly SubscriptionStatus[] = [
  "cancelled",
  "expired",
  "failed",
];

export function isEntitled(record: EntitlementRecord, now: Date = new Date()): boolean {
  const status = record.subscriptionStatus as SubscriptionStatus | null;
  if (!status) return false;
  if (status === "active") return true;
  if (status === "cancelled") {
    // Dodo keeps a period-end cancellation `active` with
    // cancel_at_next_billing_date=true; status `cancelled` means access was
    // revoked now unless the cancel was scheduled.
    return (
      record.cancelAtPeriodEnd &&
      !!record.currentPeriodEnd &&
      record.currentPeriodEnd.getTime() > now.getTime()
    );
  }
  if (GRACE_STATUSES.includes(status)) {
    return !!record.currentPeriodEnd && record.currentPeriodEnd.getTime() > now.getTime();
  }
  return false;
}

/** The subset of a Dodo subscription we need to update a user row. */
export interface SubscriptionSnapshot {
  subscription_id: string;
  product_id: string;
  status: SubscriptionStatus | string;
  next_billing_date: string | Date;
  cancel_at_next_billing_date: boolean;
  created_at?: string | Date;
  payment_frequency_interval?: "Day" | "Week" | "Month" | "Year" | string;
  customer: { customer_id: string; email: string; name?: string };
}

function toDate(value: string | Date | undefined | null): Date | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function intervalFromSnapshot(snapshot: SubscriptionSnapshot): BillingInterval {
  return snapshot.payment_frequency_interval === "Year" ? "year" : "month";
}

/**
 * Decides whether an incoming snapshot should overwrite what is stored.
 * Webhooks are not ordered, and a customer can hold more than one
 * subscription over time, so we keep whichever record grants the most access.
 */
export function shouldApplySnapshot(
  current: EntitlementRecord,
  snapshot: SubscriptionSnapshot,
  eventTime: Date | null,
  now: Date = new Date(),
): boolean {
  // Nothing stored yet: always apply.
  if (!current.subscriptionId) return true;

  // Same subscription: apply unless the event is older than what we have.
  if (current.subscriptionId === snapshot.subscription_id) {
    if (!eventTime || !current.subscriptionUpdatedAt) return true;
    return eventTime.getTime() >= current.subscriptionUpdatedAt.getTime();
  }

  // Different subscription. Prefer the one that grants access.
  const currentEntitled = isEntitled(current, now);
  const incoming = fieldsFromSnapshot(snapshot, {});
  const incomingEntitled = isEntitled(incoming, now);

  if (incomingEntitled && !currentEntitled) return true;
  if (!incomingEntitled && currentEntitled) return false;

  // Both entitled or both not: the newer subscription wins.
  const incomingCreated = toDate(snapshot.created_at)?.getTime() ?? 0;
  const currentUpdated = current.subscriptionUpdatedAt?.getTime() ?? 0;
  return incomingCreated >= currentUpdated || !currentEntitled;
}

/** Converts a Dodo subscription into the user-row fields we persist. */
export function fieldsFromSnapshot(
  snapshot: SubscriptionSnapshot,
  catalog: ProductCatalog,
  eventTime: Date | null = null,
): EntitlementRecord {
  const resolved: ResolvedPlan | null = resolvePlanFromProductId(snapshot.product_id, catalog);
  const status = snapshot.status as SubscriptionStatus;
  const cancelAtPeriodEnd = Boolean(snapshot.cancel_at_next_billing_date);
  const grantsPlan =
    status === "active" ||
    GRACE_STATUSES.includes(status) ||
    (status === "cancelled" && cancelAtPeriodEnd);

  return {
    plan: grantsPlan ? "player" : null,
    planInterval: resolved?.interval ?? intervalFromSnapshot(snapshot),
    subscriptionId: snapshot.subscription_id,
    subscriptionStatus: status,
    subscriptionProductId: snapshot.product_id,
    currentPeriodEnd: toDate(snapshot.next_billing_date),
    cancelAtPeriodEnd,
    subscriptionUpdatedAt: eventTime ?? new Date(),
  };
}

/**
 * Orders a customer's subscriptions so the first one is the one that should
 * represent their access: active first, then grace-period, then newest.
 */
export function pickPrimarySubscription<T extends SubscriptionSnapshot>(
  subscriptions: readonly T[],
  now: Date = new Date(),
): T | null {
  if (subscriptions.length === 0) return null;
  const score = (sub: T): number => {
    const record = fieldsFromSnapshot(sub, {});
    if (sub.status === "active") return 3;
    if (isEntitled(record, now)) return 2;
    if (sub.status === "on_hold" || sub.status === "past_due") return 1;
    return 0;
  };
  return [...subscriptions].sort((a, b) => {
    const diff = score(b) - score(a);
    if (diff !== 0) return diff;
    return (toDate(b.created_at)?.getTime() ?? 0) - (toDate(a.created_at)?.getTime() ?? 0);
  })[0]!;
}

/** Client-facing summary. Safe to send to the browser. */
export interface EntitlementSummary {
  entitled: boolean;
  plan: "player" | null;
  planKey: "monthly" | "yearly" | "legacy" | null;
  interval: BillingInterval | null;
  priceCents: number | null;
  status: SubscriptionStatus | null;
  subscriptionId: string | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
}

export function summarizeEntitlement(
  record: EntitlementRecord,
  catalog: ProductCatalog,
  now: Date = new Date(),
): EntitlementSummary {
  const entitled = isEntitled(record, now);
  const resolved = resolvePlanFromProductId(record.subscriptionProductId, catalog);
  const interval =
    resolved?.interval ??
    (record.planInterval === "year" || record.planInterval === "month"
      ? (record.planInterval as BillingInterval)
      : null);
  return {
    entitled,
    plan: entitled ? "player" : null,
    planKey: resolved?.planKey ?? null,
    interval,
    priceCents: resolved?.priceCents ?? null,
    status: (record.subscriptionStatus as SubscriptionStatus | null) ?? null,
    subscriptionId: record.subscriptionId,
    currentPeriodEnd: record.currentPeriodEnd ? record.currentPeriodEnd.toISOString() : null,
    cancelAtPeriodEnd: record.cancelAtPeriodEnd,
  };
}
