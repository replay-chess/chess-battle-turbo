// Shell contracts (SPEC 3.4). Changes are additive only.

export type DestinationKey =
  | "home" | "play" | "tournaments" | "train" | "learn" | "legends" | "openings" | "review" | "profile" | "settings";

export type ChromeMode = "shell" | "marketing";

export type ShellUser = {
  referenceId: string;
  name: string;
  avatarUrl: string | null;
  isAdmin: boolean;
  /** "Blitz 1184" (Chess.com blitz, else rapid); uppercased by CSS. null hides the line. */
  ratingLabel: string | null;
  /** Whole days left in an active trial, rounded up, so always >= 1. null when not trialling. */
  trialDaysLeft: number | null;
  /** Subscription status is past_due or on_hold: show the payment-failed banner. */
  paymentFailed: boolean;
  /** ISO timestamp that access lasts until (currentPeriodEnd). */
  paymentFailedUntil: string | null;
  /** The same date preformatted on the server in UTC ("Nov 12"), so SSR and hydration agree. */
  paymentFailedUntilLabel: string | null;
  /** The user has a Dodo customer id, so "Manage Billing" (/api/customer-portal) works. */
  hasBillingPortal: boolean;
};
