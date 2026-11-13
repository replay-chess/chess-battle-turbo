// Membership derivation (plan §8.2, §8.3). Pure: no database, Clerk, env or clock access. The caller injects `now`,
// the paywall switch and the product catalog, so every rule here is unit-tested with fixed inputs
// (lib/auth/membership.test.ts, lib/auth/viewer.test.ts).
//
// One rule set feeds every reader: `toViewer()` (route({ auth }) and the (app) layout), `toMeData()` (GET /api/me),
// `POST /api/billing/refresh`, the legacy `requireSubscribedUser()` and `requireMemberPage()`. The shell's
// payment-banner state comes from the same function (`paymentIssueStateOf`, lib/shell/shell-user.ts), so the shell
// and /api/me can't disagree (lib/shell/shell-user.test.ts checks it).
import type { SubscriptionReason } from "@repo/contracts/http/codes";
import type { Entitlement, MembershipState, PaymentIssue, SubscriptionStatus } from "@repo/contracts/http/me";
import {
  GRACE_STATUSES,
  summarizeEntitlement,
  type EntitlementRecord,
  type EntitlementSummary,
  type SubscriptionStatus as RuleStatus,
  type TrialColumns,
} from "../billing/entitlement-rules";
import type { ProductCatalog } from "../billing/plans";
import { formatShellDate, paymentIssueStateOf } from "../shell/shell-user";

const DAY_MS = 86_400_000;

/**
 * Kill switch for the paywall: BILLING_PAYWALL=off lets every signed-in user play (for example while the Dodo
 * products are being configured). Re-exported by lib/auth/require-subscription.ts, its historical home.
 */
export function isPaywallEnabled(env: Readonly<Record<string, string | undefined>> = process.env): boolean {
  return env.BILLING_PAYWALL?.toLowerCase() !== "off";
}

/** Every status the contract accepts; anything else stored in the column reads as null. */
const CONTRACT_STATUSES: ReadonlySet<string> = new Set<SubscriptionStatus>([
  "pending",
  "active",
  "on_hold",
  "paused",
  "cancelled",
  "failed",
  "expired",
  "past_due",
]);

/** The record columns membership reads (a users row, a ViewerRecord or a resolveUser() row). */
export type MembershipRecord = EntitlementRecord &
  TrialColumns & {
    /** Prisma `Role` ("USER" | "ADMIN"). */
    role: string;
    dodoCustomerId: string | null;
  };

export type MembershipOptions = {
  now: Date;
  /** BILLING_PAYWALL !== "off" (isPaywallEnabled()). */
  paywallEnabled: boolean;
  catalog: ProductCatalog;
};

/** What the 402 reason needs besides the contract's entitlement. */
export type BillingFacts = {
  /** True when the only subscription ever held was the free trial (or none at all): the trial_used reason. */
  neverPaid: boolean;
};

export type Membership = {
  entitlement: Entitlement;
  summary: EntitlementSummary;
  billing: BillingFacts;
};

/**
 * Plan §8.2 `entitlement.state`: trial → grace → cancelling → member for entitled rows; lapsed when a trial or a
 * subscription ever existed; none otherwise.
 */
export function membershipStateOf(summary: EntitlementSummary): MembershipState {
  if (summary.trial.active) return "trial";
  if (summary.entitled) {
    if (summary.status && GRACE_STATUSES.includes(summary.status as RuleStatus)) return "grace";
    if (summary.cancelAtPeriodEnd) return "cancelling";
    return "member";
  }
  if (summary.trial.used || summary.subscriptionId != null) return "lapsed";
  return "none";
}

/** Plan §8.2 `paymentIssue` (same thresholds as the shell banner), with the access-end date and its UTC label. */
export function paymentIssueOf(summary: EntitlementSummary, now: Date): PaymentIssue | null {
  const state = paymentIssueStateOf(summary, now);
  if (!state || !summary.currentPeriodEnd) return null;
  return {
    state,
    accessEndsAt: summary.currentPeriodEnd,
    accessEndsAtLabel: formatShellDate(summary.currentPeriodEnd) ?? "",
  };
}

/**
 * The trial_used reason's "never paid": no subscription ever, or the only one ended within a day of the trial's end
 * (a trial that was cancelled or failed its first charge never reaches a paid period).
 */
