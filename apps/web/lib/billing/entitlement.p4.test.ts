// Phase-04 plan 8.5.4, 7.5.3 (interface-check §0.4): the compare-and-set's post-apply hook. It runs exactly once per
// write that landed, with the row's state before the write and the event time; never for a stale, unchanged or lost
// snapshot (so a replayed or out-of-order webhook fans out nothing); a failing hook never turns a write into an error.
import assert from "node:assert/strict";
import * as nodeModule from "node:module";
import { describe, it } from "node:test";

// entitlement.ts starts with `import "server-only"`, which only Next.js resolves. Stub it first.
const STUB = "data:text/javascript,export%20%7B%7D";
if (typeof nodeModule.registerHooks === "function") {
  nodeModule.registerHooks({
    resolve: (specifier, context, next) => (specifier === "server-only" ? { url: STUB, shortCircuit: true } : next(specifier, context)),
  });
} else {
  nodeModule.register(
    "data:text/javascript," +
      encodeURIComponent(`export async function resolve(s, c, n) { return s === "server-only" ? { url: ${JSON.stringify(STUB)}, shortCircuit: true } : n(s, c); }`),
  );
}

const { applySubscriptionSnapshot } = await import("./entitlement");
type SnapshotStore = import("./entitlement").SnapshotStore;
type SnapshotUser = import("./entitlement").SnapshotUser;
type AppliedChange = import("./entitlement").AppliedChange;
type SubscriptionSnapshot = import("./entitlement-rules").SubscriptionSnapshot;

const NOW = new Date("2026-11-05T12:00:00Z");
const EVENT = new Date("2026-11-05T11:59:58Z");

function row(over: Partial<SnapshotUser> = {}): SnapshotUser {
  return {
    id: 7n,
    referenceId: "cref7",
    email: "a@example.test",
    dodoCustomerId: null,
    subscriptionSourceAt: null,
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
    ...over,
  };
}

const trialSnap: SubscriptionSnapshot = {
  subscription_id: "sub_1",
  product_id: "pdt_m",
  status: "active",
  next_billing_date: "2026-11-12T12:00:00Z",
  cancel_at_next_billing_date: false,
  created_at: "2026-11-05T11:59:50Z",
  payment_frequency_interval: "Month",
  trial_period_days: 7,
  customer: { customer_id: "cus_1", email: "a@example.test" },
};

function store(initial: SnapshotUser, casResult: number[] = []): SnapshotStore & { rows: SnapshotUser[] } {
  const s = {
    rows: [initial],
    async findCandidates() {
      return s.rows;
    },
    async compareAndSet(id: bigint, expected: Date | null, data: Record<string, unknown>) {
      const forced = casResult.shift();
      if (forced !== undefined) return forced;
      const r = s.rows[0]!;
      if ((r.subscriptionSourceAt?.getTime() ?? null) !== (expected?.getTime() ?? null)) return 0;
      s.rows[0] = { ...r, ...(data as Partial<SnapshotUser>) };
      return 1;
    },
  };
  return s;
}

