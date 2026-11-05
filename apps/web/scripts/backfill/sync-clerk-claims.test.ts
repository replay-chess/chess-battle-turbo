import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { BackfillGuardError, assertBackfillTarget, planBatch, type ClaimsRow } from "./sync-clerk-claims";
import { computeClaims } from "../../lib/auth/claims";

const NOW = new Date("2026-11-05T12:00:00Z");
const DEV_URL = "postgresql://u:p@ep-fancy-dust-b8b3dp81-pooler.c-14.us-east-1.aws.neon.tech/neondb";
const PROD_URL = "postgresql://u:p@ep-shiny-shape-b8lvr0f5.us-east-1.aws.neon.tech/neondb";

function row(id: bigint, googleId: string, overrides: Partial<ClaimsRow> = {}): ClaimsRow {
  return {
    id,
    googleId,
    onboarded: false,
    role: "USER",
    subscriptionId: null,
    subscriptionStatus: null,
    currentPeriodEnd: null,
    cancelAtPeriodEnd: false,
    trialStartedAt: null,
    ...overrides,
  };
}

describe("planBatch", () => {
  it("writes only users whose claims differ; counts the ones Clerk does not know", () => {
    const member = row(2n, "user_b", { subscriptionId: "s", subscriptionStatus: "active", currentPeriodEnd: new Date("2026-12-01") });
    const plan = planBatch(
      [row(1n, "user_a"), member, row(3n, "seed_legend_x")],
      [
        { id: "user_a", public_metadata: { ...computeClaims(row(1n, "user_a"), NOW), other: "kept" } },
        { id: "user_b", public_metadata: {} },
      ],
      NOW,
    );
    assert.equal(plan.unchanged, 1);
    assert.equal(plan.missingInClerk, 1);
    assert.equal(plan.updates.length, 1);
    assert.equal(plan.updates[0]!.clerkUserId, "user_b");
    assert.equal(plan.updates[0]!.claims.entitled, true);
    assert.deepEqual(plan.updates[0]!.changedKeys.sort(), ["entitled", "lapsed", "onboarded", "role", "trialUsed", "v"]);
  });

  it("is idempotent: after the write, nothing is left to do", () => {
    const r = row(1n, "user_a", { onboarded: true });
    const first = planBatch([r], [{ id: "user_a", public_metadata: {} }], NOW);
    const second = planBatch([r], [{ id: "user_a", public_metadata: first.updates[0]!.claims }], NOW);
    assert.equal(second.updates.length, 0);
  });
});

describe("assertBackfillTarget", () => {
  const dev = { allowProduction: false, confirm: undefined };
  it("accepts the dev endpoint with a development key", () => {
    assert.deepEqual(assertBackfillTarget(DEV_URL, "sk_test_x", dev), {
      host: "ep-fancy-dust-b8b3dp81-pooler.c-14.us-east-1.aws.neon.tech",
      clerk: "development",
    });
  });
  it("refuses another database or a live key without the full P13 override", () => {
    assert.throws(() => assertBackfillTarget(PROD_URL, "sk_test_x", dev), BackfillGuardError);
    assert.throws(() => assertBackfillTarget(DEV_URL, "sk_live_x", dev), BackfillGuardError);
    assert.throws(() => assertBackfillTarget(PROD_URL, "sk_live_x", { allowProduction: true, confirm: "yes" }), BackfillGuardError);
    assert.throws(() => assertBackfillTarget(DEV_URL, undefined, dev), BackfillGuardError);
    assert.equal(assertBackfillTarget(PROD_URL, "sk_live_x", { allowProduction: true, confirm: "production" }).clerk, "production");
  });
});
