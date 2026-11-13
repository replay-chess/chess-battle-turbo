// Pure copy helpers of the activating pages and the plan step (phase-04 plan 4.6, 4.7, 4.9). No React, no I/O: the
// server components and the client views format the same strings, and activation-copy.test.ts pins them.
import { BILLING_PLANS, formatPrice, type BillingInterval } from "./plans";
import { TRIAL_DAYS } from "./trial-rules";

/**
 * The plan aside's four rows (board DR/V3CheckoutActivating): copy.ts PLAN_FEATURES without the Weakness Profile row.
 * Kept here, not imported from copy.ts, so the activating chunk does not carry the pricing FAQs (activation-copy.test.ts
 * keeps the two lists in step).
 */
export const ACTIVATION_FEATURES: readonly string[] = [
  "Analysis of every Chess.com game you play",
  "Your recurring mistakes, found and ranked",
  "Daily puzzles built from your own mistakes",
  "Unlimited questions to the coach",
];

/** First-charge date of a trial that starts at `now`: day 8 (copy.ts trialChargeDate). */
export function trialChargeDateFrom(now: Date): Date {
  return new Date(now.getTime() + TRIAL_DAYS * 86_400_000);
}

/** "6 Nov" in the viewer's time zone (`users."timeZone"`; an unknown zone falls back to UTC). */
export function shortDateLabel(value: string | Date | null | undefined, timeZone = "UTC"): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const format = (tz: string) => new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: tz }).format(date);
  try {
    return format(timeZone);
  } catch {
    return format("UTC");
  }
}

/** "$4.99 / month" pieces for an interval (the plan's price, or a legacy price). */
export function priceLabel(interval: BillingInterval, priceCents?: number | null): { price: string; per: "month" | "year" } {
  const cents = priceCents ?? (interval === "year" ? BILLING_PLANS.yearly.priceCents : BILLING_PLANS.monthly.priceCents);
  return { price: formatPrice(cents), per: interval };
}

/**
 * TrialTermsLine (plan 4.6): with a trial "Then $4.99/month. Cancel before 6 Nov and you won't be charged.";
 * trial used "Billed $4.99 today, then monthly. Cancel any time."
 */
export function trialTermsText(input: { trial: boolean; interval: BillingInterval; chargeDateLabel: string | null; priceCents?: number | null }): string {
  const { price, per } = priceLabel(input.interval, input.priceCents);
  if (input.trial && input.chargeDateLabel) return `Then ${price}/${per}. Cancel before ${input.chargeDateLabel} and you won't be charged.`;
  return `Billed ${price} today, then ${per === "year" ? "yearly" : "monthly"}. Cancel any time.`;
}

/** "2 min", "45 s": how long the activating page has waited (the stalled hint). */
export function waitedLabel(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s} s`;
  const m = Math.round(s / 60);
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`;
}

const DESTINATIONS: readonly [prefix: string, label: string][] = [
  ["/games", "My games"],
  ["/review", "Your review"],
  ["/play", "Play"],
  ["/queue", "Play"],
  ["/game", "Your game"],
  ["/legends", "Legends"],
  ["/openings", "Openings"],
  ["/position", "Position"],
  ["/practice", "Practice"],
  ["/analysis", "Analysis"],
  ["/tournaments", "Tournaments"],
  ["/tournament", "Tournament"],
  ["/join-tournament", "Tournament"],
  ["/challenge", "Your challenge"],
  ["/join", "Your challenge"],
  ["/profile", "Profile"],
  ["/settings", "Settings"],
  ["/pricing", "Pricing"],
  ["/onboarding", "Setup"],
  ["/home", "Home"],
  ["/train", "Train"],
  ["/learn", "Learn"],
];

/**
 * "You'll return to <label>": the destination's section name. (P1's resolveReturnTarget(), which would also name the
 * object, e.g. "Play · Kasparov vs Topalov", is not built yet; P11 swaps it in.)
 */
export function destinationLabel(path: string | null | undefined): string {
  if (!path) return "My games";
  const pathname = path.split(/[?#]/)[0] ?? "";
  const hit = DESTINATIONS.find(([prefix]) => pathname === prefix || pathname.startsWith(`${prefix}/`));
  return hit ? hit[1] : "My games";
}
