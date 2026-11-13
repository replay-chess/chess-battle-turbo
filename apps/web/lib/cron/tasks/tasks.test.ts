import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { SubscriptionSnapshot } from "@/lib/billing/entitlement-rules";
import { CRON_TASKS, cronAuthorized, runCronTasks, type CronContext, type CronTask } from "./index";
import {
  RECONCILE_CANDIDATES_SQL,
  RECONCILE_LIMIT,
  RECONCILE_SPACING_MS,
  createMembershipReconcile,
  outcomeOf,
  type ReconcileCandidate,
  type ReconcileOutcome,
} from "./membership-reconcile";
import { RATE_LIMIT_SWEEP_SQL, createRateLimitSweep } from "./rate-limit-sweep";
import { WEBHOOK_RETENTION_SQL, createWebhookRetention } from "./webhook-retention";

/** A fake clock: `sleep` advances time instead of waiting. */
function fakeCtx(start = Date.parse("2026-11-03T04:00:00Z"), budgetMs = 45_000) {
  let t = start;
  const afterFns: (() => unknown)[] = [];
  const sleeps: number[] = [];
  const ctx: CronContext = {
    now: new Date(start),
    clock: () => t,
    sleep: async (ms) => {
      sleeps.push(ms);
      t += ms;
    },
    after: (fn) => afterFns.push(fn),
    deadlineMs: start + budgetMs,
  };
  return {
    ctx,
    afterFns,
    sleeps,
    advance: (ms: number) => {
      t += ms;
    },
    time: () => t,
  };
}

describe("runCronTasks", () => {
  it("task order (P1, then P2, then P3's worker backstop, then P4's stale checkouts and import prune)", () => {
    assert.deepEqual(
      CRON_TASKS.map((t) => t.name),
      [
        "rate-limit-sweep",
        "webhook-retention",
        "membership-reconcile",
        "stale-bot-games",
        "idempotency-prune",
        "worker-alive",
        "stale-checkout",
        "import-prune",
        "trial-ledger-sweep",
      ],
    );
  });

  it("runs tasks in order and reports per-task counts", async () => {
    const { ctx, advance } = fakeCtx();
    const order: string[] = [];
    const task = (name: string, count: number, ms: number): CronTask => ({
      name,
      async run() {
        order.push(name);
        advance(ms);
        return { count };
      },
    });
    const report = await runCronTasks([task("a", 1, 5), task("b", 2, 7)], ctx, () => {});
    assert.deepEqual(order, ["a", "b"]);
    assert.deepEqual(report, {
      tasks: { a: { ok: true, ms: 5, count: 1 }, b: { ok: true, ms: 7, count: 2 } },
      durationMs: 12,
    });
  });

  it("a failing task does not stop the next one", async () => {
    const { ctx } = fakeCtx();
    const failures: string[] = [];
    const ran: string[] = [];
    const report = await runCronTasks(
      [
        {
          name: "boom",
          async run() {
            ran.push("boom");
            throw new Error("db down");
          },
        },
        {
          name: "after-boom",
          async run() {
            ran.push("after-boom");
            return { count: 3, detail: { x: 3 } };
          },
        },
      ],
      ctx,
      (name) => {
        failures.push(name);
      },
    );
    assert.deepEqual(ran, ["boom", "after-boom"]);
    assert.deepEqual(failures, ["boom"]);
    assert.deepEqual(report.tasks.boom, { ok: false, ms: 0 });
    assert.deepEqual(report.tasks["after-boom"], { ok: true, ms: 0, count: 3, detail: { x: 3 } });
  });
});

