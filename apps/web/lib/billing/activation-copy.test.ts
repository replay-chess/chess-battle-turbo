// Phase-04 plan 4.6, 4.9: the copy helpers of the activating pages and TrialTermsLine.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ACTIVATION_FEATURES, destinationLabel, priceLabel, shortDateLabel, trialChargeDateFrom, trialTermsText, waitedLabel } from "./activation-copy";
import { PLAN_FEATURES, trialChargeDate } from "./copy";

describe("activation copy", () => {
  it("shortDateLabel formats d MMM in the viewer's zone, UTC for an unknown zone", () => {
    assert.equal(shortDateLabel("2026-11-05T22:30:00.000Z", "UTC"), "5 Nov");
    assert.equal(shortDateLabel("2026-11-05T22:30:00.000Z", "Asia/Kolkata"), "6 Nov");
    assert.equal(shortDateLabel("2026-11-05T22:30:00.000Z", "Not/AZone"), "5 Nov");
    assert.equal(shortDateLabel(null), null);
    assert.equal(shortDateLabel("nope"), null);
  });

  it("priceLabel uses the catalogue unless a (legacy) price is given", () => {
    assert.deepEqual(priceLabel("month"), { price: "$4.99", per: "month" });
    assert.deepEqual(priceLabel("year"), { price: "$50", per: "year" });
    assert.deepEqual(priceLabel("month", 800), { price: "$8", per: "month" });
  });

  it("trialTermsText: the trial and trial-used variants of plan 4.6", () => {
    assert.equal(trialTermsText({ trial: true, interval: "month", chargeDateLabel: "6 Nov" }), "Then $4.99/month. Cancel before 6 Nov and you won't be charged.");
    assert.equal(trialTermsText({ trial: false, interval: "month", chargeDateLabel: null }), "Billed $4.99 today, then monthly. Cancel any time.");
    assert.equal(trialTermsText({ trial: false, interval: "year", chargeDateLabel: "6 Nov" }), "Billed $50 today, then yearly. Cancel any time.");
  });

  it("waitedLabel rounds to seconds, then minutes", () => {
    assert.equal(waitedLabel(44_600), "45 s");
    assert.equal(waitedLabel(120_000), "2 min");
    assert.equal(waitedLabel(-5), "0 s");
    assert.equal(waitedLabel(3 * 3_600_000 + 5 * 60_000), "3 h 5 min");
  });

  it("destinationLabel names the section at a segment boundary; /games by default", () => {
    assert.equal(destinationLabel("/play?tc=blitz"), "Play");
    assert.equal(destinationLabel("/review/cabc"), "Your review");
    assert.equal(destinationLabel("/tournaments"), "Tournaments");
    assert.equal(destinationLabel("/tournament/x"), "Tournament");
    assert.equal(destinationLabel("/playground"), "My games");
    assert.equal(destinationLabel(null), "My games");
  });
});

describe("activation copy stays in step with copy.ts", () => {
  it("the aside rows are PLAN_FEATURES without the Weakness Profile; the charge date is day 8", () => {
    assert.deepEqual(ACTIVATION_FEATURES, PLAN_FEATURES.filter((f) => f !== "Your Weakness Profile"));
    const now = new Date("2026-11-05T12:00:00Z");
    assert.equal(trialChargeDateFrom(now).toISOString(), trialChargeDate(now).toISOString());
  });
});
