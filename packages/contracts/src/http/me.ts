import { z } from "zod";
import { IsoDateTime, Ref } from "./common";

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
});
export type MeUser = z.infer<typeof MeUser>;

/** GET /api/me (plan §7.3). P4 adds accounts and import, P5 badges, each as optional fields first. */
export const MeData = z.object({
  user: MeUser,
  entitlement: Entitlement,
  flags: z.record(z.string(), z.boolean()),
  buildId: z.string(),
});
export type MeData = z.infer<typeof MeData>;
