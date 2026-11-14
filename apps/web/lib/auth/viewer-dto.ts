// DTO builders for the viewer (plan §7.3). Pure: no database, Clerk, env or clock access.
//
//   toMeUser(record)                      → MeData.user
//   meDataOf(viewer, flags, buildId)      → MeData (GET /api/me, the (app) layout's qk.me() seed after 1B·J)
//   toLegacySubscription(...)             → the Phase 0 SubscriptionResponse (GET /api/subscription, and
//                                           BillingRefreshData.legacy for useUserStore until P10)
//
// Fixed key order everywhere: the private-etag tier hashes the serialised body (lib/api/etag.ts).
import type { MeAccount, MeData, MeImport, MeUser } from "@repo/contracts/http/me";
import type { Badges } from "@repo/contracts/http/train";
import type { OnboardingView } from "@repo/contracts/http/onboarding";
import type { OnboardingGoalDb, OnboardingStepDb, RatingBandDb } from "@repo/contracts/http/p04-plain";
import type { EntitlementSummary } from "../billing/entitlement-rules";

/** The onboarding fields MeData.onboarding reads (lib/auth/viewer.ts's ViewerOnboarding satisfies it). */
export type MeOnboardingSource = {
  step: OnboardingStepDb;
  onboarded: boolean;
  onboardedAt: Date | null;
  ratingBand: RatingBandDb | null;
  ratingBandSource: string | null;
  initialRating: number | null;
  goals: readonly OnboardingGoalDb[];
  dailyMinutes: number | null;
};

/**
 * The viewer fields MeData reads (lib/auth/viewer.ts's Viewer satisfies it). The P4 fields are optional: a viewer
 * without them (a P1 shell record, a test fixture) serialises the P1 MeData unchanged.
 */
export type MeSource = {
  user: MeUser;
  entitlement: MeData["entitlement"];
  onboarding?: MeOnboardingSource;
  accounts?: readonly MeAccount[];
  importRun?: MeImport | null;
  /** P5: the nav badges from the viewer statement (absent on records without the badge facts). */
  badges?: Badges;
};

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
  /** P4 (R-03): IANA zone; absent on P1 shell records. */
  timeZone?: string;
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
    ...(record.timeZone ? { timeZone: record.timeZone } : {}),
  };
}

/** Onboarding is over: the user row says onboarded, or the step reached DONE. */
export function onboardingFinished(o: Pick<MeOnboardingSource, "onboarded" | "step">): boolean {
  return o.onboarded || o.step === "DONE";
}

/** MeData.onboarding (wire enums are lowercase, D4-25). */
export function onboardingViewOf(o: MeOnboardingSource): OnboardingView {
  const minutes = o.dailyMinutes === 5 || o.dailyMinutes === 10 || o.dailyMinutes === 20 ? o.dailyMinutes : null;
  return {
    step: o.step.toLowerCase() as OnboardingView["step"],
    done: o.onboarded,
    ratingBand: o.ratingBand ? (o.ratingBand.toLowerCase() as OnboardingView["ratingBand"]) : null,
    ratingBandSource: o.ratingBandSource,
    initialRating: o.initialRating,
    goals: o.goals.map((g) => g.toLowerCase()) as OnboardingView["goals"],
    dailyMinutes: minutes,
    onboardedAt: o.onboardedAt ? o.onboardedAt.toISOString() : null,
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
    // P4 (phase-04 §7.2): present only when the viewer carries them (always, from the viewer statement). `onboarding`
    // only while onboarding is unfinished: its readers are the steps (FIX-2, plan §9.6 "/api/me growth ≤ +350 B"; the
    // finished view added ~220 B to every member's /api/me and nothing read it; docs/decisions.md FX-18).
    ...(viewer.onboarding && !onboardingFinished(viewer.onboarding) ? { onboarding: onboardingViewOf(viewer.onboarding) } : {}),
    ...(viewer.accounts ? { accounts: viewer.accounts.map((a) => ({ ...a })) } : {}),
    ...(viewer.importRun !== undefined ? { import: viewer.importRun ? { ...viewer.importRun } : null } : {}),
    // P5 (phase-05 §7.3 R8): the nav badges, only while the `train` flag is on (nothing reads them otherwise).
    ...(viewer.badges && flags.train === true ? { badges: { bankDue: viewer.badges.bankDue, trainDot: viewer.badges.trainDot } } : {}),
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
