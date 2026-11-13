// Done step copy (phase-04 plan §4.8).
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ONB_TOTAL_MS_MAX, doneBody, donePlanFailedHref, doneTag, legendPositionHref, totalOnboardingMs } from "./done-view";

describe("doneTag", () => {
  it("a trial: days left (singular at 1)", () => {
    assert.deepEqual(doneTag({ entitled: true, trialActive: true, daysLeft: 7 }), { tone: "trial", text: "Trial · 7 days left" });
    assert.deepEqual(doneTag({ entitled: true, trialActive: true, daysLeft: 1 }), { tone: "trial", text: "Trial · 1 day left" });
  });
  it("a paid member: no trial tag", () => {
    assert.equal(doneTag({ entitled: true, trialActive: false, daysLeft: null }), null);
  });
  it("not confirmed yet: Trial starting… (no day count)", () => {
    assert.deepEqual(doneTag({ entitled: false, trialActive: false, daysLeft: null }), { tone: "starting", text: "Trial starting…" });
  });
});

describe("doneBody", () => {
  it("names the provider, or 'your games'", () => {
    assert.equal(
      doneBody("Chess.com"),
      "The coach is analysing your Chess.com games now. Your first review and puzzle set land on Home. Warm up with a classic position while you wait.",
    );
    assert.match(doneBody(null), /^The coach is analysing your games now\./);
    assert.match(doneBody("Chess.com and Lichess"), /your Chess\.com and Lichess games/);
  });
});

describe("legendPositionHref", () => {
  it("the legacy position page, or hidden (D4-14)", () => {
    assert.equal(legendPositionHref("cm1abc"), "/position/cm1abc");
    assert.equal(legendPositionHref(null), null);
  });
});

describe("totalOnboardingMs", () => {
  it("measures from the start mark, clamped to one day", () => {
    assert.equal(totalOnboardingMs(1_000, 61_000), 60_000);
    assert.equal(totalOnboardingMs(0, ONB_TOTAL_MS_MAX * 3), ONB_TOTAL_MS_MAX);
  });
  it("no mark, a future mark or garbage → 0", () => {
    assert.equal(totalOnboardingMs(null, 5_000), 0);
    assert.equal(totalOnboardingMs(10_000, 5_000), 0);
    assert.equal(totalOnboardingMs(Number.NaN, 5_000), 0);
  });
});

describe("donePlanFailedHref", () => {
  it("regression: done-trial-starting-no-failure-path (FIX-1): a declined card goes back to the plan it picked, with the failed banner", () => {
    assert.equal(donePlanFailedHref({ plan: { interval: "year", priceCents: 3999, legacy: false } }), "/onboarding/plan?status=failed&plan=yearly");
    assert.equal(donePlanFailedHref({ plan: { interval: "month", priceCents: 499, legacy: false } }), "/onboarding/plan?status=failed&plan=monthly");
    assert.equal(donePlanFailedHref(null), "/onboarding/plan?status=failed&plan=monthly");
  });
});
