// DTO builders for the viewer (plan §7.3). Pure: no database, Clerk, env or clock access.
//
//   toMeUser(record)                      → MeData.user
//   meDataOf(viewer, flags, buildId)      → MeData (GET /api/me, the (app) layout's qk.me() seed after 1B·J)
//   toLegacySubscription(...)             → the Phase 0 SubscriptionResponse (GET /api/subscription, and
//                                           BillingRefreshData.legacy for useUserStore until P10)
//
// Fixed key order everywhere: the private-etag tier hashes the serialised body (lib/api/etag.ts).
import type { MeData, MeUser } from "@repo/contracts/http/me";
import type { EntitlementSummary } from "../billing/entitlement-rules";

/** The viewer fields MeData reads (lib/auth/viewer.ts's Viewer satisfies it). */
export type MeSource = { user: MeUser; entitlement: MeData["entitlement"] };

/** The record columns MeData.user reads. */
export type MeUserRecord = {
  referenceId: string;
  code: string;
  name: string;
  email: string;
  profilePictureUrl: string | null;
  /** Prisma `Role` ("USER" | "ADMIN"). */
  role: string;
  onboarded: boolean;
  blitzRating?: number | null;
  rapidRating?: number | null;
};

const NAME_MAX = 120;

/** "Blitz 1184" | "Rapid 1320" | null (plan §8.2). */
export function ratingLabelOf(record: Pick<MeUserRecord, "blitzRating" | "rapidRating">): string | null {
  if (record.blitzRating) return `Blitz ${record.blitzRating}`;
  if (record.rapidRating) return `Rapid ${record.rapidRating}`;
  return null;
}

export function toMeUser(record: MeUserRecord): MeUser {
  const name = (record.name ?? "").trim();
  return {
    ref: record.referenceId,
    code: record.code,
    name: name.length > NAME_MAX ? name.slice(0, NAME_MAX) : name,
    email: record.email,
    avatarUrl: record.profilePictureUrl ?? null,
    role: record.role === "ADMIN" ? "admin" : "user",
    onboarded: Boolean(record.onboarded),
    ratingLabel: ratingLabelOf(record),
  };
}

/** MeData from a viewer (copies only the contract's keys, so nothing server-only can leak into the body). */
export function meDataOf(viewer: MeSource, flags: Record<string, boolean>, buildId: string): MeData {
  const e = viewer.entitlement;
  return {
    user: { ...viewer.user },
    entitlement: {
      state: e.state,
      member: e.member,
      entitled: e.entitled,
      paywall: e.paywall,
      planKey: e.planKey,
      interval: e.interval,
      priceCents: e.priceCents,
      status: e.status,
      currentPeriodEnd: e.currentPeriodEnd,
      cancelAtPeriodEnd: e.cancelAtPeriodEnd,
      trial: { ...e.trial },
      paymentIssue: e.paymentIssue ? { ...e.paymentIssue } : null,
      hasBillingPortal: e.hasBillingPortal,
    },
    flags: { ...flags },
    buildId,
  };
}

/** The Phase 0 `GET /api/subscription` body, unchanged (plan A6). */
export interface SubscriptionResponse extends EntitlementSummary {
  customerId?: string;
  /** False when BILLING_PAYWALL=off; clients then skip their own gate. */
  paywall: boolean;
  /** True when the next checkout will include the 7-day free trial. */
  trialEligible: boolean;
  /** Kept for older clients; mirrors `entitled` and `subscriptionId`. */
  subscription?: {
    id: string;
    status: string;
    productId: string | null;
    nextBillingDate: string | null;
    planKey: EntitlementSummary["planKey"];
    interval: EntitlementSummary["interval"];
    priceCents: number | null;
  };
}

export function toLegacySubscription(
  summary: EntitlementSummary,
  options: { customerId: string | null | undefined; productId: string | null; paywall: boolean },
): SubscriptionResponse {
  return {
    ...summary,
    customerId: options.customerId ?? undefined,
    paywall: options.paywall,
    trialEligible: !summary.trial.used && !summary.subscriptionId,
    subscription:
      summary.subscriptionId && summary.status
        ? {
            id: summary.subscriptionId,
            status: summary.status,
            productId: options.productId,
            nextBillingDate: summary.currentPeriodEnd,
            planKey: summary.planKey,
            interval: summary.interval,
            priceCents: summary.priceCents,
          }
        : undefined,
  };
}
