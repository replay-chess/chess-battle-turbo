import "server-only";
import type { PlanKey, ProductCatalog, ResolvedPlan } from "./plans";
import { BILLING_PLANS, E2E_FIXTURE_PRODUCT_ID, resolvePlanFromProductId } from "./plans";

/**
 * Product id stored on the entitled E2E fixture rows (defined in plans.ts so the pure resolver can
 * apply the rule). A test hook (`lib/test-hooks/registry.ts`, guard `isNonProdApp`): outside
 * production it resolves to the monthly plan, in production it resolves to nothing and reports a
 * Sentry warning (CT X3). Every `getProductCatalog()` caller gets this rule.
 */
export { E2E_FIXTURE_PRODUCT_ID };

/**
 * True on every non-production app: NEXT_PUBLIC_APP_ENV `dev` (replay-chess-dev)
 * or `test` (CI and devices builds), or unset in a non-production Node build
 * (local `next dev`, unit tests). Fails closed: `production`, any unknown value,
 * and an unset value in a production build are all false.
 */
export function isNonProdApp(
  appEnv: string | undefined = process.env.NEXT_PUBLIC_APP_ENV,
  nodeEnv: string | undefined = process.env.NODE_ENV,
): boolean {
  if (appEnv) return appEnv === "dev" || appEnv === "test";
  return nodeEnv !== "production";
}

/** A catalog with the fixture product ids this environment accepts as the monthly plan. */
export type CatalogWithFixtures = ProductCatalog & { fixtures: readonly string[] };

/**
 * Dodo Payments product IDs, read from the server environment.
 *
 * - DODO_PRODUCT_ID_MONTHLY: Coaching plan billed monthly ($4.99)
 * - DODO_PRODUCT_ID_YEARLY:  Coaching plan billed yearly ($50)
 * - DODO_LEGACY_PLAYER_PRODUCT_ID: the original $8/mo product, kept so
 *   existing subscribers stay recognized. NEXT_PUBLIC_DODO_PLAYER_PRODUCT_ID
 *   is accepted as a fallback for deployments that still set it.
 * - `fixtures`: `e2e-fixture` outside production, empty in production (where a
 *   fixture id is refused and reported through `onFixtureRefused`).
 *
 * Create the products with `pnpm --filter web dodo:setup-products`.
 */
export function getProductCatalog(nonProd: boolean = isNonProdApp()): CatalogWithFixtures {
  const legacy = [
    process.env.DODO_LEGACY_PLAYER_PRODUCT_ID,
    process.env.NEXT_PUBLIC_DODO_PLAYER_PRODUCT_ID,
  ].filter((id): id is string => Boolean(id));

  return {
    monthly: process.env.DODO_PRODUCT_ID_MONTHLY ?? null,
    yearly: process.env.DODO_PRODUCT_ID_YEARLY ?? null,
    legacy,
    fixtures: nonProd ? [E2E_FIXTURE_PRODUCT_ID] : [],
    ...(nonProd ? {} : { onFixtureRefused: warnFixtureInProduction }),
  };
}

let fixtureWarned = false;

function warnFixtureInProduction(productId: string): void {
  if (fixtureWarned) return;
  fixtureWarned = true;
  // Loaded lazily so unit tests and scripts don't pull in the Sentry SDK.
  void import("@sentry/nextjs")
    .then((Sentry) =>
      Sentry.captureMessage("billing.fixture_product_in_production", {
        level: "warning",
        extra: { productId },
      }),
    )
    .catch(() => {});
}

/**
 * Maps a product id to a plan, applying the fixture rule on top of
 * `resolvePlanFromProductId`: an id listed in `catalog.fixtures` resolves to the
 * monthly plan; `e2e-fixture` on a catalog without it (production) resolves to
 * null and reports one Sentry warning per process.
 */
export function resolveCatalogPlan(
  productId: string | null | undefined,
  catalog: ProductCatalog = getProductCatalog(),
  onFixtureRefused: (productId: string) => void = warnFixtureInProduction,
): ResolvedPlan | null {
  return resolvePlanFromProductId(productId, { ...catalog, onFixtureRefused });
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