describe("cronAuthorized", () => {
  const SECRET = "s3cr3t-value-of-32-bytes-or-more";
  it("accepts only the exact bearer", () => {
    assert.equal(cronAuthorized(`Bearer ${SECRET}`, SECRET), true);
    assert.equal(cronAuthorized(`Bearer ${SECRET}x`, SECRET), false);
    assert.equal(cronAuthorized(`bearer ${SECRET}`, SECRET), false);
    assert.equal(cronAuthorized(SECRET, SECRET), false);
    assert.equal(cronAuthorized("Bearer short", SECRET), false);
    assert.equal(cronAuthorized(null, SECRET), false);
  });
  it("fails closed without a secret", () => {
    assert.equal(cronAuthorized("Bearer ", ""), false);
    assert.equal(cronAuthorized("Bearer undefined", undefined), false);
    assert.equal(cronAuthorized("Bearer x", null), false);
  });
});

describe("sweeps", () => {
  it("rate-limit-sweep deletes expired rows from both stores", async () => {
    const seen: string[] = [];
    const task = createRateLimitSweep(async (sql) => {
      seen.push(sql);
      return sql.includes("rate_limit_buckets") ? 4 : 2;
    });
    const { ctx } = fakeCtx();
    assert.deepEqual(await task.run(ctx), { count: 6, detail: { buckets: 4, windows: 2 } });
    assert.deepEqual(seen, [RATE_LIMIT_SWEEP_SQL.buckets, RATE_LIMIT_SWEEP_SQL.windows]);
    for (const sql of seen) {
      assert.match(sql, /"resetAt" < \(now\(\) AT TIME ZONE 'UTC'\) - interval '1 hour'/);
    }
  });

  it("webhook-retention keeps Dodo 180 days and Clerk 30 days", async () => {
    let seen = "";
    const task = createWebhookRetention(async (sql) => {
      seen = sql;
      return 9;
    });
    const { ctx } = fakeCtx();
    assert.deepEqual(await task.run(ctx), { count: 9 });
    assert.equal(seen, WEBHOOK_RETENTION_SQL);
    assert.match(seen, /"provider" = 'dodo' AND "receivedAt" < \(now\(\) AT TIME ZONE 'UTC'\) - interval '180 days'/);
    assert.match(seen, /"provider" = 'clerk' AND "receivedAt" < \(now\(\) AT TIME ZONE 'UTC'\) - interval '30 days'/);
  });
});

