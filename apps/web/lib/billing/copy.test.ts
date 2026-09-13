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
