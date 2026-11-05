import type { ShellUser } from "@/lib/shell/types";

export type DemoUserId =
  | "member"
  | "trial"
  | "admin"
  | "norating"
  | "payment"
  | "payment_last_day"
  | "payment_expired";

const member: ShellUser = {
  referenceId: "demo-knightowl",
  name: "Knight Owl",
  avatarUrl: null,
  isAdmin: false,
  ratingLabel: "Blitz 1184",
  trialDaysLeft: null,
  paymentFailed: false,
  paymentFailedUntil: null,
  paymentFailedUntilLabel: null,
  paymentIssueState: null,
  hasBillingPortal: true,
};

const paymentFailed: ShellUser = {
  ...member,
  paymentFailed: true,
  paymentFailedUntil: "2026-11-12T00:00:00.000Z",
  paymentFailedUntilLabel: "Nov 12",
};

/**
 * Demo users for /dev/ui/shell and the gallery previews (SPEC 8.2), plus the V3PaymentFailed states (1A·P7):
 * `payment` = banner (dismissable), `payment_last_day` = 36 h or less left (no dismiss), `payment_expired` =
 * grace ended (Renew Membership). A real expired user is a non-member and never reaches the shell under the
 * B26 default (plan §4.5), so this demo user is the only way to see that state in P1.
 */
export const DEMO_USERS: Record<DemoUserId, ShellUser> = {
  member,
  trial: { ...member, trialDaysLeft: 5 },
  admin: { ...member, isAdmin: true },
  norating: { ...member, ratingLabel: null },
  payment: { ...paymentFailed, paymentIssueState: "banner" },
  payment_last_day: { ...paymentFailed, paymentIssueState: "last_day" },
  payment_expired: { ...paymentFailed, paymentFailed: false, paymentIssueState: "expired" },
};

export const DEMO_USER_IDS = Object.keys(DEMO_USERS) as DemoUserId[];
