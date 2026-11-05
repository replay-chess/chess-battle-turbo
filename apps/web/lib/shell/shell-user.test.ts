import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { formatShellDate, toShellSession, type ShellUserRecord } from "./shell-user";

const NOW = new Date("2026-11-05T12:00:00Z");
const FUTURE = new Date("2026-12-05T12:00:00Z");
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

const catalog = { monthly: "pdt_m", yearly: "pdt_y", legacy: ["pdt_old"] };
const opts = { now: NOW, paywallEnabled: true, catalog };

function record(overrides: Partial<ShellUserRecord> = {}): ShellUserRecord {
  return {
    referenceId: "ref_1",
    name: "Ada Lovelace",
    profilePictureUrl: null,
    role: "USER",
    dodoCustomerId: null,
    chessComProfile: null,
    plan: null,
    planInterval: null,
    subscriptionId: null,
    subscriptionStatus: null,
    subscriptionProductId: null,
    currentPeriodEnd: null,
    cancelAtPeriodEnd: false,
    subscriptionUpdatedAt: null,
    trialStartedAt: null,
    trialEndsAt: null,
    ...overrides,
  };
}

function activeMember(overrides: Partial<ShellUserRecord> = {}): ShellUserRecord {
  return record({
    plan: "player",
    planInterval: "month",
    subscriptionId: "sub_1",
    subscriptionStatus: "active",
    subscriptionProductId: "pdt_m",
    currentPeriodEnd: FUTURE,
    dodoCustomerId: "cus_1",
    ...overrides,
  });
}

describe("toShellSession", () => {
  it("makes an active subscriber a member", () => {
    const { member, user } = toShellSession(activeMember(), opts);
    assert.equal(member, true);
    assert.equal(user.referenceId, "ref_1");
    assert.equal(user.name, "Ada Lovelace");
    assert.equal(user.isAdmin, false);
    assert.equal(user.paymentFailed, false);
    assert.equal(user.trialDaysLeft, null);
  });

  it("makes an admin without a subscription a member with no billing portal", () => {
    const { member, user } = toShellSession(record({ role: "ADMIN" }), opts);
    assert.equal(member, true);
    assert.equal(user.isAdmin, true);
    assert.equal(user.hasBillingPortal, false);
  });

  it("offers the billing portal when a Dodo customer id is stored", () => {
    assert.equal(toShellSession(record({ dodoCustomerId: "cus_9" }), opts).user.hasBillingPortal, true);
    assert.equal(toShellSession(record(), opts).user.hasBillingPortal, false);
  });

  it("treats everyone as a member when the paywall is off", () => {
    assert.equal(toShellSession(record(), { ...opts, paywallEnabled: false }).member, true);
  });

  it("does not make a user without a subscription a member", () => {
    const { member, user } = toShellSession(record(), opts);
    assert.equal(member, false);
    assert.equal(user.paymentFailed, false);
    assert.equal(user.paymentFailedUntil, null);
    assert.equal(user.paymentFailedUntilLabel, null);
  });

  it("does not make an expired or immediately cancelled subscriber a member", () => {
    assert.equal(toShellSession(activeMember({ subscriptionStatus: "expired" }), opts).member, false);
    assert.equal(
      toShellSession(activeMember({ subscriptionStatus: "cancelled", cancelAtPeriodEnd: false }), opts).member,
      false,
    );
  });

  it("counts trial days left, rounded up", () => {
    const trial = (endsInMs: number) =>
      activeMember({
        trialStartedAt: new Date(NOW.getTime() - 2 * DAY),
        trialEndsAt: new Date(NOW.getTime() + endsInMs),
      });
    assert.equal(toShellSession(trial(5 * DAY), opts).user.trialDaysLeft, 5);
    assert.equal(toShellSession(trial(3 * HOUR), opts).user.trialDaysLeft, 1);
  });

  it("reports no trial once the trial window has passed", () => {
    const ended = activeMember({
      trialStartedAt: new Date(NOW.getTime() - 9 * DAY),
      trialEndsAt: new Date(NOW.getTime() - 2 * DAY),
    });
    assert.equal(toShellSession(ended, opts).user.trialDaysLeft, null);
  });

  it("flags a past_due member inside the period as a failed payment", () => {
    const until = new Date("2026-11-12T03:00:00Z");
    const { member, user } = toShellSession(
      activeMember({ subscriptionStatus: "past_due", currentPeriodEnd: until }),
      opts,
    );
    assert.equal(member, true);
    assert.equal(user.paymentFailed, true);
    assert.equal(user.paymentFailedUntil, "2026-11-12T03:00:00.000Z");
    assert.equal(user.paymentFailedUntilLabel, "Nov 12");
  });

  it("flags on_hold the same way", () => {
    const { user } = toShellSession(activeMember({ subscriptionStatus: "on_hold" }), opts);
    assert.equal(user.paymentFailed, true);
  });

  it("labels the Chess.com rating: blitz first, then rapid, else null", () => {
    const blitz = record({ chessComProfile: { blitzRating: 1184, rapidRating: 1300 } });
    const rapid = record({ chessComProfile: { blitzRating: null, rapidRating: 1422 } });
    const neither = record({ chessComProfile: { blitzRating: null, rapidRating: null } });
    assert.equal(toShellSession(blitz, opts).user.ratingLabel, "Blitz 1184");
    assert.equal(toShellSession(rapid, opts).user.ratingLabel, "Rapid 1422");
    assert.equal(toShellSession(neither, opts).user.ratingLabel, null);
    assert.equal(toShellSession(record(), opts).user.ratingLabel, null);
  });

  it("passes the avatar URL through", () => {
    const url = "https://img.clerk.com/abc";
    assert.equal(toShellSession(record({ profilePictureUrl: url }), opts).user.avatarUrl, url);
  });
});

describe("formatShellDate", () => {
  it("formats in UTC regardless of the late hour", () => {
    assert.equal(formatShellDate("2026-11-12T23:59:00Z"), "Nov 12");
    assert.equal(formatShellDate("2026-11-12T00:00:00Z"), "Nov 12");
  });

  it("returns null for missing or invalid input", () => {
    assert.equal(formatShellDate(null), null);
    assert.equal(formatShellDate("not a date"), null);
  });
});
