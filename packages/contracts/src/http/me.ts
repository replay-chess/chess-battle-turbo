import { z } from "zod";
import { ImportPhaseSchema, ImportRunStatus, LinkViewStatus, ProviderSlug } from "./accounts";
import { IsoDateTime, Ref } from "./common";
import { OnboardingView } from "./onboarding";

/** P10 appends "paused". */
export const MembershipState = z.enum(["member", "trial", "grace", "cancelling", "lapsed", "none"]);
export type MembershipState = z.infer<typeof MembershipState>;

export const PaymentIssue = z.object({
  state: z.enum(["banner", "last_day", "expired"]),
  /** currentPeriodEnd */
  accessEndsAt: IsoDateTime,
  /** "Nov 12", formatted on the server in UTC. */
  accessEndsAtLabel: z.string(),
});
export type PaymentIssue = z.infer<typeof PaymentIssue>;

export const SubscriptionStatus = z.enum(["pending", "active", "on_hold", "paused", "cancelled", "failed", "expired", "past_due"]);
export type SubscriptionStatus = z.infer<typeof SubscriptionStatus>;

export const TrialState = z.object({
  active: z.boolean(),
  used: z.boolean(),
  endsAt: IsoDateTime.nullable(),
  daysLeft: z.number().int().min(1).nullable(),
  eligible: z.boolean(),
});
export type TrialState = z.infer<typeof TrialState>;

export const Entitlement = z.object({
  state: MembershipState,
  /** What route({ auth: "member" }) decides: entitled || admin || paywall off. */
  member: z.boolean(),
  /** Billing truth only. */
  entitled: z.boolean(),
  /** BILLING_PAYWALL !== "off". */
  paywall: z.boolean(),
  planKey: z.enum(["monthly", "yearly", "legacy"]).nullable(),
  interval: z.enum(["month", "year"]).nullable(),
  priceCents: z.number().int().nullable(),
  status: SubscriptionStatus.nullable(),
  currentPeriodEnd: IsoDateTime.nullable(),
  cancelAtPeriodEnd: z.boolean(),
  trial: TrialState,
  paymentIssue: PaymentIssue.nullable(),
  hasBillingPortal: z.boolean(),
});
export type Entitlement = z.infer<typeof Entitlement>;

/** P4 adds user.timeZone. */
export const MeUser = z.object({
  ref: Ref,
  code: z.string(),
  name: z.string().max(120),
  /** The viewer's own email only. */
  email: z.string(),
  avatarUrl: z.string().nullable(),
  role: z.enum(["user", "admin"]),
  onboarded: z.boolean(),
  /** "Blitz 1184" | "Rapid 1320" | null */
  ratingLabel: z.string().nullable(),
  /** P4 (R-03): IANA zone, default "UTC". Optional until every /api/me writer sends it. */
  timeZone: z.string().max(64).optional(),
});
export type MeUser = z.infer<typeof MeUser>;

/** P4 (phase-04 §7.1): one linked account in the viewer payload (≤ 2). */
export const MeAccount = z.object({
  provider: ProviderSlug,
  username: z.string().max(40),
  status: LinkViewStatus,
  lastSyncAt: IsoDateTime.nullable(),
});
export type MeAccount = z.infer<typeof MeAccount>;

/** P4: the active import run, or one that finished in the last 24 h (null otherwise). */
export const MeImport = z.object({
  ref: Ref,
  provider: ProviderSlug,
  status: ImportRunStatus,
  phase: ImportPhaseSchema.nullable(),
  imported: z.int().min(0),
  total: z.int().min(0).nullable(),
});
export type MeImport = z.infer<typeof MeImport>;

/**
 * GET /api/me (plan §7.3). P4 adds onboarding, accounts and import (optional first: additive, consistency R-03);
 * P5 badges.
 */
export const MeData = z.object({
  user: MeUser,
  entitlement: Entitlement,
  flags: z.record(z.string(), z.boolean()),
  buildId: z.string(),
  onboarding: OnboardingView.optional(),
  accounts: z.array(MeAccount).max(2).optional(),
  import: MeImport.nullable().optional(),
});
export type MeData = z.infer<typeof MeData>;
