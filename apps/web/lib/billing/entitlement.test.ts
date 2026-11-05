import assert from "node:assert/strict";
import * as nodeModule from "node:module";
import { describe, it } from "node:test";

// entitlement.ts starts with `import "server-only"`, which only Next.js resolves. Stub it first.
const STUB = "data:text/javascript,export%20%7B%7D";
if (typeof nodeModule.registerHooks === "function") {
  nodeModule.registerHooks({
    resolve: (specifier, context, next) =>
      specifier === "server-only" ? { url: STUB, shortCircuit: true } : next(specifier, context),
  });
} else {
  nodeModule.register(
    "data:text/javascript," +
      encodeURIComponent(
        `export async function resolve(s, c, n) { return s === "server-only" ? { url: ${JSON.stringify(STUB)}, shortCircuit: true } : n(s, c); }`,
      ),
  );
}

const { applySubscriptionSnapshot, changesAnything, pickSnapshotUser, CAS_ATTEMPTS } = await import("./entitlement");
type Mod = typeof import("./entitlement");
type SnapshotStore = import("./entitlement").SnapshotStore;
type SnapshotUser = import("./entitlement").SnapshotUser;
type SnapshotWrite = import("./entitlement").SnapshotWrite;
type SubscriptionSnapshot = import("./entitlement-rules").SubscriptionSnapshot;

const T0 = new Date("2026-09-01T00:00:00Z");
const T1 = new Date("2026-09-02T00:00:00Z");
const T2 = new Date("2026-09-03T00:00:00Z");
const T3 = new Date("2026-09-04T00:00:00Z");
const NOW = new Date("2026-09-10T12:00:00Z");
const PERIOD_END = new Date("2026-10-10T12:00:00Z");

function userRow(overrides: Partial<SnapshotUser> = {}): SnapshotUser {
  return {
    id: 1n,
    referenceId: "ref_1",
    email: "a@example.test",
    dodoCustomerId: "cus_1",
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
    ...overrides,
  };
}

function snap(overrides: Partial<SubscriptionSnapshot> = {}): SubscriptionSnapshot {
  return {
    subscription_id: "sub_1",
    product_id: "pdt_m",
    status: "active",
    next_billing_date: PERIOD_END.toISOString(),
    cancel_at_next_billing_date: false,
    created_at: T0.toISOString(),
    payment_frequency_interval: "Month",
    customer: { customer_id: "cus_1", email: "a@example.test" },
    ...overrides,
  };
}

const tick = () => new Promise<void>((resolve) => setImmediate(resolve));

/**
 * In-memory users table with the compare-and-set semantics of Prisma's updateMany
 * (`WHERE id = $1 AND "subscriptionSourceAt" IS NOT DISTINCT FROM $2`). `beforeWrite` runs
 * between a caller's read and its write, to simulate another writer winning the race.
 */
class FakeStore implements SnapshotStore {
  rows: SnapshotUser[];
  reads = 0;
  writes: Array<SnapshotWrite & { subscriptionUpdatedAt: Date }> = [];
  attemptedWrites = 0;
  beforeWrite?: (attempt: number) => void | Promise<void>;
  constructor(rows: SnapshotUser[]) {
    this.rows = rows;
  }
  get row(): SnapshotUser {
    return this.rows[0]!;
  }
  async findCandidates(keys: { userId?: bigint; customerId?: string; email?: string }) {
    this.reads++;
    await tick();
    return this.rows
      .filter(
        (r) =>
          (keys.userId !== undefined && r.id === keys.userId) ||
          (keys.customerId && r.dodoCustomerId === keys.customerId) ||
          (keys.email && r.email === keys.email),
      )
      .map((r) => ({ ...r }));
  }
  async compareAndSet(id: bigint, expected: Date | null, data: SnapshotWrite & { subscriptionUpdatedAt: Date }) {
    this.attemptedWrites++;
    await this.beforeWrite?.(this.attemptedWrites);
    await tick();
    const row = this.rows.find((r) => r.id === id);
    if (!row) return 0;
    const same =
      (row.subscriptionSourceAt === null && expected === null) ||
      (row.subscriptionSourceAt !== null && expected !== null && row.subscriptionSourceAt.getTime() === expected.getTime());
    if (!same) return 0;
    Object.assign(row, data);
    this.writes.push(data);
    return 1;
  }
}

const apply = (store: FakeStore, s: SubscriptionSnapshot, opts: Partial<Parameters<Mod["applySubscriptionSnapshot"]>[1]> = {}) =>
  applySubscriptionSnapshot(s, { source: "webhook", now: NOW, ...opts }, { store, log: () => {} });

