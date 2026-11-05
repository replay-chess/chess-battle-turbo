import assert from "node:assert/strict";
import * as nodeModule from "node:module";
import { describe, it } from "node:test";

// products.ts starts with `import "server-only"`, which only Next.js resolves.
// Stub it for this test process before loading the module.
const STUB = "data:text/javascript,export%20%7B%7D";
if (typeof nodeModule.registerHooks === "function") {
  nodeModule.registerHooks({
    resolve: (specifier, context, next) =>
      specifier === "server-only" ? { url: STUB, shortCircuit: true } : next(specifier, context),
  });
} else {
  nodeModule.register(
    "data:text/javascript," +
      encodeURIComponent(
        `export async function resolve(s, c, n) { return s === "server-only" ? { url: ${JSON.stringify(STUB)}, shortCircuit: true } : n(s, c); }`,
      ),
  );
}

const { E2E_FIXTURE_PRODUCT_ID, getProductCatalog, isNonProdApp, resolveCatalogPlan } = await import("./products");

const base = { monthly: "pdt_m", yearly: "pdt_y", legacy: ["pdt_old"] };

describe("isNonProdApp", () => {
  it("is true for dev and test apps", () => {
    assert.equal(isNonProdApp("dev", "production"), true);
    assert.equal(isNonProdApp("test", "production"), true);
  });

  it("is false for production and unknown app envs", () => {
    assert.equal(isNonProdApp("production", "production"), false);
    assert.equal(isNonProdApp("production", "development"), false);
    assert.equal(isNonProdApp("staging", "development"), false);
  });

  it("with the app env unset, follows the build: local dev and tests yes, a production build no", () => {
    assert.equal(isNonProdApp(undefined, "development"), true);
    assert.equal(isNonProdApp(undefined, "test"), true);
    assert.equal(isNonProdApp(undefined, "production"), false);
    assert.equal(isNonProdApp("", "production"), false);
  });
});

describe("fixture product rule", () => {
  it("the catalog lists e2e-fixture only outside production", () => {
    assert.deepEqual(getProductCatalog(true).fixtures, [E2E_FIXTURE_PRODUCT_ID]);
    assert.deepEqual(getProductCatalog(false).fixtures, []);
  });

  it("e2e-fixture resolves to the monthly plan in dev and test", () => {
    const resolved = resolveCatalogPlan(E2E_FIXTURE_PRODUCT_ID, { ...base, fixtures: [E2E_FIXTURE_PRODUCT_ID] });
    assert.deepEqual(resolved, { plan: "player", planKey: "monthly", interval: "month", priceCents: 499, legacy: false });
  });

  it("e2e-fixture resolves to no plan in production and reports it", () => {
    const refused: string[] = [];
    const resolved = resolveCatalogPlan(E2E_FIXTURE_PRODUCT_ID, { ...base, fixtures: [] }, (id) => refused.push(id));
    assert.equal(resolved, null);
    assert.deepEqual(refused, [E2E_FIXTURE_PRODUCT_ID]);
  });

  it("real products resolve exactly as before, in every environment", () => {
    for (const fixtures of [[], [E2E_FIXTURE_PRODUCT_ID]]) {
      const catalog = { ...base, fixtures };
      assert.equal(resolveCatalogPlan("pdt_m", catalog)?.planKey, "monthly");
      assert.equal(resolveCatalogPlan("pdt_y", catalog)?.planKey, "yearly");
      assert.equal(resolveCatalogPlan("pdt_old", catalog)?.planKey, "legacy");
      assert.equal(resolveCatalogPlan("pdt_unknown", catalog), null);
      assert.equal(resolveCatalogPlan(null, catalog), null);
    }
  });

  it("a catalog without the fixtures field (old callers) refuses the fixture", () => {
    assert.equal(resolveCatalogPlan(E2E_FIXTURE_PRODUCT_ID, base, () => {}), null);
  });

  it("is applied on the runtime path: entitlement summaries use getProductCatalog()'s rule", async () => {
    const { summarizeEntitlement } = await import("./entitlement-rules");
    const { resolvePlanFromProductId } = await import("./plans");
    const record = {
      plan: "player",
      planInterval: "month",
      subscriptionId: "sub_e2e",
      subscriptionStatus: "active",
      subscriptionProductId: E2E_FIXTURE_PRODUCT_ID,
      currentPeriodEnd: new Date(Date.now() + 86_400_000),
      cancelAtPeriodEnd: false,
      subscriptionUpdatedAt: null,
    };
    assert.equal(summarizeEntitlement(record, getProductCatalog(true)).planKey, "monthly");
    assert.equal(resolvePlanFromProductId(E2E_FIXTURE_PRODUCT_ID, getProductCatalog(true))?.planKey, "monthly");

    const refused: string[] = [];
    const prodCatalog = { ...getProductCatalog(false), onFixtureRefused: (id: string) => refused.push(id) };
    assert.equal(summarizeEntitlement(record, prodCatalog).planKey, null);
    assert.deepEqual(refused, [E2E_FIXTURE_PRODUCT_ID]);
    assert.equal(typeof getProductCatalog(false).onFixtureRefused, "function", "production reports refused fixtures");
    assert.equal(getProductCatalog(true).onFixtureRefused, undefined);
  });
});
