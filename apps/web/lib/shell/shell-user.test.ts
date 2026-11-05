import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { pathToFileURL } from "node:url";
import path from "node:path";
import {
  PAYMENT_EXPIRED_WINDOW_MS,
  PAYMENT_LAST_DAY_MS,
  formatShellDate,
  paymentIssueStateOf,
  toShellSession,
  type ShellUserRecord,
} from "./shell-user";

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

// 1A·P7: V3PaymentFailed states (plan §4.5, §8.2 `paymentIssue`).
describe("paymentIssueState", () => {
  const at = (ms: number) => new Date(NOW.getTime() + ms);
  const state = (r: ShellUserRecord) => toShellSession(r, opts).user.paymentIssueState;

  /** Billing records with the state the plan's §8.2 rule gives them. Shared with the /api/me parity check below. */
  const CASES: Array<{ name: string; record: ShellUserRecord; expected: "banner" | "last_day" | "expired" | null }> = [
    { name: "active member", record: activeMember(), expected: null },
    { name: "no subscription", record: record(), expected: null },
    { name: "past_due, 4 days left", record: activeMember({ subscriptionStatus: "past_due", currentPeriodEnd: at(4 * DAY) }), expected: "banner" },
    { name: "on_hold, 37 h left", record: activeMember({ subscriptionStatus: "on_hold", currentPeriodEnd: at(37 * HOUR) }), expected: "banner" },
    { name: "past_due, exactly 36 h left", record: activeMember({ subscriptionStatus: "past_due", currentPeriodEnd: at(PAYMENT_LAST_DAY_MS) }), expected: "last_day" },
    { name: "past_due, 30 h left", record: activeMember({ subscriptionStatus: "past_due", currentPeriodEnd: at(30 * HOUR) }), expected: "last_day" },
    { name: "on_hold, 1 minute left", record: activeMember({ subscriptionStatus: "on_hold", currentPeriodEnd: at(60_000) }), expected: "last_day" },
    { name: "failed after the period", record: activeMember({ subscriptionStatus: "failed", currentPeriodEnd: at(-2 * DAY) }), expected: "expired" },
    { name: "past_due after the period", record: activeMember({ subscriptionStatus: "past_due", currentPeriodEnd: at(-HOUR) }), expected: "expired" },
    { name: "on_hold, ended exactly 30 days ago", record: activeMember({ subscriptionStatus: "on_hold", currentPeriodEnd: at(-PAYMENT_EXPIRED_WINDOW_MS) }), expected: "expired" },
    { name: "failed, ended 31 days ago", record: activeMember({ subscriptionStatus: "failed", currentPeriodEnd: at(-31 * DAY) }), expected: null },
    { name: "failed without a period end", record: activeMember({ subscriptionStatus: "failed", currentPeriodEnd: null }), expected: null },
    { name: "expired (not a payment failure)", record: activeMember({ subscriptionStatus: "expired", currentPeriodEnd: at(-DAY) }), expected: null },
    { name: "cancelled now", record: activeMember({ subscriptionStatus: "cancelled", currentPeriodEnd: at(-DAY) }), expected: null },
    { name: "cancelling at period end", record: activeMember({ cancelAtPeriodEnd: true }), expected: null },
  ];

  for (const c of CASES) {
    it(`${c.name} -> ${c.expected ?? "null"}`, () => {
      assert.equal(state(c.record), c.expected);
    });
  }

  it("keeps paymentFailed for the banner and last_day states (older callers)", () => {
    const lastDay = toShellSession(activeMember({ subscriptionStatus: "past_due", currentPeriodEnd: at(30 * HOUR) }), opts);
    assert.equal(lastDay.member, true);
    assert.equal(lastDay.user.paymentFailed, true);
    assert.equal(lastDay.user.paymentFailedUntilLabel, "Nov 6");
  });

  it("an expired payment failure is not a member", () => {
    const expired = toShellSession(activeMember({ subscriptionStatus: "failed", currentPeriodEnd: at(-2 * DAY) }), opts);
    assert.equal(expired.member, false);
    assert.equal(expired.user.paymentIssueState, "expired");
  });

  it("paymentIssueStateOf works on a bare summary", () => {
    assert.equal(paymentIssueStateOf({ entitled: true, status: "past_due", currentPeriodEnd: at(DAY).toISOString() }, NOW), "last_day");
    assert.equal(paymentIssueStateOf({ entitled: true, status: "active", currentPeriodEnd: at(DAY).toISOString() }, NOW), null);
    assert.equal(paymentIssueStateOf({ entitled: false, status: null, currentPeriodEnd: null }, NOW), null);
  });

  // Plan §8.2: the shell and /api/me must agree. `lib/auth/viewer.ts` (1B·F4a) is not in the tree yet; this
  // check runs once it is, and is skipped until then. The specifier is computed so the type check and the
  // test runner don't need the module to exist.
  it("matches toMeData(record).entitlement.paymentIssue?.state for member records", async (t) => {
    const specifier = pathToFileURL(path.resolve(import.meta.dirname, "../auth/viewer.ts")).href;
    let mod: { toMeData?: (...args: unknown[]) => { entitlement: { member: boolean; paymentIssue: { state: string } | null } } };
    try {
      mod = (await import(specifier)) as typeof mod;
    } catch {
      t.skip("lib/auth/viewer.ts (1B·F4a) not present yet");
      return;
    }
    if (typeof mod.toMeData !== "function") {
      t.skip("lib/auth/viewer.ts has no toMeData export yet");
      return;
    }
    for (const c of CASES) {
      const me = mod.toMeData(c.record, { now: NOW, paywallEnabled: true, catalog, flags: {}, buildId: "test" });
      if (!me.entitlement.member) continue;
      assert.equal(state(c.record), me.entitlement.paymentIssue?.state ?? null, c.name);
    }
  });
});
