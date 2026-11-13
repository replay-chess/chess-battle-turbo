// Phase-04 plan 8.5.4: which steps each entitlement change triggers, and that every step is independent (one failure
// never stops the next, the fan-out never throws). The SQL-backed version runs in test/integration/fanout.int.test.ts.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { EntitlementSummary } from "./entitlement-rules";
import { backlogKickBody, fanoutPlan, isPaidPeriod, onEntitlementApplied, onPaymentEffects, type FanoutDeps, type FanoutStep, type FanoutUser } from "./fanout";

const NOW = new Date("2026-11-12T10:00:00.000Z");
const TRIAL_END = "2026-11-19T10:00:00.000Z";

function summary(over: Omit<Partial<EntitlementSummary>, "trial"> & { trial?: Partial<EntitlementSummary["trial"]> } = {}): EntitlementSummary {
  const { trial, ...rest } = over;
  return {
    entitled: false,
    plan: null,
    planKey: null,
    interval: null,
    priceCents: null,
    status: null,
    subscriptionId: null,
    currentPeriodEnd: null,
    cancelAtPeriodEnd: false,
    ...rest,
    trial: { active: false, used: false, endsAt: null, daysLeft: 0, ...trial },
  };
}

const none = summary();
const trialing = summary({
  entitled: true,
  plan: "player",
  planKey: "monthly",
  interval: "month",
  priceCents: 499,
  status: "active",
  subscriptionId: "sub_1",
  currentPeriodEnd: TRIAL_END,
  trial: { active: true, used: true, endsAt: TRIAL_END, daysLeft: 7 },
});
// After the first charge: same trial dates, the period moved a month on; trial no longer active.
const paidAfterTrial = summary({
  ...trialing,
  currentPeriodEnd: "2026-12-19T10:00:00.000Z",
  trial: { active: false, used: true, endsAt: TRIAL_END, daysLeft: 0 },
});
const paidNoTrial = summary({ ...trialing, currentPeriodEnd: "2026-12-12T10:00:00.000Z", trial: { active: false, used: false, endsAt: null } });
const lapsed = summary({ status: "expired", subscriptionId: "sub_1", currentPeriodEnd: "2026-11-10T10:00:00.000Z", trial: { used: true, endsAt: TRIAL_END } });

describe("fanoutPlan", () => {
  it("new trialist: entitled + first trial, not yet paid", () => {
    assert.deepEqual(fanoutPlan(none, trialing), { becameEntitled: true, lostEntitlement: false, firstTrial: true, firstPaid: false });
    assert.deepEqual(fanoutPlan(null, trialing), { becameEntitled: true, lostEntitlement: false, firstTrial: true, firstPaid: false });
  });

  it("trial → first charge: the backlog step only, even when the webhook lands after the trial ended", () => {
    assert.deepEqual(fanoutPlan(trialing, paidAfterTrial), { becameEntitled: false, lostEntitlement: false, firstTrial: false, firstPaid: true });
    // `before` is summarised at the current time: past the trial end it is no longer "active", the period still says trial.
    const staleBefore = summary({ ...trialing, trial: { active: false, used: true, endsAt: TRIAL_END } });
    assert.equal(fanoutPlan(staleBefore, paidAfterTrial).firstPaid, true);
  });

  it("a member who never trialled: entitled and paid at once", () => {
    assert.deepEqual(fanoutPlan(none, paidNoTrial), { becameEntitled: true, lostEntitlement: false, firstTrial: false, firstPaid: true });
  });

  it("a renewal of a paid member changes nothing but the emit", () => {
    const renewed = summary({ ...paidAfterTrial, currentPeriodEnd: "2027-01-19T10:00:00.000Z" });
    assert.deepEqual(fanoutPlan(paidAfterTrial, renewed), { becameEntitled: false, lostEntitlement: false, firstTrial: false, firstPaid: false });
  });

  it("lapse and return", () => {
    assert.deepEqual(fanoutPlan(paidAfterTrial, lapsed), { becameEntitled: false, lostEntitlement: true, firstTrial: false, firstPaid: false });
    const back = summary({ ...paidAfterTrial, subscriptionId: "sub_2", currentPeriodEnd: "2027-02-01T00:00:00.000Z" });
    assert.deepEqual(fanoutPlan(lapsed, back), { becameEntitled: true, lostEntitlement: false, firstTrial: false, firstPaid: true });
  });

  it("isPaidPeriod reads the stored dates, never the clock", () => {
    assert.equal(isPaidPeriod(trialing), false);
    assert.equal(isPaidPeriod(paidAfterTrial), true);
    assert.equal(isPaidPeriod(paidNoTrial), true);
    assert.equal(isPaidPeriod(lapsed), false);
    assert.equal(isPaidPeriod(summary({ ...trialing, currentPeriodEnd: null })), false);
  });
});

