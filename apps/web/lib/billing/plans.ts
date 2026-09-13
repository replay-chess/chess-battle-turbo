/**
 * ReplayChess billing catalog.
 *
 * This module is safe to import from client and server code. It holds the
 * public facts about the Player plan (prices, intervals, copy) and the pure
 * helpers used to map a Dodo Payments product back to a plan. Product IDs
 * themselves are read from environment variables in `products.ts`, which is
 * server-only.
 */

export const PLAN_NAME = "Player";

export type BillingInterval = "month" | "year";
export type PlanKey = "monthly" | "yearly";

export const PLAN_KEYS = ["monthly", "yearly"] as const satisfies readonly PlanKey[];

export interface BillingPlan {
  key: PlanKey;
  /** Short label shown on the billing toggle. */
  label: string;
  interval: BillingInterval;
  /** Price in USD cents, the unit Dodo Payments uses. */
  priceCents: number;
  /** Suffix rendered next to the price, e.g. "/mo". */
  periodLabel: string;
  /** One-line billing explanation shown under the price. */
  billingNote: string;
  /** Product name used when the product is created in Dodo Payments. */
  dodoProductName: string;
  dodoProductDescription: string;
}

export const BILLING_PLANS: Record<PlanKey, BillingPlan> = {
  monthly: {
    key: "monthly",
    label: "Monthly",
    interval: "month",
    priceCents: 499,
    periodLabel: "/mo",
    billingNote: "Billed monthly. Cancel anytime.",
    dodoProductName: "ReplayChess Player (Monthly)",
    dodoProductDescription:
      "ReplayChess Player membership billed every month. Unlimited legendary positions, analysis tools, and priority features.",
  },
  yearly: {
    key: "yearly",
    label: "Yearly",
    interval: "year",
    priceCents: 5000,
    periodLabel: "/yr",
    billingNote: "Billed once a year.",
    dodoProductName: "ReplayChess Player (Yearly)",
    dodoProductDescription:
      "ReplayChess Player membership billed once a year. Unlimited legendary positions, analysis tools, and priority features at the best price.",
  },
};

/** Price of the original Player plan, kept for grandfathered subscribers. */
export const LEGACY_PLAYER_PRICE_CENTS = 800;

export function isPlanKey(value: unknown): value is PlanKey {
  return typeof value === "string" && (PLAN_KEYS as readonly string[]).includes(value);
}

/** Formats cents as a USD price, dropping ".00" for whole-dollar amounts. */
export function formatPrice(cents: number): string {
  const dollars = cents / 100;
  const hasCents = cents % 100 !== 0;
  return `$${hasCents ? dollars.toFixed(2) : dollars.toFixed(0)}`;
}

/** Monthly-equivalent cost of the yearly plan, rounded to the nearest cent. */
export function monthlyEquivalentCents(plan: BillingPlan): number {
  return plan.interval === "year" ? Math.round(plan.priceCents / 12) : plan.priceCents;
}

/** How much a subscriber saves per year by choosing yearly over monthly. */
export function yearlySavings(): { amountCents: number; percent: number } {
  const monthlyForYear = BILLING_PLANS.monthly.priceCents * 12;
  const amountCents = monthlyForYear - BILLING_PLANS.yearly.priceCents;
  const percent = Math.round((amountCents / monthlyForYear) * 100);
  return { amountCents, percent };
}

/** Dodo product IDs that map onto the catalog. Provided by the server. */
export interface ProductCatalog {
  monthly?: string | null;
  yearly?: string | null;
  /** Older product IDs (the original $8/mo Player plan) still honored as active. */
  legacy?: readonly string[];
}

export interface ResolvedPlan {
  plan: "player";
  planKey: PlanKey | "legacy";
  interval: BillingInterval;
  priceCents: number;
  legacy: boolean;
}

/**
 * Maps a Dodo product ID to a plan. Returns null for products we do not sell,
 * so callers can decide how to treat an unexpected active subscription.
 */
export function resolvePlanFromProductId(
  productId: string | null | undefined,
  catalog: ProductCatalog,
): ResolvedPlan | null {
  if (!productId) return null;

  for (const key of PLAN_KEYS) {
    if (catalog[key] && catalog[key] === productId) {
      const plan = BILLING_PLANS[key];
      return {
        plan: "player",
        planKey: key,
        interval: plan.interval,
        priceCents: plan.priceCents,
        legacy: false,
      };
    }
  }

  if (catalog.legacy?.includes(productId)) {
    return {
      plan: "player",
      planKey: "legacy",
      interval: "month",
      priceCents: LEGACY_PLAYER_PRICE_CENTS,
      legacy: true,
    };
  }

  return null;
}

/** Human-readable price for a resolved plan, e.g. "$4.99/mo" or "$50/yr". */
export function describePlanPrice(resolved: Pick<ResolvedPlan, "interval" | "priceCents">): string {
  return `${formatPrice(resolved.priceCents)}${resolved.interval === "year" ? "/yr" : "/mo"}`;
}
