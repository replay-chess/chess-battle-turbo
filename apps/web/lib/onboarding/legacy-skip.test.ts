import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { legacySkipDecision } from "./legacy-skip";

describe("legacy onboarding skip (plan §7.12, §11.1)", () => {
  it("regression: legacy-skip-bypasses-plan-required (FIX-1): with onboarding-v3 on the legacy skip is not served", () => {
    assert.equal(legacySkipDecision({ "onboarding-v3": true }), "not_found");
    assert.equal(legacySkipDecision({ "onboarding-v3": false }), "allow", "the legacy page (flag off) keeps its skip until the parity check");
  });
});