describe("applySubscriptionSnapshot: compare-and-set (plan §8.11)", () => {
  it("applies a first snapshot, stamps the provider time and the write time", async () => {
    const store = new FakeStore([userRow()]);
    const out = await apply(store, snap(), { eventTime: T1 });
    assert.equal(out.status, "applied");
    assert.equal(out.changed, true);
    assert.equal(out.status === "applied" && out.userId, 1n);
    assert.equal(out.status === "applied" && out.userRef, "ref_1");
    assert.equal(out.status === "applied" && out.entitlement.entitled, true);
    assert.equal(store.row.subscriptionStatus, "active");
    assert.equal(store.row.subscriptionSourceAt?.getTime(), T1.getTime());
    assert.equal(store.row.subscriptionUpdatedAt?.getTime(), NOW.getTime());
  });

  it("a webhook older than an applied refresh does not overwrite it", async () => {
    const store = new FakeStore([userRow()]);
    // The refresh carried a provider time (T2).
    const refresh = await apply(store, snap({ status: "active" }), { source: "api", eventTime: T2, userId: 1n });
    assert.equal(refresh.status, "applied");
    const late = await apply(store, snap({ status: "on_hold" }), { eventTime: T1 });
    assert.equal(late.status, "stale");
    assert.equal(late.changed, false);
    assert.equal(store.row.subscriptionStatus, "active");
    assert.equal(store.writes.length, 1);
  });

  it("a refresh older than an applied webhook does not overwrite it", async () => {
    const store = new FakeStore([userRow()]);
    await apply(store, snap({ status: "cancelled", cancel_at_next_billing_date: true }), { eventTime: T2 });
    const refresh = await apply(store, snap({ status: "active" }), { source: "api", eventTime: T1, userId: 1n });
    assert.equal(refresh.status, "stale");
    assert.equal(store.row.subscriptionStatus, "cancelled");
    assert.equal(store.writes.length, 1);
  });

  it("an untimed refresh that loses the race to a webhook yields instead of overwriting it", async () => {
    const store = new FakeStore([userRow({ subscriptionId: "sub_1", subscriptionStatus: "active", subscriptionSourceAt: T1 })]);
    store.beforeWrite = (n) => {
      if (n === 1) Object.assign(store.row, { subscriptionStatus: "on_hold", subscriptionSourceAt: T2 });
    };
    const refresh = await apply(store, snap({ status: "active", cancel_at_next_billing_date: true }), {
      source: "api",
      userId: 1n,
    });
    assert.equal(refresh.status, "stale");
    assert.equal(store.row.subscriptionStatus, "on_hold");
    assert.equal(store.writes.length, 0);
  });

  it("an untimed refresh never advances subscriptionSourceAt, so a later webhook still applies", async () => {
    const store = new FakeStore([userRow({ subscriptionId: "sub_1", subscriptionStatus: "active", subscriptionSourceAt: T1 })]);
    const refresh = await apply(store, snap({ cancel_at_next_billing_date: true }), { source: "api", userId: 1n });
    assert.equal(refresh.status, "applied");
    assert.equal(store.row.subscriptionSourceAt?.getTime(), T1.getTime());
    const hook = await apply(store, snap({ status: "on_hold" }), { eventTime: T2 });
    assert.equal(hook.status, "applied");
    assert.equal(store.row.subscriptionStatus, "on_hold");
  });

  for (const order of ["newer first", "older first"] as const) {
    it(`two concurrent webhooks end with the newer one stored (${order})`, async () => {
      const store = new FakeStore([userRow()]);
      const newer = snap({ status: "on_hold" });
      const older = snap({ status: "active" });
      const [a, b] =
        order === "newer first"
          ? await Promise.all([apply(store, newer, { eventTime: T3 }), apply(store, older, { eventTime: T2 })])
          : await Promise.all([apply(store, older, { eventTime: T2 }), apply(store, newer, { eventTime: T3 })]);
      assert.equal(store.row.subscriptionStatus, "on_hold");
      assert.equal(store.row.subscriptionSourceAt?.getTime(), T3.getTime());
      // Both read the same row before either wrote, so the second writer lost its first compare-and-set.
      assert.ok(store.reads >= 3, `the loser re-read (reads=${store.reads})`);
      const statuses = [a.status, b.status].sort();
      assert.deepEqual(statuses, order === "newer first" ? ["applied", "stale"] : ["applied", "applied"]);
    });
  }

  it("a no-op snapshot issues no UPDATE", async () => {
    const store = new FakeStore([userRow()]);
    await apply(store, snap(), { eventTime: T1 });
    const again = await apply(store, snap(), { eventTime: T1 });
    assert.equal(again.status, "applied");
    assert.equal(again.changed, false);
    assert.equal(store.attemptedWrites, 1);
  });

  it("an untimed no-op refresh issues no UPDATE either", async () => {
    const store = new FakeStore([userRow()]);
    await apply(store, snap(), { eventTime: T1 });
    const refresh = await apply(store, snap(), { source: "api", userId: 1n });
    assert.equal(refresh.changed, false);
    assert.equal(store.attemptedWrites, 1);
  });

  it(`three lost races → cas_exhausted (${CAS_ATTEMPTS} reads, no write)`, async () => {
    const store = new FakeStore([userRow()]);
    let bump = T0.getTime();
    store.beforeWrite = () => {
      // Another writer always lands first with an older-than-ours but different provider time.
      bump -= 1000;
      store.row.subscriptionSourceAt = new Date(bump);
    };
    const out = await apply(store, snap(), { eventTime: T3 });
    assert.equal(out.status, "error");
    assert.equal(out.status === "error" && out.error, "cas_exhausted");
    assert.equal(out.status === "error" && out.userId, 1n);
    assert.equal(store.reads, CAS_ATTEMPTS);
    assert.equal(store.writes.length, 0);
  });

  it("unmatched when no user has the id, customer id or email", async () => {
    const store = new FakeStore([userRow({ email: "other@example.test", dodoCustomerId: "cus_other" })]);
    const out = await apply(store, snap());
    assert.deepEqual(out, { status: "unmatched", changed: false });
  });

  it("records the first trial once and backfills a missing customer link", async () => {
    const store = new FakeStore([userRow({ dodoCustomerId: null })]);
    await apply(store, snap({ trial_period_days: 7, created_at: T1.toISOString() }), { eventTime: T1 });
    assert.equal(store.row.dodoCustomerId, "cus_1");
    assert.equal(store.row.trialStartedAt?.getTime(), T1.getTime());
    const firstEnd = store.row.trialEndsAt?.getTime();
    await apply(store, snap({ trial_period_days: 7, created_at: T2.toISOString() }), { eventTime: T2 });
    assert.equal(store.row.trialEndsAt?.getTime(), firstEnd, "the trial never moves");
  });

  it("a different subscription that grants access replaces an expired one", async () => {
    const store = new FakeStore([
      userRow({ subscriptionId: "sub_old", subscriptionStatus: "expired", currentPeriodEnd: T0, subscriptionSourceAt: T3 }),
    ]);
    const out = await apply(store, snap({ subscription_id: "sub_new", created_at: T2.toISOString() }), { eventTime: T2 });
    assert.equal(out.status, "applied");
    assert.equal(store.row.subscriptionId, "sub_new");
    // The ordering key never moves backwards.
    assert.equal(store.row.subscriptionSourceAt?.getTime(), T3.getTime());
  });
});

