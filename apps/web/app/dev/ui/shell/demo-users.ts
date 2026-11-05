import type { ShellUser } from "@/lib/shell/types";

export type DemoUserId = "member" | "trial" | "admin" | "norating" | "payment";

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
  hasBillingPortal: true,
};

/** Demo users for /dev/ui/shell and the gallery previews (SPEC 8.2). */
export const DEMO_USERS: Record<DemoUserId, ShellUser> = {
  member,
  trial: { ...member, trialDaysLeft: 5 },
  admin: { ...member, isAdmin: true },
  norating: { ...member, ratingLabel: null },
  payment: {
    ...member,
    paymentFailed: true,
    paymentFailedUntil: "2026-11-12T00:00:00.000Z",
    paymentFailedUntilLabel: "Nov 12",
  },
};

export const DEMO_USER_IDS = Object.keys(DEMO_USERS) as DemoUserId[];
