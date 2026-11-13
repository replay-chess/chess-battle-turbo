// Onboarding step lists and the stepper mapping (phase-04 plan §4.0, §8.1).
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { PENDING_CHECKOUT_TTL_MS as CONTRACT_TTL } from "@repo/contracts/http/billing";
import { ONBOARDING_STEPS, ONBOARDING_STEPS_DB } from "@repo/contracts/http/p04-plain";
import {
  ORDER,
  PAGES,
  PENDING_CHECKOUT_TTL_MS,
  STEPPER,
  defaultBackPage,
  isOnbPage,
  isOnbStep,
  pageOf,
  stepIndex,
  stepLabel,
  stepOf,
  stepPath,
  stepperPosition,
  stepperState,
  stepperTarget,
} from "./steps";

describe("step lists", () => {
  it("ORDER is the DB enum order of the contract, PAGES the wire order", () => {
    assert.deepEqual([...ORDER], [...ONBOARDING_STEPS_DB]);
    assert.deepEqual([...PAGES], [...ONBOARDING_STEPS]);
  });

  it("the pending-checkout TTL equals the billing contract's", () => {
    assert.equal(PENDING_CHECKOUT_TTL_MS, CONTRACT_TTL);
    assert.equal(PENDING_CHECKOUT_TTL_MS, 30 * 60_000);
  });

  it("pageOf / stepOf round-trip, stepIndex agrees for both spellings", () => {
    for (const [i, step] of ORDER.entries()) {
      const page = pageOf(step);
      assert.equal(stepOf(page), step);
      assert.equal(stepIndex(step), i);
      assert.equal(stepIndex(page), i);
      assert.equal(stepPath(page), `/onboarding/${page}`);
    }
  });

  it("type guards", () => {
    assert.equal(isOnbPage("level"), true);
    assert.equal(isOnbPage("LEVEL"), false);
    assert.equal(isOnbPage("resolver"), false);
    assert.equal(isOnbStep("LEVEL"), true);
    assert.equal(isOnbStep("level"), false);
    assert.equal(isOnbStep(undefined), false);
  });
});

describe("stepper (§4.0 mapping)", () => {
  it("WELCOME, LINK, CONFIRM → 1 Accounts; LEVEL → 2; GOALS → 3; PLAN, ACTIVATING → 4; DONE → all done", () => {
    assert.equal(stepperPosition("welcome"), 0);
    assert.equal(stepperPosition("link"), 1);
    assert.equal(stepperPosition("confirm"), 1);
    assert.equal(stepperPosition("level"), 2);
    assert.equal(stepperPosition("goals"), 3);
    assert.equal(stepperPosition("plan"), 4);
    assert.equal(stepperPosition("activating"), 4);
    assert.equal(stepperPosition("done"), 5);
  });

  it("item states per page (V3OnbLink: 1 current; V3OnbRating: 1 done, 2 current; done: all done)", () => {
    assert.deepEqual(STEPPER.map((s) => stepperState("welcome", s.n)), ["todo", "todo", "todo", "todo"]);
    assert.deepEqual(STEPPER.map((s) => stepperState("link", s.n)), ["current", "todo", "todo", "todo"]);
    assert.deepEqual(STEPPER.map((s) => stepperState("level", s.n)), ["done", "current", "todo", "todo"]);
    assert.deepEqual(STEPPER.map((s) => stepperState("activating", s.n)), ["done", "done", "done", "current"]);
    assert.deepEqual(STEPPER.map((s) => stepperState("done", s.n)), ["done", "done", "done", "done"]);
  });

  it("a done item links back to its first page", () => {
    assert.deepEqual(STEPPER.map((s) => stepperTarget(s.n)), ["link", "level", "goals", "plan"]);
  });

  it("mobile labels", () => {
    assert.equal(stepLabel("welcome"), "Welcome");
    assert.equal(stepLabel("link"), "Step 1 of 4 · Accounts");
    assert.equal(stepLabel("confirm"), "Step 1 of 4 · Accounts");
    assert.equal(stepLabel("level"), "Step 2 of 4 · Level");
    assert.equal(stepLabel("goals"), "Step 3 of 4 · Goals");
    assert.equal(stepLabel("plan"), "Step 4 of 4 · Plan");
    assert.equal(stepLabel("done"), "All set");
  });

  it("default back targets (Alt+← / back arrow)", () => {
    assert.equal(defaultBackPage("welcome"), null);
    assert.equal(defaultBackPage("link"), "welcome");
    assert.equal(defaultBackPage("confirm"), "link");
    assert.equal(defaultBackPage("level"), "link");
    assert.equal(defaultBackPage("goals"), "level");
    assert.equal(defaultBackPage("plan"), "goals");
    assert.equal(defaultBackPage("activating"), "plan");
    assert.equal(defaultBackPage("done"), null);
  });
});
