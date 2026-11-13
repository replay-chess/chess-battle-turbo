// Welcome row 04 (phase-04 plan §4.1; D9).
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { welcomeMembership, welcomeMembershipRow } from "./welcome-view";

describe("welcomeMembershipRow", () => {
  it("not a member: the free trial when eligible, else the membership", () => {
    assert.deepEqual(welcomeMembershipRow(true, null), { text: "Start your free trial", tag: "7 DAYS FREE" });
    assert.deepEqual(welcomeMembershipRow(false, null), { text: "Start your membership", tag: null });
  });
  it("regression: D9 — a trialist who started at /pricing is not asked to start a membership", () => {
    assert.deepEqual(welcomeMembershipRow(false, { kind: "trial", daysLeft: 7 }), { text: "Your free trial has started", tag: "7 DAYS LEFT" });
    assert.deepEqual(welcomeMembershipRow(false, { kind: "trial", daysLeft: 1 }), { text: "Your free trial has started", tag: "1 DAY LEFT" });
    assert.deepEqual(welcomeMembershipRow(false, { kind: "trial", daysLeft: null }), { text: "Your free trial has started", tag: "TRIAL" });
  });
  it("a paying member: the membership is active", () => {
    assert.deepEqual(welcomeMembershipRow(false, { kind: "member" }), { text: "Your membership is active", tag: null });
  });
});

describe("welcomeMembership", () => {
  it("from the viewer's entitlement", () => {
    assert.equal(welcomeMembership({ member: false, trial: { active: false, daysLeft: null } }), null);
    assert.deepEqual(welcomeMembership({ member: true, trial: { active: true, daysLeft: 6 } }), { kind: "trial", daysLeft: 6 });
    assert.deepEqual(welcomeMembership({ member: true, trial: { active: false, daysLeft: null } }), { kind: "member" });
  });
});
