// Plan step copy and state mapping (phase-04 plan §4.6).
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  CHECKOUT_HINT,
  CTA_LOADING,
  checkoutErrorView,
  planBanner,
  planCard,
  planCopy,
  planParam,
  planTimeline,
  providersLabel,
  yearlyDiscountLabel,
} from "./plan-view";

describe("planParam", () => {
  it("defaults to monthly (the board's default, inv-pub Q5)", () => {
    assert.equal(planParam(undefined), "monthly");
    assert.equal(planParam(null), "monthly");
    assert.equal(planParam("weekly"), "monthly");
    assert.equal(planParam("monthly"), "monthly");
    assert.equal(planParam("yearly"), "yearly");
  });
});

describe("planCopy", () => {
  it("trial eligible: the board", () => {
    assert.deepEqual(planCopy(true), {
      h1: "Start your 7-day free trial.",
      lead: "Pick how you'll be billed after the trial. A card is needed now; nothing is charged today, and your games start importing as soon as the trial begins.",
      leadShort: "A card is needed now; nothing is charged today. One free trial per person.",
      cta: "Start 7-day free trial",
    });
  });

  it("trial used: membership copy", () => {
    const c = planCopy(false);
    assert.equal(c.h1, "Start your membership.");
    assert.equal(c.cta, "Start Coaching");
    assert.equal(c.lead, "Your free trial has been used. Billing starts today.");
  });

  it("loading and hint copy", () => {
    assert.equal(CTA_LOADING, "Opening secure checkout…");
    assert.equal(CHECKOUT_HINT, "Secure checkout by Dodo Payments. Prices in USD.");
  });
});

describe("planCard", () => {
  it("monthly", () => {
    assert.deepEqual(planCard("monthly"), { name: "Coaching", note: "Cancel any time", price: "$4.99", per: "/ month" });
  });
  it("yearly", () => {
    assert.deepEqual(planCard("yearly"), { name: "Coaching", note: "About $4.17 a month", price: "$50", per: "/ year" });
  });
  it("the yearly discount label", () => {
    assert.equal(yearlyDiscountLabel(), "−16%");
  });
});

describe("planTimeline", () => {
  it("trial: five rows, Every game is tall, Day 8 names the charge date", () => {
    const rows = planTimeline({ trialEligible: true, chargeDateLabel: "6 Nov", providers: "Chess.com" });
    assert.deepEqual(
      rows.map((r) => [r.when, r.what, r.tall]),
      [
        ["Today", "Your recent Chess.com games are analysed", false],
        ["Tomorrow", "Your first puzzle set, built from your mistakes", false],
        ["Week 1", "Your Weakness Profile shows your top patterns", false],
        ["Every game", "A coach review within a minute", true],
        ["Day 8", "First charge, unless you cancel before 6 Nov", false],
      ],
    );
  });

  it("phones show three short rows (V3iPhoneOnbPlan)", () => {
    const rows = planTimeline({ trialEligible: true, chargeDateLabel: "6 Nov", providers: "Chess.com" }).filter((r) => r.short);
    assert.deepEqual(
      rows.map((r) => [r.when, r.short]),
      [
        ["Today", "Recent games analysed"],
        ["Tomorrow", "First puzzles from your mistakes"],
        ["Week 1", "Weakness Profile ready"],
      ],
    );
  });

  it("trial used: no Day 8 row", () => {
    const rows = planTimeline({ trialEligible: false, chargeDateLabel: null, providers: "Lichess" });
    assert.equal(rows.length, 4);
    assert.ok(!rows.some((r) => r.when === "Day 8"));
    assert.equal(rows[0]!.what, "Your recent Lichess games are analysed");
  });

  it("no linked account", () => {
    assert.equal(planTimeline({ trialEligible: true, chargeDateLabel: "6 Nov", providers: null })[0]!.what, "Your games are analysed as you play them");
  });
});

describe("providersLabel", () => {
  it("names the linked providers", () => {
    assert.equal(providersLabel([]), null);
    assert.equal(providersLabel(["chesscom"]), "Chess.com");
    assert.equal(providersLabel(["lichess", "chesscom", "lichess"]), "Chess.com and Lichess");
  });
});

describe("planBanner", () => {
  it("failed card", () => {
    assert.deepEqual(planBanner({ status: "failed" }), { tone: "bad", text: "Card wasn't accepted. Nothing was charged.", testId: "onb-plan-failed" });
  });
  it("abandoned checkout", () => {
    assert.deepEqual(planBanner({ resume: "abandoned" }), { tone: "info", text: "Checkout wasn't finished. Pick a plan to try again.", testId: "onb-plan-abandoned" });
  });
  it("a failed card wins; nothing otherwise", () => {
    assert.equal(planBanner({ status: "failed", resume: "abandoned" })?.tone, "bad");
    assert.equal(planBanner({}), null);
    assert.equal(planBanner({ status: "succeeded" }), null);
  });
});

describe("checkoutErrorView", () => {
  it("maps each §4.6 code", () => {
    assert.deepEqual(checkoutErrorView("already_subscribed"), { kind: "navigate", to: "done" });
    assert.deepEqual(checkoutErrorView("payment_update_required"), { kind: "navigate", to: "portal" });
    assert.deepEqual(checkoutErrorView("not_configured"), { kind: "unavailable", text: "This plan is not available right now." });
    assert.deepEqual(checkoutErrorView("rate_limited"), { kind: "countdown" });
    for (const code of ["upstream_unavailable", "internal", "network"]) assert.equal(checkoutErrorView(code).kind, "retry");
  });
});
