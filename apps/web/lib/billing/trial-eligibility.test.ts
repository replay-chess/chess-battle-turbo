import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { decideTrial } from "./trial-rules";
import { ledgerTrialEligible, withLedgerEligibility, type LedgerProbe } from "./trial-eligibility";

type V = Parameters<typeof withLedgerEligibility>[0];
const viewer = (eligible: boolean): V =>
  ({
    entitlement: { trial: { active: false, used: !eligible, endsAt: null, daysLeft: null, eligible } },
    billing: { email: "Kas.parov+x@googlemail.com" },
    ledgerHandles: [{ provider: "chesscom", usernameLower: "knightowl_88", verified: true }],
  }) as unknown as V;

describe("viewer trial eligibility with the ledger (plan 7.2, 8.4.3; FIX-1)", () => {
  it("regression: trial-eligible-ignores-ledger: a ledger hit makes the viewer ineligible, as the checkout decides", async () => {
    const calls: unknown[] = [];
    const hit: LedgerProbe = async (input) => {
      calls.push(input);
      return { hit: true, kind: "email" };
    };
    const v = viewer(true);
    const out = await withLedgerEligibility(v, hit);
    assert.equal(out.entitlement.trial.eligible, false);
    assert.equal(v.entitlement.trial.eligible, true, "the input viewer is not mutated");
    assert.deepEqual(calls, [{ email: "Kas.parov+x@googlemail.com", handles: [{ provider: "chesscom", usernameLower: "knightowl_88", verified: true }] }]);
    // The screens and the checkout now agree.
    const decision = await decideTrial({ trialStartedAt: null, trialEndsAt: null, subscriptionId: null }, async () => ({ hit: true, kind: "email" }));
    assert.equal(decision.trial, out.entitlement.trial.eligible);
  });

  it("a miss keeps the offer; an ineligible row never probes; a failed probe keeps the row's answer", async () => {
    const miss: LedgerProbe = async () => ({ hit: false, kind: null });
    assert.equal((await withLedgerEligibility(viewer(true), miss)).entitlement.trial.eligible, true);
    let probed = 0;
    const counting: LedgerProbe = async () => {
      probed++;
      return { hit: true, kind: "handle" };
    };
    assert.equal(await ledgerTrialEligible(viewer(false), counting), false);
    assert.equal(probed, 0, "members and used trials cost no statement");
    const errors: unknown[] = [];
    const broken: LedgerProbe = async () => {
      throw new Error("db down");
    };
    assert.equal(await ledgerTrialEligible(viewer(true), broken, (e) => errors.push(e)), true);
    assert.equal(errors.length, 1);
  });
});
