// Phase-04 plan 10.1 (TST X6): every billing event accepts its documented shape, refuses extra keys and PII, and the
// sources it repeats stay equal to the wire contract.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
// Drift guard only: the analytics package has no runtime dependency on the contracts package.
import { CHECKOUT_SOURCES } from "../../../contracts/src/http/billing";
import { FORBIDDEN_PROPERTY_NAMES, findPii } from "../pii";
import { gameEvents } from "./game";
import { reviewEvents } from "./review";
import { shellEvents } from "./shell";
import { systemEvents } from "./system";
import {
  billingClientEvents,
  billingEvents,
  billingServerEvents,
  CHECKOUT_EVENT_SOURCES,
  checkoutStatusParam,
} from "./billing";

const samples: { [K in keyof typeof billingEvents]: Record<string, unknown> } = {
  checkout_started: { source: "onboarding", plan: "monthly", is_trial: true },
  checkout_start_failed: { code: "upstream_unavailable" },
  checkout_returned: { status_param: "active", source: "pricing" },
  checkout_activation_succeeded: { waited_ms: 2_400, via: "socket", is_trial: true, source: "onboarding" },
  checkout_activation_stalled: { waited_ms: 12_000, source: "paywall" },
  checkout_activation_failed: { reason: "declined", source: "renew" },
  checkout_check_again_clicked: { source: "pricing" },
  checkout_support_clicked: { source: "unknown" },
  trial_started: { plan_interval: "month", source: "onboarding" },
  subscription_activated: { plan_interval: "year", source: "pricing" },
  trial_ledger_hit: { kind: "email" },
};

describe("billing events (phase-04 plan 10.1)", () => {
  for (const [name, schema] of Object.entries(billingEvents)) {
    const sample = samples[name as keyof typeof samples];
    it(`${name} accepts its documented shape and refuses extra keys`, () => {
      assert.ok(schema.safeParse(sample).success, name);
      assert.equal(schema.safeParse({ ...sample, extra: 1 }).success, false);
    });
    it(`${name} declares no forbidden property and its sample carries no PII`, () => {
      for (const key of Object.keys(schema.shape)) assert.ok(!(FORBIDDEN_PROPERTY_NAMES as readonly string[]).includes(key), key);
      assert.deepEqual(findPii(sample), []);
    });
  }

  it("covers the §10.1 billing rows and collides with no P1–P3 event", () => {
    assert.deepEqual(Object.keys(billingClientEvents).sort(), [
      "checkout_activation_failed",
      "checkout_activation_stalled",
      "checkout_activation_succeeded",
      "checkout_check_again_clicked",
      "checkout_returned",
      "checkout_start_failed",
      "checkout_started",
      "checkout_support_clicked",
    ]);
    assert.deepEqual(Object.keys(billingServerEvents).sort(), ["subscription_activated", "trial_ledger_hit", "trial_started"]);
    const earlier = new Set([...Object.keys(shellEvents), ...Object.keys(systemEvents), ...Object.keys(gameEvents), ...Object.keys(reviewEvents)]);
    for (const name of Object.keys(billingEvents)) assert.ok(!earlier.has(name), name);
  });

  it("the sources equal the wire contract's CHECKOUT_SOURCES plus unknown", () => {
    assert.deepEqual(CHECKOUT_EVENT_SOURCES, [...CHECKOUT_SOURCES, "unknown"]);
  });

  it("checkoutStatusParam folds Dodo's status hint to the closed set", () => {
    assert.equal(checkoutStatusParam(null), "none");
    assert.equal(checkoutStatusParam("Active"), "active");
    assert.equal(checkoutStatusParam("failed"), "failed");
    assert.equal(checkoutStatusParam("requires_customer_action"), "other");
  });

  it("waited_ms is capped and integral; plan and kind enums are closed", () => {
    assert.equal(billingClientEvents.checkout_activation_stalled.safeParse({ waited_ms: 1.5, source: "pricing" }).success, false);
    assert.equal(billingClientEvents.checkout_activation_stalled.safeParse({ waited_ms: 3_600_000, source: "pricing" }).success, false);
    assert.equal(billingClientEvents.checkout_started.safeParse({ source: "pricing", plan: "weekly", is_trial: false }).success, false);
    assert.equal(billingServerEvents.trial_ledger_hit.safeParse({ kind: "ip" }).success, false);
  });
});