export function neverPaidOf(record: Pick<EntitlementRecord, "subscriptionId" | "currentPeriodEnd"> & TrialColumns): boolean {
  if (record.subscriptionId == null) return true;
  const trialEnd = record.trialEndsAt?.getTime() ?? null;
  const periodEnd = record.currentPeriodEnd?.getTime() ?? null;
  return trialEnd !== null && periodEnd !== null && periodEnd <= trialEnd + DAY_MS;
}

/**
 * The contract's `entitlement` from a billing summary (plan §7.3, §8.2). `dodoCustomerId` decides `hasBillingPortal`;
 * `role` and `paywallEnabled` decide `member`.
 */
export function entitlementOf(
  summary: EntitlementSummary,
  facts: { role: string; dodoCustomerId: string | null; now: Date; paywallEnabled: boolean },
): Entitlement {
  const isAdmin = facts.role === "ADMIN";
  const status = summary.status && CONTRACT_STATUSES.has(summary.status) ? (summary.status as SubscriptionStatus) : null;
  return {
    state: membershipStateOf(summary),
    member: !facts.paywallEnabled || isAdmin || summary.entitled,
    entitled: summary.entitled,
    paywall: facts.paywallEnabled,
    planKey: summary.planKey,
    interval: summary.interval,
    priceCents: summary.priceCents,
    status,
    currentPeriodEnd: summary.currentPeriodEnd,
    cancelAtPeriodEnd: summary.cancelAtPeriodEnd,
    trial: {
      active: summary.trial.active,
      used: summary.trial.used,
      endsAt: summary.trial.endsAt,
      // trialDaysLeft rounds up, so this is ≥ 1 while the trial is active.
      daysLeft: summary.trial.active ? Math.max(1, summary.trial.daysLeft) : null,
      eligible: !summary.trial.used && !summary.subscriptionId,
    },
    paymentIssue: paymentIssueOf(summary, facts.now),
    hasBillingPortal: Boolean(facts.dodoCustomerId),
  };
}

/** Everything membership-related for one record (summary + contract entitlement + reason facts). */
export function membershipOf(record: MembershipRecord, options: MembershipOptions): Membership {
  const summary = summarizeEntitlement(record, options.catalog, options.now);
  return {
    summary,
    entitlement: entitlementOf(summary, {
      role: record.role,
      dodoCustomerId: record.dodoCustomerId,
      now: options.now,
      paywallEnabled: options.paywallEnabled,
    }),
    billing: { neverPaid: neverPaidOf(record) },
  };
}

/** The fields reasonFor() reads; the Viewer satisfies it. */
export type ReasonInput = {
  entitlement: Pick<Entitlement, "state"> & {
    trial: Pick<Entitlement["trial"], "used" | "eligible">;
    paymentIssue: Pick<PaymentIssue, "state"> | null;
  };
  billing?: Partial<BillingFacts>;
};

/**
 * Plan §8.3: the 402 `details.reason` for someone who is not a member.
 * - `trial_available`: never subscribed and the trial is still on offer;
 * - `trial_used` also for someone who never subscribed here but whose trial is NOT on offer: the trial ledger knows
 *   this person (a re-signup, an email variant; the caller passed a ledger-aware viewer, FIX-2);
 * - `payment_failed`: the payment-issue window after a failed renewal (`paymentIssue.state === "expired"`);
 * - `trial_used`: lapsed after the trial without ever paying;
 * - `expired`: any other lapsed member.
 */
export function reasonFor(viewer: ReasonInput): SubscriptionReason {
  const e = viewer.entitlement;
  if (e.state === "none") return e.trial.eligible ? "trial_available" : "trial_used";
  if (e.paymentIssue?.state === "expired") return "payment_failed";
  if (e.state === "lapsed" && e.trial.used && viewer.billing?.neverPaid) return "trial_used";
  return "expired";
}

/** The B26 default paywall page for a reason: `required` for the trial offer, `ended` for every lapse. */
export function upgradeUrlFor(reason: SubscriptionReason): string {
  return reason === "trial_available" ? "/pricing?reason=required" : "/pricing?reason=ended";
}

/** `upgradeUrlFor(reason)` plus `redirect_url` (a same-site path only; anything else is dropped). */
export function paywallUrlFor(reason: SubscriptionReason, returnTo?: string | null): string {
  const base = upgradeUrlFor(reason);
  if (!returnTo || !returnTo.startsWith("/") || returnTo.startsWith("//") || returnTo.startsWith("/\\")) return base;
  return `${base}&redirect_url=${encodeURIComponent(returnTo)}`;
}
