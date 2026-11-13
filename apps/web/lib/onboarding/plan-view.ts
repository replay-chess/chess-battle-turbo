// The Plan step's copy and state mapping (phase-04 plan §4.6; V3OnbPlan, V3iPhoneOnbPlan, V3iPadOnbPlan). Pure and
// client-safe: the server page and the client step format the same strings, and plan-view.test.ts pins them.
//
// Board states: `default` (trial eligible) and `loading` (checkout POST in flight until the browser leaves for
// Dodo). Not drawn: trial used ("Start your membership."), a failed card (`?status=failed`), a checkout start error
// (inline banner with Retry and the request id), an abandoned checkout (`?resume=abandoned`, the resolver's 30-min
// rule), 503 not_configured ("This plan is not available right now.") and 429 (RetryCountdown on the button).
import { BILLING_PLANS, PLAN_NAME, formatPrice, monthlyEquivalentCents, yearlySavings, type PlanKey } from "@/lib/billing/plans";

export const DEFAULT_PLAN: PlanKey = "monthly";

/** `?plan=` → the plan (the board's default is monthly; inv-pub Q5). */
export function planParam(value: string | null | undefined): PlanKey {
  return value === "yearly" ? "yearly" : DEFAULT_PLAN;
}

export type PlanCopy = {
  h1: string;
  /** Desktop and iPad portrait. */
  lead: string;
  /** Phones (V3iPhoneOnbPlan). */
  leadShort: string;
  cta: string;
};

export const CTA_LOADING = "Opening secure checkout…";
export const CHECKOUT_HINT = "Secure checkout by Dodo Payments. Prices in USD.";

export function planCopy(trialEligible: boolean): PlanCopy {
  if (trialEligible) {
    return {
      h1: "Start your 7-day free trial.",
      lead: "Pick how you'll be billed after the trial. A card is needed now; nothing is charged today, and your games start importing as soon as the trial begins.",
      leadShort: "A card is needed now; nothing is charged today. One free trial per person.",
      cta: "Start 7-day free trial",
    };
  }
  return {
    h1: "Start your membership.",
    lead: "Your free trial has been used. Billing starts today.",
    leadShort: "Your free trial has been used. Billing starts today.",
    cta: "Start Coaching",
  };
}

/** "−16%": the yearly discount on the billing-period control. */
export function yearlyDiscountLabel(): string {
  return `−${yearlySavings().percent}%`;
}

export type PlanCardView = {
  name: string;
  /** "Cancel any time" | "About $4.17 a month". */
  note: string;
  /** "$4.99" | "$50". */
  price: string;
  /** "/ month" | "/ year". */
  per: string;
};

export function planCard(plan: PlanKey): PlanCardView {
  const p = BILLING_PLANS[plan];
  return {
    name: PLAN_NAME,
    note: p.interval === "year" ? `About ${formatPrice(monthlyEquivalentCents(p))} a month` : "Cancel any time",
    price: formatPrice(p.priceCents),
    per: p.interval === "year" ? "/ year" : "/ month",
  };
}

export type TimelineRow = {
  when: string;
  what: string;
  /** The phone table's shorter copy; null = not on phones (V3iPhoneOnbPlan shows three rows). */
  short: string | null;
  /** Hidden at heights ≤ 760 (`.tall`, §4.0). */
  tall: boolean;
};

/** "Chess.com", "Lichess", "Chess.com and Lichess", or null with no link. */
export function providersLabel(providers: readonly ("chesscom" | "lichess")[]): string | null {
  const names = [...new Set(providers)].sort().map((p) => (p === "chesscom" ? "Chess.com" : "Lichess"));
  return names.length ? names.join(" and ") : null;
}

/** The aside table "What happens after you start" (§4.6). */
export function planTimeline(input: { trialEligible: boolean; chargeDateLabel: string | null; providers: string | null }): TimelineRow[] {
  const rows: TimelineRow[] = [
    {
      when: "Today",
      what: input.providers ? `Your recent ${input.providers} games are analysed` : "Your games are analysed as you play them",
      short: input.providers ? "Recent games analysed" : "Games analysed as you play",
      tall: false,
    },
    { when: "Tomorrow", what: "Your first puzzle set, built from your mistakes", short: "First puzzles from your mistakes", tall: false },
    { when: "Week 1", what: "Your Weakness Profile shows your top patterns", short: "Weakness Profile ready", tall: false },
    { when: "Every game", what: "A coach review within a minute", short: null, tall: true },
  ];
  if (input.trialEligible) {
    rows.push({
      when: "Day 8",
      what: input.chargeDateLabel ? `First charge, unless you cancel before ${input.chargeDateLabel}` : "First charge, unless you cancel before then",
      short: null,
      tall: false,
    });
  }
  return rows;
}

export type PlanBanner = { tone: "bad" | "info"; text: string; testId: string };

/** The banner above the plan card: a failed card wins over an abandoned checkout. */
export function planBanner(query: { status?: string | null; resume?: string | null }): PlanBanner | null {
  if (query.status === "failed") return { tone: "bad", text: "Card wasn't accepted. Nothing was charged.", testId: "onb-plan-failed" };
  if (query.resume === "abandoned") return { tone: "info", text: "Checkout wasn't finished. Pick a plan to try again.", testId: "onb-plan-abandoned" };
  return null;
}

/** What a checkout start error shows (§4.6 Actions). `retry` = the banner offers Retry (the request id with it). */
export type CheckoutErrorView =
  | { kind: "unavailable"; text: string }
  | { kind: "retry"; text: string }
  | { kind: "countdown" }
  | { kind: "navigate"; to: "done" | "portal" };

export function checkoutErrorView(code: string): CheckoutErrorView {
  switch (code) {
    case "already_subscribed":
      return { kind: "navigate", to: "done" };
    case "payment_update_required":
      return { kind: "navigate", to: "portal" };
    case "not_configured":
      return { kind: "unavailable", text: "This plan is not available right now." };
    case "rate_limited":
      return { kind: "countdown" };
    default:
      return { kind: "retry", text: "Couldn't open checkout. Nothing was charged." };
  }
}
