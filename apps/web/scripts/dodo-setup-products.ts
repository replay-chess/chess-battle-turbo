/**
 * Creates (or finds) the ReplayChess Player subscription products in Dodo
 * Payments and prints the environment variables to set.
 *
 * Usage, from apps/web:
 *   pnpm dodo:setup-products            # test mode (default)
 *   pnpm dodo:setup-products -- --live  # live mode
 *   pnpm dodo:setup-products -- --dry-run
 *
 * Requires DODO_PAYMENTS_API_KEY in the environment or in .env.local.
 * The script is idempotent: a product whose metadata.replaychess_plan or
 * name matches an existing product is reused, never duplicated.
 */
import { config as loadEnv } from "dotenv";
import DodoPayments from "dodopayments";
import type { ProductCreateParams, ProductListResponse } from "dodopayments/resources/products/products";
import { BILLING_PLANS, PLAN_KEYS, type BillingPlan, type PlanKey } from "../lib/billing/plans";

loadEnv({ path: [".env.local", ".env"], quiet: true });

const args = new Set(process.argv.slice(2));
const dryRun = args.has("--dry-run");
const live = args.has("--live") || process.env.DODO_PAYMENTS_ENVIRONMENT === "live_mode";
const environment = live ? "live_mode" : "test_mode";

const apiKey = process.env.DODO_PAYMENTS_API_KEY;
if (!apiKey) {
  console.error("DODO_PAYMENTS_API_KEY is not set. Add it to apps/web/.env.local or export it.");
  process.exit(1);
}

const METADATA_KEY = "replaychess_plan";
const ENV_NAMES: Record<PlanKey, string> = {
  monthly: "DODO_PRODUCT_ID_MONTHLY",
  yearly: "DODO_PRODUCT_ID_YEARLY",
};

const client = new DodoPayments({ bearerToken: apiKey, environment });

function intervalFor(plan: BillingPlan): "Month" | "Year" {
  return plan.interval === "year" ? "Year" : "Month";
}

function buildCreateParams(plan: BillingPlan): ProductCreateParams {
  return {
    name: plan.dodoProductName,
    description: plan.dodoProductDescription,
    tax_category: "saas",
    metadata: { [METADATA_KEY]: plan.key },
    price: {
      type: "recurring_price",
      currency: "USD",
      price: plan.priceCents,
      discount: 0,
      purchasing_power_parity: false,
      tax_inclusive: false,
      payment_frequency_count: 1,
      payment_frequency_interval: intervalFor(plan),
      subscription_period_count: 1,
      subscription_period_interval: intervalFor(plan),
    },
  };
}

async function listRecurringProducts(): Promise<ProductListResponse[]> {
  const products: ProductListResponse[] = [];
  for await (const product of client.products.list({ recurring: true })) {
    products.push(product);
  }
  return products;
}

function findExisting(products: ProductListResponse[], plan: BillingPlan) {
  return (
    products.find((p) => p.metadata?.[METADATA_KEY] === plan.key) ??
    products.find((p) => p.name?.trim().toLowerCase() === plan.dodoProductName.toLowerCase())
  );
}

function describeExistingPrice(product: ProductListResponse): string {
  const detail = product.price_detail;
  if (detail?.type === "recurring_price") {
    return `${detail.currency} ${detail.price} every ${detail.payment_frequency_count} ${detail.payment_frequency_interval}`;
  }
  return product.price != null ? `${product.currency ?? ""} ${product.price}`.trim() : "unknown";
}

async function main() {
  console.log(`Dodo Payments environment: ${environment}${dryRun ? " (dry run)" : ""}\n`);

  const existing = await listRecurringProducts();
  const results: Record<PlanKey, string | null> = { monthly: null, yearly: null };
  const warnings: string[] = [];

  for (const key of PLAN_KEYS) {
    const plan = BILLING_PLANS[key];
    const found = findExisting(existing, plan);

    if (found) {
      results[key] = found.product_id;
      console.log(`✓ ${plan.dodoProductName}: reusing ${found.product_id}`);

      const detail = found.price_detail;
      const priceMatches =
        detail?.type === "recurring_price" &&
        detail.currency === "USD" &&
        detail.price === plan.priceCents &&
        detail.payment_frequency_interval === intervalFor(plan) &&
        detail.payment_frequency_count === 1;
      if (!priceMatches) {
        warnings.push(
          `${found.product_id} (${plan.dodoProductName}) is priced "${describeExistingPrice(found)}" ` +
            `but the app expects USD ${plan.priceCents} every 1 ${intervalFor(plan)}. ` +
            `Fix it in the Dodo dashboard or archive it and rerun this script.`,
        );
      }
      continue;
    }

    const params = buildCreateParams(plan);
    if (dryRun) {
      console.log(`• ${plan.dodoProductName}: would create`);
      console.log(JSON.stringify(params, null, 2));
      continue;
    }

    const created = await client.products.create(params);
    results[key] = created.product_id;
    console.log(`+ ${plan.dodoProductName}: created ${created.product_id}`);
  }

  console.log("\nAdd these to apps/web/.env.local and your hosting provider:\n");
  for (const key of PLAN_KEYS) {
    console.log(`${ENV_NAMES[key]}=${results[key] ?? "<created on next non-dry run>"}`);
  }
  console.log(
    "\nKeep the original $8/mo product ID in DODO_LEGACY_PLAYER_PRODUCT_ID so existing subscribers stay active.",
  );

  if (warnings.length > 0) {
    console.log("\nWarnings:");
    for (const warning of warnings) console.log(`- ${warning}`);
    process.exitCode = 2;
  }
}

main().catch((error) => {
  console.error("Failed to set up Dodo products:", error instanceof Error ? error.message : error);
  process.exit(1);
});