describe("applySubscriptionSnapshot post-apply hook (P4)", () => {
  it("a write that landed calls the hook once with before / after, the event time and the source; `before` is on the outcome", async () => {
    const changes: AppliedChange[] = [];
    const out = await applySubscriptionSnapshot(trialSnap, { source: "webhook", eventTime: EVENT, now: NOW }, {
      store: store(row()),
      log: () => {},
      afterApplied: (c) => void changes.push(c),
    });
    assert.equal(out.status, "applied");
    assert.equal(out.changed, true);
    assert.equal(changes.length, 1);
    const c = changes[0]!;
    assert.deepEqual([c.userId, c.userRef, c.source, c.eventTime.toISOString()], [7n, "cref7", "webhook", EVENT.toISOString()]);
    assert.equal(c.before.entitled, false);
    assert.equal(c.before.trial.used, false);
    assert.equal(c.after.entitled, true);
    assert.equal(c.after.trial.active, true);
    assert.deepEqual(out.status === "applied" ? out.before : null, c.before);
  });

  it("an API read without a provider time passes the write time as the event time", async () => {
    const changes: AppliedChange[] = [];
    await applySubscriptionSnapshot(trialSnap, { source: "api", now: NOW }, { store: store(row()), log: () => {}, afterApplied: (c) => void changes.push(c) });
    assert.equal(changes[0]!.eventTime.toISOString(), NOW.toISOString());
  });

  it("no hook for a replay (unchanged), a stale snapshot or a CAS that never lands", async () => {
    const changes: AppliedChange[] = [];
    const hook = (c: AppliedChange) => void changes.push(c);
    const s = store(row());
    await applySubscriptionSnapshot(trialSnap, { source: "webhook", eventTime: EVENT, now: NOW }, { store: s, log: () => {}, afterApplied: hook });
    // The same delivery again: nothing changes, nothing fans out.
    const replay = await applySubscriptionSnapshot(trialSnap, { source: "webhook", eventTime: EVENT, now: NOW }, { store: s, log: () => {}, afterApplied: hook });
    assert.deepEqual([replay.status, replay.changed], ["applied", false]);
    // An older event for the same subscription is stale.
    const stale = await applySubscriptionSnapshot(
      { ...trialSnap, status: "on_hold" },
      { source: "webhook", eventTime: new Date(EVENT.getTime() - 60_000), now: NOW },
      { store: s, log: () => {}, afterApplied: hook },
    );
    assert.equal(stale.status, "stale");
    // Every compare-and-set attempt loses.
    const lost = await applySubscriptionSnapshot(trialSnap, { source: "webhook", eventTime: EVENT, now: NOW }, {
      store: store(row(), [0, 0, 0]),
      log: () => {},
      afterApplied: hook,
    });
    assert.equal(lost.status, "error");
    assert.equal(changes.length, 1, "only the first write fanned out");
  });

  it("an injected store without a hook runs no fan-out (tests and scripts own their side effects)", async () => {
    const out = await applySubscriptionSnapshot(trialSnap, { source: "webhook", eventTime: EVENT, now: NOW }, { store: store(row()), log: () => {} });
    assert.equal(out.changed, true);
  });

  it("a throwing hook is logged and the write still reports applied", async () => {
    const logs: string[] = [];
    const out = await applySubscriptionSnapshot(trialSnap, { source: "webhook", eventTime: EVENT, now: NOW }, {
      store: store(row()),
      log: (_l, m) => void logs.push(m),
      afterApplied: () => {
        throw new Error("boom");
      },
    });
    assert.deepEqual([out.status, out.changed], ["applied", true]);
    assert.ok(logs.includes("[billing] post-apply hook failed"));
  });
});

describe("applySubscriptionSnapshot: a second paid subscription (FIX-1)", () => {
  it("regression: duplicate-paid-subscription: the row holds an entitled X, a paid Y arrives → duplicate, nothing written, no fan-out", async () => {
    const holder = row({
      subscriptionId: "sub_X",
      subscriptionStatus: "active",
      currentPeriodEnd: new Date("2026-12-01T00:00:00Z"),
      subscriptionSourceAt: new Date("2026-11-01T00:00:00Z"),
    });
    const s = store(holder);
    const changes: AppliedChange[] = [];
    const paidY: SubscriptionSnapshot = { ...trialSnap, subscription_id: "sub_Y", trial_period_days: 0 };
    const out = await applySubscriptionSnapshot(paidY, { source: "webhook", eventTime: EVENT, now: NOW }, { store: s, log: () => {}, afterApplied: (c) => void changes.push(c) });
    assert.equal(out.status, "duplicate");
    assert.equal(out.status === "duplicate" && out.kept, "sub_X");
    assert.equal(s.rows[0]!.subscriptionId, "sub_X", "X stays");
    assert.deepEqual(changes, []);
    // A lapsed X, or the same subscription, applies as before.
    const lapsed = store(row({ ...holder, subscriptionStatus: "expired", currentPeriodEnd: new Date("2026-10-01T00:00:00Z") }));
    assert.equal((await applySubscriptionSnapshot(paidY, { source: "webhook", eventTime: EVENT, now: NOW }, { store: lapsed, log: () => {} })).status, "applied");
  });
});

