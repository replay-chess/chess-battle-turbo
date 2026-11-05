// Pure mapping from a user row to the shell's view of the viewer (SPEC 9.3).
// No database, Clerk or env access: the caller injects `now`, the paywall flag
// and the product catalog, so this module is unit-testable.
import { summarizeEntitlement, type EntitlementRecord, type TrialColumns } from "../billing/entitlement-rules";
import type { ProductCatalog } from "../billing/plans";
import type { ShellUser } from "./types";

/** The columns `getShellSession` selects. Matches the Prisma `select` shape. */
export type ShellUserRecord = EntitlementRecord &
  TrialColumns & {
    referenceId: string;
    name: string;
    profilePictureUrl: string | null;
    /** Prisma `Role` enum value ("USER" | "ADMIN"). */
    role: string;
    dodoCustomerId: string | null;
    chessComProfile: { blitzRating: number | null; rapidRating: number | null } | null;
  };

export type ShellSession = {
  user: ShellUser;
  /** Entitled, an admin, or the paywall is off: the page gets the app shell. */
  member: boolean;
};

export type ShellSessionOptions = {
  now: Date;
  paywallEnabled: boolean;
  catalog: ProductCatalog;
};

function ratingLabel(profile: ShellUserRecord["chessComProfile"]): string | null {
  if (profile?.blitzRating) return `Blitz ${profile.blitzRating}`;
  if (profile?.rapidRating) return `Rapid ${profile.rapidRating}`;
  return null;
}

/** "Nov 12", always in UTC so the server render and hydration agree. */
export function formatShellDate(iso: string | null): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

export function toShellSession(record: ShellUserRecord, { now, paywallEnabled, catalog }: ShellSessionOptions): ShellSession {
  const summary = summarizeEntitlement(record, catalog, now);
  const isAdmin = record.role === "ADMIN";
  const member = !paywallEnabled || isAdmin || summary.entitled;
  const paymentFailed = summary.status === "past_due" || summary.status === "on_hold";

  return {
    member,
    user: {
      referenceId: record.referenceId,
      name: record.name,
      avatarUrl: record.profilePictureUrl,
      isAdmin,
      ratingLabel: ratingLabel(record.chessComProfile),
      trialDaysLeft: summary.trial.active ? summary.trial.daysLeft : null,
      paymentFailed,
      paymentFailedUntil: summary.currentPeriodEnd,
      paymentFailedUntilLabel: formatShellDate(summary.currentPeriodEnd),
      hasBillingPortal: Boolean(record.dodoCustomerId),
    },
  };
}
