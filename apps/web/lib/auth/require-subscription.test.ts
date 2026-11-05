// Plan §12.1 lib/auth/require-subscription.test.ts: reasonFor() for the four reasons; the legacy mirror present iff
// LEGACY_402_MIRROR is on (default on).
import assert from "node:assert/strict";
import * as nodeModule from "node:module";
import { describe, it } from "node:test";

// products.ts starts with `import "server-only"`, which only Next.js resolves. Stub it first.
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

const { legacy402MirrorOn, reasonForRecord, subscriptionRequiredBody } = await import("./require-subscription");
type MembershipRecord = import("./membership").MembershipRecord;

const NOW = new Date("2026-11-05T12:00:00.000Z");
const DAY = 86_400_000;
const at = (ms: number) => new Date(NOW.getTime() + ms);
const catalog = { monthly: "pdt_m", yearly: "pdt_y", legacy: ["pdt_old"] };

const base: MembershipRecord = {
  role: "USER",
  dodoCustomerId: null,
  plan: null,
  planInterval: null,
  subscriptionId: null,
  subscriptionStatus: null,
  subscriptionProductId: null,
  currentPeriodEnd: null,
  cancelAtPeriodEnd: false,
  subscriptionUpdatedAt: null,
  trialStartedAt: null,
  trialEndsAt: null,
};

describe("reasonForRecord (plan §8.3)", () => {
  it("the four reasons", () => {
    assert.equal(reasonForRecord(base, NOW, catalog), "trial_available");
    assert.equal(
      reasonForRecord(
        { ...base, subscriptionId: "s", subscriptionStatus: "cancelled", trialStartedAt: at(-10 * DAY), trialEndsAt: at(-3 * DAY), currentPeriodEnd: at(-3 * DAY) },
        NOW,
        catalog,
      ),
      "trial_used",
    );
    assert.equal(reasonForRecord({ ...base, subscriptionId: "s", subscriptionStatus: "failed", currentPeriodEnd: at(-2 * DAY) }, NOW, catalog), "payment_failed");
    assert.equal(reasonForRecord({ ...base, subscriptionId: "s", subscriptionStatus: "expired", currentPeriodEnd: at(-90 * DAY) }, NOW, catalog), "expired");
  });
});

describe("402 body (plan §7.1)", () => {
  it("envelope with details.reason + upgradeUrl, and the top-level mirror while LEGACY_402_MIRROR is on", () => {
    const body = subscriptionRequiredBody("trial_used", "req-1", {});
    assert.deepEqual(body, {
      code: "subscription_required",
      upgradeUrl: "/pricing?reason=ended",
      error: {
        code: "subscription_required",
        message: "A ReplayChess membership is needed for this.",
        details: { reason: "trial_used", upgradeUrl: "/pricing?reason=ended" },
        requestId: "req-1",
      },
    });
    assert.equal(subscriptionRequiredBody("trial_available", "r", { LEGACY_402_MIRROR: "on" }).upgradeUrl, "/pricing?reason=required");
  });
  it("no mirror with LEGACY_402_MIRROR=off", () => {
    const body = subscriptionRequiredBody("expired", "req-2", { LEGACY_402_MIRROR: "off" });
    assert.deepEqual(Object.keys(body), ["error"]);
    assert.equal(legacy402MirrorOn({ LEGACY_402_MIRROR: "OFF" }), false);
    assert.equal(legacy402MirrorOn({}), true);
  });
});