describe("applySubscriptionSnapshot: second trials and subscriptions that never started (FIX-2)", () => {
  // regression: dup-trial-selfheal (billing review round 2): trial snapshots skipped the duplicate check, so the
  // activation self-heal (and the refresh) of tab B's trial Y replaced the entitled trial X the row held, and nothing
  // cancelled X before its day-8 charge.
  it("the row holds an entitled trial X; trial Y from the self-heal (an API read) is a duplicate: nothing written, X stays", async () => {
    const holder = row({
      subscriptionId: "sub_X",
      subscriptionStatus: "active",
      currentPeriodEnd: new Date("2026-11-12T12:00:00Z"),
      subscriptionSourceAt: new Date("2026-11-05T11:59:00Z"),
      trialStartedAt: new Date("2026-11-05T11:58:00Z"),
      trialEndsAt: new Date("2026-11-12T11:58:00Z"),
    });
    for (const source of ["api", "webhook"] as const) {
      const s = store(holder);
      const changes: AppliedChange[] = [];
      const trialY: SubscriptionSnapshot = { ...trialSnap, subscription_id: "sub_Y", created_at: "2026-11-05T11:59:55Z" };
      const out = await applySubscriptionSnapshot(trialY, { source, userId: 7n, eventTime: source === "webhook" ? EVENT : null, now: NOW }, {
        store: s,
        log: () => {},
        afterApplied: (c) => void changes.push(c),
      });
      assert.equal(out.status, "duplicate", source);
      assert.equal(out.status === "duplicate" && out.kept, "sub_X");
      assert.equal(out.status === "duplicate" && out.entitlement.entitled, true, "the member is entitled through X");
      assert.equal(s.rows[0]!.subscriptionId, "sub_X", "X stays the member's subscription");
      assert.deepEqual(changes, [], "no fan-out");
    }
  });

  // regression: failed-trial (billing review round 2): a declined trial checkout (subscription.failed, status failed,
  // trial_period_days 7) wrote the trial dates and the failed subscriptionId, so the retry was charged at once.
  it("a failed or pending trial snapshot on a fresh row writes nothing: no trial dates, no subscriptionId; the retry still gets the trial", async () => {
    const { decideTrial } = await import("./trial-rules");
    for (const status of ["failed", "pending"]) {
      const s = store(row());
      const changes: AppliedChange[] = [];
      const out = await applySubscriptionSnapshot({ ...trialSnap, status }, { source: "webhook", eventTime: EVENT, now: NOW }, {
        store: s,
        log: () => {},
        afterApplied: (c) => void changes.push(c),
      });
      assert.notEqual(out.status, "applied", status);
      const r = s.rows[0]!;
      assert.deepEqual([r.trialStartedAt, r.trialEndsAt, r.subscriptionId, r.subscriptionStatus], [null, null, null, null], status);
      assert.deepEqual(changes, []);
      assert.deepEqual(await decideTrial(r, async () => ({ hit: false, kind: null })), { trial: true, ledger: "miss" }, `${status}: retry has the trial`);
    }
  });

  it("pending then active: the trial is recorded by the active snapshot, so the fan-out sees the first trial (ledger, trial_started)", async () => {
    const s = store(row());
    const changes: AppliedChange[] = [];
    const deps = { store: s, log: () => {}, afterApplied: (c: AppliedChange) => void changes.push(c) };
    await applySubscriptionSnapshot({ ...trialSnap, status: "pending" }, { source: "webhook", eventTime: new Date("2026-11-05T11:59:51Z"), now: NOW }, deps);
    assert.equal(s.rows[0]!.trialStartedAt, null);
    const out = await applySubscriptionSnapshot(trialSnap, { source: "webhook", eventTime: EVENT, now: NOW }, deps);
    assert.equal(out.status, "applied");
    assert.ok(s.rows[0]!.trialStartedAt);
    assert.equal(changes.length, 1);
    assert.equal(changes[0]!.before.trial.used, false);
    assert.equal(changes[0]!.after.trial.active, true, "firstTrial = after.trial.active && !before.trial.used");
  });

  it("the row's own subscription still follows its later events (a held subscription that fails is applied)", async () => {
    const held = row({ subscriptionId: "sub_1", subscriptionStatus: "on_hold", currentPeriodEnd: new Date("2026-10-01T00:00:00Z"), subscriptionSourceAt: new Date("2026-11-01T00:00:00Z") });
    const s = store(held);
    const out = await applySubscriptionSnapshot({ ...trialSnap, trial_period_days: 0, status: "failed" }, { source: "webhook", eventTime: EVENT, now: NOW }, { store: s, log: () => {} });
    assert.equal(out.status, "applied");
    assert.equal(s.rows[0]!.subscriptionStatus, "failed");
  });
});
