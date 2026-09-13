import "server-only";
import type { PlanKey, ProductCatalog } from "./plans";
import { BILLING_PLANS } from "./plans";

/**
 * Dodo Payments product IDs, read from the server environment.
 *
 * - DODO_PRODUCT_ID_MONTHLY: Player plan billed monthly ($4.99)
 * - DODO_PRODUCT_ID_YEARLY:  Player plan billed yearly ($50)
 * - DODO_LEGACY_PLAYER_PRODUCT_ID: the original $8/mo product, kept so
 *   existing subscribers stay recognized. NEXT_PUBLIC_DODO_PLAYER_PRODUCT_ID
 *   is accepted as a fallback for deployments that still set it.
 *
 * Create the products with `pnpm --filter web dodo:setup-products`.
 */
export function getProductCatalog(): ProductCatalog {
  const legacy = [
    process.env.DODO_LEGACY_PLAYER_PRODUCT_ID,
    process.env.NEXT_PUBLIC_DODO_PLAYER_PRODUCT_ID,
  ].filter((id): id is string => Boolean(id));

  return {
    monthly: process.env.DODO_PRODUCT_ID_MONTHLY ?? null,
    yearly: process.env.DODO_PRODUCT_ID_YEARLY ?? null,
    legacy,
  };
}

export class BillingNotConfiguredError extends Error {
  constructor(planKey: PlanKey) {
    super(
      `No Dodo product configured for the ${BILLING_PLANS[planKey].label.toLowerCase()} plan. ` +
        `Set DODO_PRODUCT_ID_${planKey.toUpperCase()} (run pnpm --filter web dodo:setup-products).`,
    );
    this.name = "BillingNotConfiguredError";
  }
}

export function getProductIdForPlan(planKey: PlanKey): string {
  const catalog = getProductCatalog();
  const productId = catalog[planKey];
  if (!productId) {
    throw new BillingNotConfiguredError(planKey);
  }
  return productId;
}