describe("membership-reconcile", () => {
  const snapshot = (id: string): SubscriptionSnapshot => ({
    subscription_id: id,
    product_id: "pdt_m",
    status: "active",
    next_billing_date: "2026-12-03T00:00:00Z",
    cancel_at_next_billing_date: false,
    customer: { customer_id: "cus_1", email: "a@example.com" },
  });
  const candidates = (n: number): ReconcileCandidate[] =>
    Array.from({ length: n }, (_, i) => ({ id: BigInt(i + 1), subscriptionId: `sub_${i + 1}` }));

  it("candidate query targets non-terminal rows an hour past period end, oldest first, limited", () => {
    assert.match(RECONCILE_CANDIDATES_SQL, /"subscriptionStatus" IN \('active', 'on_hold', 'past_due', 'pending'\)/);
    assert.match(RECONCILE_CANDIDATES_SQL, /"currentPeriodEnd" < \(now\(\) AT TIME ZONE 'UTC'\) - interval '1 hour'/);
    assert.match(RECONCILE_CANDIDATES_SQL, /"dodoCustomerId" IS NOT NULL/);
    assert.match(RECONCILE_CANDIDATES_SQL, /ORDER BY "currentPeriodEnd"\s+LIMIT \$1$/);
  });

  it("picks at most 50 rows and spaces Dodo calls 200 ms apart (fake clock)", async () => {
    const f = fakeCtx();
    let askedLimit = 0;
    const callTimes: number[] = [];
    const task = createMembershipReconcile({
      enabled: () => true,
      listCandidates: async (limit) => {
        askedLimit = limit;
        return candidates(80); // a misbehaving source returning too many rows
      },
      retrieve: async (id) => {
        callTimes.push(f.time());
        return snapshot(id);
      },
      apply: async () => "unchanged",
      onError: () => {},
    });
    const result = await task.run(f.ctx);
    assert.equal(askedLimit, RECONCILE_LIMIT);
    assert.equal(callTimes.length, 50);
    assert.equal(result.count, 50);
    for (let i = 1; i < callTimes.length; i++) {
      assert.ok(callTimes[i]! - callTimes[i - 1]! >= RECONCILE_SPACING_MS, `gap ${i}`);
    }
    assert.equal(f.sleeps.length, 49, "no sleep before the first call");
  });

  it("tallies outcomes and syncs claims in after() only for rows that changed", async () => {
    const f = fakeCtx();
    const outcomes: ReconcileOutcome[] = ["changed", "unchanged", "stale", "unmatched", "changed"];
    const synced: bigint[] = [];
    const task = createMembershipReconcile({
      enabled: () => true,
      listCandidates: async () => candidates(5),
      retrieve: async (id) => snapshot(id),
      apply: async (_s, userId) => outcomes[Number(userId) - 1]!,
      syncClaims: async (userId) => {
        synced.push(userId);
      },
      onError: () => {},
    });
    const result = await task.run(f.ctx);
    assert.deepEqual(result.detail, {
      checked: 5,
      changed: 2,
      unchanged: 1,
      stale: 1,
      unmatched: 1,
      errors: 0,
      skipped: 0,
    });
    assert.deepEqual(synced, [], "claims sync waits for after()");
    for (const fn of f.afterFns) await fn();
    assert.deepEqual(synced, [1n, 5n]);
  });

  it("a Dodo failure is counted and the next user still runs; 3 in a row stop the task", async () => {
    const f = fakeCtx();
    const errors: bigint[] = [];
    const task = createMembershipReconcile({
      enabled: () => true,
      listCandidates: async () => candidates(8),
      retrieve: async (id) => {
        if (id === "sub_1" || Number(id.slice(4)) >= 3) throw new Error("dodo 503");
        return snapshot(id);
      },
      apply: async () => "changed",
      onError: (userId) => errors.push(userId),
    });
    const result = await task.run(f.ctx);
    // 1 fails, 2 ok (resets the streak), 3, 4, 5 fail → stop; 6..8 skipped
    assert.deepEqual(errors, [1n, 3n, 4n, 5n]);
    assert.equal(result.detail?.errors, 4);
    assert.equal(result.detail?.changed, 1);
    assert.equal(result.detail?.skipped, 3);
  });

  it("stops taking new users at the deadline", async () => {
    const f = fakeCtx(Date.parse("2026-11-03T04:00:00Z"), 1_000);
    const task = createMembershipReconcile({
      enabled: () => true,
      listCandidates: async () => candidates(50),
      retrieve: async (id) => snapshot(id),
      apply: async () => "unchanged",
      onError: () => {},
    });
    const result = await task.run(f.ctx);
    // calls at t = 0, 200, 400, 600, 800; the 6th would start at 1000 = deadline
    assert.equal(result.detail?.checked, 5);
    assert.equal(result.detail?.skipped, 45);
  });

  it("does nothing when disabled (no Dodo key)", async () => {
    const f = fakeCtx();
    let listed = false;
    const task = createMembershipReconcile({
      enabled: () => false,
      listCandidates: async () => {
        listed = true;
        return [];
      },
    });
    assert.deepEqual(await task.run(f.ctx), { count: 0, detail: { disabled: 1 } });
    assert.equal(listed, false);
  });

  it("outcomeOf understands the Phase 0 and the compare-and-set return shapes", () => {
    assert.equal(outcomeOf(null), "unmatched");
    assert.equal(outcomeOf({ hasAccess: true }), "changed");
    assert.equal(outcomeOf({ status: "applied", changed: true, userId: 1n }), "changed");
    assert.equal(outcomeOf({ status: "applied", changed: false, userId: 1n }), "unchanged");
    assert.equal(outcomeOf({ status: "stale", userId: 1n }), "stale");
    assert.equal(outcomeOf({ status: "unmatched" }), "unmatched");
    assert.equal(outcomeOf({ status: "error", error: "cas_exhausted" }), "error");
  });
});