type Calls = Record<string, unknown[][]>;

function fakeDeps(over: Partial<FanoutDeps> = {}, user: Partial<FanoutUser> = {}) {
  const calls: Calls = {};
  const rec = (name: string, ...args: unknown[]) => {
    (calls[name] ??= []).push(args);
  };
  const deps: FanoutDeps = {
    readUser: async (id) => {
      rec("readUser", id);
      return {
        role: "USER",
        email: "k@example.com",
        dodoCustomerId: "cus_1",
        subscriptionUpdatedAt: NOW,
        trialStartedAt: new Date("2026-11-12T09:59:00.000Z"),
        membershipEndedAt: null,
        lastCheckoutSource: "onboarding",
        handles: [{ provider: "chesscom", usernameLower: "knightowl_88", verified: false }],
        ...user,
      };
    },
    emit: async (ref, data) => (rec("emit", ref, data), true),
    releaseWaitingImports: async (id) => (rec("release", id), { released: 1, queued: 1 }),
    kickImports: async () => void rec("kick"),
    recordLedger: async (input) => void rec("ledger", input),
    releaseBacklog: async (id) => (rec("backlog", id), { queued: 30, slices: 7 }),
    setMembershipEnded: async (id, at) => void rec("ended", id, at),
    clearPendingCheckout: async (id) => void rec("clear", id),
    capture: async (event, props, id) => void rec("capture", event, props, id),
    toWire: (after) => ({ state: after.entitled ? "trial" : "none" }) as never,
    log: (level, message, context) => void rec("log", level, message, context),
    now: () => NOW,
    readSummary: async (id) => (rec("summary", id), trialing),
    ...over,
  };
  return { deps, calls };
}

const input = (before: EntitlementSummary | null, after: EntitlementSummary) => ({
  userId: 7n,
  userRef: "cuserref000000000000000000",
  before,
  after,
  eventTime: NOW,
  source: "webhook" as const,
});

