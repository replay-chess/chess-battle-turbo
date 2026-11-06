/**
 * The billing compare-and-set against a real Postgres (Docker, all migrations applied; plan §8.11).
 * Skipped unless TEST_DATABASE_URL is set: Docker in CI; locally a throwaway container or the Neon dev branch
 * (it creates and deletes one throwaway user). Never production.
 */
import assert from "node:assert/strict";
import * as nodeModule from "node:module";
import { after, before, describe, it } from "node:test";
import { PrismaClient } from "@repo/db";

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

const url = process.env.TEST_DATABASE_URL;

describe("applySubscriptionSnapshot compare-and-set (Postgres)", { skip: url ? false : "TEST_DATABASE_URL not set" }, () => {
  let db: PrismaClient;
  let mod: typeof import("./entitlement");
  const run = Date.now().toString(36);
  const email = `cas-int-${run}@example.test`;
  const customerId = `cus_int_${run}`;
  let userId: bigint;

  before(async () => {
    db = new PrismaClient({ datasourceUrl: url });
    mod = await import("./entitlement");
    const user = await db.user.create({
      data: { googleId: `user_int_${run}`, email, name: "CAS Int", code: run.slice(-6).toUpperCase().padStart(6, "X") },
      select: { id: true },
    });
    userId = user.id;
  });

  after(async () => {
    await db.user.deleteMany({ where: { email } });
    await db.$disconnect();
  });

  const snapshot = (status: string, n: number) => ({
    subscription_id: `sub_int_${run}`,
    product_id: "pdt_int",
    status,
    next_billing_date: new Date(Date.UTC(2027, 0, 1 + n)).toISOString(),
    cancel_at_next_billing_date: false,
    created_at: "2026-11-01T00:00:00Z",
    payment_frequency_interval: "Month",
    customer: { customer_id: customerId, email },
  });

  it("10 concurrent applies with shuffled event times: the row holds the newest", async () => {
    const store = mod.createPrismaSnapshotStore(db);
    const base = Date.UTC(2026, 10, 5, 10, 0, 0);
    const order = Array.from({ length: 10 }, (_, i) => i);
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [order[i], order[j]] = [order[j]!, order[i]!];
    }
    const applyN = (n: number) =>
      mod.applySubscriptionSnapshot(
        snapshot(n === 9 ? "on_hold" : "active", n),
        { source: "webhook", eventTime: new Date(base + n * 1000) },
        { store, log: () => {} },
      );
    const results = await Promise.all(order.map(applyN));
    // An apply that exhausted its 3 attempts answers 500 and the provider redelivers: replay those.
    const retried = order.filter((_, i) => results[i]!.status === "error");
    for (const n of retried) assert.notEqual((await applyN(n)).status, "error");
    const row = await db.user.findUniqueOrThrow({
      where: { id: userId },
      select: { subscriptionStatus: true, subscriptionSourceAt: true, currentPeriodEnd: true, dodoCustomerId: true },
    });
    assert.equal(row.subscriptionSourceAt?.getTime(), base + 9000, "the newest provider time is stored");
    assert.equal(row.subscriptionStatus, "on_hold");
    assert.equal(row.currentPeriodEnd?.toISOString(), new Date(Date.UTC(2027, 0, 10)).toISOString());
    assert.equal(row.dodoCustomerId, customerId);
    assert.ok(results.every((r) => r.status !== "unmatched"));
  });

  it("an older event afterwards is stale and changes nothing; a replay of the newest writes nothing", async () => {
    const store = mod.createPrismaSnapshotStore(db);
    const prior = await db.user.findUniqueOrThrow({ where: { id: userId } });
    const stale = await mod.applySubscriptionSnapshot(
      snapshot("expired", 0),
      { source: "webhook", eventTime: new Date(Date.UTC(2026, 10, 5, 9, 0, 0)) },
      { store, log: () => {} },
    );
    assert.equal(stale.status, "stale");
    const replay = await mod.applySubscriptionSnapshot(
      snapshot("on_hold", 9),
      { source: "webhook", eventTime: prior.subscriptionSourceAt },
      { store, log: () => {} },
    );
    assert.deepEqual([replay.status, replay.changed], ["applied", false]);
    const afterRow = await db.user.findUniqueOrThrow({ where: { id: userId } });
    assert.equal(afterRow.subscriptionUpdatedAt?.getTime(), prior.subscriptionUpdatedAt?.getTime(), "no write");
    assert.equal(afterRow.subscriptionStatus, prior.subscriptionStatus);
  });

  it("the compare-and-set is null-safe (IS NOT DISTINCT FROM)", async () => {
    const store = mod.createPrismaSnapshotStore(db);
    await db.user.update({ where: { id: userId }, data: { subscriptionSourceAt: null } });
    assert.equal(await store.compareAndSet(userId, new Date(0), { ...snapshotFields(), subscriptionUpdatedAt: new Date() }), 0);
    assert.equal(await store.compareAndSet(userId, null, { ...snapshotFields(), subscriptionUpdatedAt: new Date() }), 1);
  });

  const snapshotFields = () => ({
    plan: "player",
    planInterval: "month",
    subscriptionId: `sub_int_${run}`,
    subscriptionStatus: "active",
    subscriptionProductId: "pdt_int",
    currentPeriodEnd: new Date(Date.UTC(2027, 1, 1)),
    cancelAtPeriodEnd: false,
  });
});