describe("pickSnapshotUser: Phase 0 lookup order", () => {
  const byId = userRow({ id: 1n, dodoCustomerId: "cus_x", email: "x@example.test" });
  const byCustomer = userRow({ id: 2n, dodoCustomerId: "cus_1", email: "y@example.test" });
  const byEmail = userRow({ id: 3n, dodoCustomerId: null, email: "a@example.test" });
  const keys = { userId: 1n, customerId: "cus_1", email: "a@example.test" };
  it("prefers the known id, then the customer id, then the email", () => {
    assert.equal(pickSnapshotUser([byEmail, byCustomer, byId], keys)?.id, 1n);
    assert.equal(pickSnapshotUser([byEmail, byCustomer], keys)?.id, 2n);
    assert.equal(pickSnapshotUser([byEmail], keys)?.id, 3n);
    assert.equal(pickSnapshotUser([], keys), null);
  });
});

describe("changesAnything", () => {
  it("compares dates by time and treats undefined as no change", () => {
    const row = { a: new Date(1000), b: null, c: "x" };
    assert.equal(changesAnything(row, { a: new Date(1000), c: "x" }), false);
    assert.equal(changesAnything(row, { a: new Date(2000) }), true);
    assert.equal(changesAnything(row, { b: undefined }), false);
    assert.equal(changesAnything(row, { b: "y" }), true);
  });
});
