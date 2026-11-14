import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  MONEY_BACK_COPY,
  PLAN_FEATURES,
  SALES_FAQS,
  SUBSCRIBER_FAQS,
  formatBillingDate,
} from "./copy";

describe("billing copy", () => {
  it("formats billing dates as short US dates", () => {
    assert.equal(formatBillingDate("2026-09-10T12:00:00.000Z"), "Sep 10, 2026");
    assert.equal(formatBillingDate("not-a-date"), "—");
  });

  it("exposes a single feature list and both FAQ sets", () => {
    assert.equal(PLAN_FEATURES.length, 5);
    assert.ok(SALES_FAQS.length >= 5);
    assert.ok(SUBSCRIBER_FAQS.length >= 5);
    for (const faq of [...SALES_FAQS, ...SUBSCRIBER_FAQS]) {
      assert.ok(faq.question.length > 0);
      assert.ok(faq.answer.length > 0);
    }
    assert.match(SALES_FAQS[0]!.answer, /\$4\.99 per month, or \$50 per year/);
    assert.match(MONEY_BACK_COPY, /30-day/);
  });
});

describe("trial copy", () => {
  it("states the price and the cancel-by date under the trial button", async () => {
    const { trialTermsLine, trialChargeDate } = await import("./copy");
    const charge = trialChargeDate(new Date("2026-11-01T10:00:00Z"));
    assert.equal(charge.toISOString(), "2026-11-08T10:00:00.000Z");
    assert.equal(trialTermsLine("month", charge), "Then $4.99/month. Cancel before 8 Nov and you won't be charged.");
    assert.equal(trialTermsLine("year", charge), "Then $50/year. Cancel before 8 Nov and you won't be charged.");
  });

  it("the trial terms are hydration-safe: the server snapshot is date-free, the client's is the viewer's day", async () => {
    const { trialTermsLine, trialChargeLabelSnapshot } = await import("./copy");
    // Regression (INTEGRATE-2): the server (IST, past midnight) and the browser (UTC) printed different days.
    const snap = trialChargeLabelSnapshot(() => new Date("2026-11-13T19:00:00Z"));
    assert.equal(snap.server(), null);
    assert.equal(trialTermsLine("year", snap.server()), "Then $50/year. Cancel before your trial ends and you won't be charged.");
    assert.match(trialTermsLine("year", snap.client()), /^Then \$50\/year\. Cancel before (20|21) Nov and you won't be charged\.$/);
    // Stable by value between calls (useSyncExternalStore compares snapshots).
    assert.equal(snap.client(), snap.client());
  });

  it("says there is a trial and no free version", () => {
    const qs = SALES_FAQS.map((f) => f.question + " " + f.answer).join("\n");
    assert.match(qs, /7 days are free/);
    assert.match(qs, /no free version|Is there a free version\?/i);
    assert.doesNotMatch(qs, /do not require an account|Try page/);
  });
});

describe("trialMembershipCopy", () => {
  it("is null outside a trial", async () => {
    const { trialMembershipCopy } = await import("./copy");
    assert.equal(trialMembershipCopy({ trial: { active: false, endsAt: null, daysLeft: 0 } }), null);
    assert.equal(trialMembershipCopy({}), null);
  });

  it("shows days left and the first charge during the trial", async () => {
    const { trialMembershipCopy } = await import("./copy");
    const copy = trialMembershipCopy({
      trial: { active: true, endsAt: "2026-11-08T17:00:00Z", daysLeft: 5 },
      interval: "month",
      priceCents: 499,
    });
    assert.deepEqual(copy, {
      badge: "Trial · 5 days left",
      dateLabel: "First charge",
      dateValue: "8 Nov",
      note: "Your 7-day free trial is on. First charge $4.99/month on 8 Nov. Cancel before then and you won't be charged.",
    });
  });

  it("says 1 day, singular", async () => {
    const { trialMembershipCopy } = await import("./copy");
    assert.equal(
      trialMembershipCopy({ trial: { active: true, endsAt: "2026-11-08T17:00:00Z", daysLeft: 1 } })?.badge,
      "Trial · 1 day left",
    );
  });

  it("promises no charge when the trial was cancelled", async () => {
    const { trialMembershipCopy } = await import("./copy");
    const copy = trialMembershipCopy({
      trial: { active: true, endsAt: "2026-11-08T17:00:00Z", daysLeft: 3 },
      cancelAtPeriodEnd: true,
    });
    assert.equal(copy?.note, "Your trial ends on 8 Nov. You won't be charged.");
    assert.equal(copy?.dateLabel, "Trial ends");
  });
});