describe("onEntitlementApplied", () => {
  it("new trialist: emit, release + kick, ledger with every handle, trial_started, clear the pending checkout", async () => {
    const { deps, calls } = fakeDeps();
    const out = await onEntitlementApplied(input(none, trialing), deps);
    assert.deepEqual(out.ran, ["emit", "release_imports", "kick", "ledger", "trial_started", "clear_pending"] satisfies FanoutStep[]);
    assert.deepEqual(out.failed, []);
    const [ref, data] = calls.emit![0]!;
    assert.equal(ref, "cuserref000000000000000000");
    assert.deepEqual(data, { v: 1, entitlement: { state: "trial" }, subscriptionUpdatedAt: NOW.toISOString() });
    assert.deepEqual(calls.ledger![0]![0], {
      email: "k@example.com",
      handles: [{ provider: "chesscom", usernameLower: "knightowl_88", verified: false }],
      firstTrialAt: new Date("2026-11-12T09:59:00.000Z"),
    });
    assert.deepEqual(calls.capture![0], ["trial_started", { plan_interval: "month", source: "onboarding" }, "cuserref000000000000000000"]);
    assert.equal(calls.backlog, undefined, "no backlog during the trial (D4-09)");
  });

  it("no kick when nothing was released", async () => {
    const { deps, calls } = fakeDeps({ releaseWaitingImports: async () => ({ released: 0, queued: 0 }) });
    const out = await onEntitlementApplied(input(none, trialing), deps);
    assert.ok(!out.ran.includes("kick"));
    assert.equal(calls.kick, undefined);
  });

  it("trial → paid: the backlog and subscription_activated only (no release, no ledger)", async () => {
    const { deps, calls } = fakeDeps();
    const out = await onEntitlementApplied(input(trialing, paidAfterTrial), deps);
    assert.deepEqual(out.ran, ["emit", "backlog", "subscription_activated", "clear_pending"]);
    assert.deepEqual(calls.backlog, [[7n]]);
    assert.equal(calls.release, undefined);
    assert.equal(calls.ledger, undefined);
  });

  it("returning member: one release (its DAILY syncs included), one kick, then the backlog", async () => {
    const { deps, calls } = fakeDeps({}, { membershipEndedAt: new Date("2026-10-01T00:00:00Z") });
    const back = summary({ ...paidAfterTrial, subscriptionId: "sub_2" });
    const out = await onEntitlementApplied(input(lapsed, back), deps);
    assert.deepEqual(out.ran, ["emit", "release_imports", "kick", "backlog", "subscription_activated", "clear_pending"]);
    assert.equal(calls.release!.length, 1);
    assert.equal(calls.kick!.length, 1);
  });

  it("lapse: membershipEndedAt = the event time, nothing released or cleared", async () => {
    const { deps, calls } = fakeDeps();
    const out = await onEntitlementApplied(input(paidAfterTrial, lapsed), deps);
    assert.deepEqual(out.ran, ["emit", "membership_ended"]);
    assert.deepEqual(calls.ended, [[7n, NOW]]);
  });

  it("a failing step is logged and the rest still run; a refused emit counts as failed", async () => {
    const { deps, calls } = fakeDeps({
      emit: async () => false,
      releaseWaitingImports: async () => {
        throw new Error("boom");
      },
    });
    const out = await onEntitlementApplied(input(none, trialing), deps);
    assert.deepEqual(out.failed, ["emit", "release_imports"]);
    assert.deepEqual(out.ran, ["ledger", "trial_started", "clear_pending"]);
    assert.ok(calls.log!.some(([level, , ctx]) => level === "warn" && (ctx as { step: string }).step === "release_imports"));
  });

  it("an unreadable user stops the fan-out without throwing", async () => {
    const { deps } = fakeDeps({
      readUser: async () => {
        throw new Error("db down");
      },
    });
    assert.deepEqual(await onEntitlementApplied(input(none, trialing), deps), { ran: [], failed: ["emit"] });
  });
});

describe("onPaymentEffects", () => {
  it("a recorded failure emits entitlement:changed with paymentFailed and the current entitlement", async () => {
    const { deps, calls } = fakeDeps();
    const out = await onPaymentEffects({ userId: 7n, userRef: "cref", paymentFailed: true, releaseBacklog: false }, deps);
    assert.deepEqual(out, { ran: ["emit"], failed: [] });
    assert.deepEqual(calls.emit![0], ["cref", { v: 1, entitlement: { state: "trial" }, subscriptionUpdatedAt: NOW.toISOString(), paymentFailed: true }]);
    assert.equal(calls.backlog, undefined);
  });

  it("a paid charge releases the backlog; failures are reported, never thrown", async () => {
    const { deps, calls } = fakeDeps({ emit: async () => false });
    const out = await onPaymentEffects({ userId: 7n, userRef: "cref", paymentFailed: true, releaseBacklog: true }, deps);
    assert.deepEqual(out, { ran: ["backlog"], failed: ["emit"] });
    assert.deepEqual(calls.backlog, [[7n]]);
  });
});

describe("backlog release kick (D1)", () => {
  it("regression: import-analysis-wake: a release that queued slices kicks the analysis lane for the earliest slice", () => {
    const a = new Date("2026-11-14T21:35:00.000Z");
    const b = new Date("2026-11-13T21:35:00.000Z");
    assert.deepEqual(backlogKickBody({ queued: 52, slots: [{ runAt: a }, { runAt: b }] }), {
      v: 1,
      reason: "import",
      kinds: ["ANALYZE_GAME"],
      runAt: b.toISOString(),
    });
  });
  it("nothing queued: no kick", () => {
    assert.equal(backlogKickBody({ queued: 0, slots: [] }), null);
  });
});
