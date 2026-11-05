// Pure mapping from a user row to the shell's view of the viewer (SPEC 9.3).
// No database, Clerk or env access: the caller injects `now`, the paywall flag
// and the product catalog, so this module is unit-testable.
import {
  summarizeEntitlement,
  type EntitlementRecord,
  type EntitlementSummary,
  type TrialColumns,
} from "../billing/entitlement-rules";
import type { ProductCatalog } from "../billing/plans";
import type { PaymentIssueState, ShellUser } from "./types";

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

const HOUR_MS = 60 * 60 * 1000;
/** `last_day` once access ends within this window (plan §4.5). */
export const PAYMENT_LAST_DAY_MS = 36 * HOUR_MS;
/** `expired` is shown for this long after the grace period ended; older lapses are ordinary lapsed users. */
export const PAYMENT_EXPIRED_WINDOW_MS = 30 * 24 * HOUR_MS;

/**
 * The V3PaymentFailed state from an entitlement summary (plan §8.2 `paymentIssue`). Pure; the same rule
 * `toMeData` uses for `entitlement.paymentIssue.state`, so the shell and `/api/me` never disagree
 * (`shell-user.test.ts` checks the two side by side once `lib/auth/viewer.ts` exists).
 * - status past_due / on_hold and entitled: `last_day` when currentPeriodEnd − now ≤ 36 h, else `banner`;
 * - status on_hold / past_due / failed, not entitled, currentPeriodEnd no more than 30 days ago: `expired`;
 * - otherwise null.
 */
export function paymentIssueStateOf(
  summary: Pick<EntitlementSummary, "entitled" | "status" | "currentPeriodEnd">,
  now: Date,
): PaymentIssueState | null {
  const { status, entitled } = summary;
  const end = summary.currentPeriodEnd ? new Date(summary.currentPeriodEnd).getTime() : Number.NaN;
  if (entitled && (status === "past_due" || status === "on_hold")) {
    if (Number.isNaN(end)) return "banner";
    return end - now.getTime() <= PAYMENT_LAST_DAY_MS ? "last_day" : "banner";
  }
  if (!entitled && (status === "past_due" || status === "on_hold" || status === "failed")) {
    if (Number.isNaN(end)) return null;
    // `end >= now − 30 d`. A `failed` subscription whose period has not run out yet is not entitled either
    // (isEntitled), so it counts as expired too.
    return now.getTime() - end <= PAYMENT_EXPIRED_WINDOW_MS ? "expired" : null;
  }
  return null;
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
      paymentIssueState: paymentIssueStateOf(summary, now),
      hasBillingPortal: Boolean(record.dodoCustomerId),
    },
  };
}
