// Phase-04 plan 7.11: the stale-checkout task clears pendingCheckout* older than 24 h for users who are not entitled.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Prisma } from "@repo/db";
import { clearStaleCheckouts, clearStaleCheckoutsSql, STALE_CHECKOUT_AFTER_MS } from "@/lib/billing/housekeeping";
import { CRON_TASKS } from "./index";
import { createStaleCheckout } from "./stale-checkout";

const NOW = new Date("2026-11-12T03:00:00.000Z");
const ctx = { now: NOW, clock: () => NOW.getTime(), sleep: async () => undefined, after: () => undefined, deadlineMs: NOW.getTime() + 1 };
const textOf = (sql: Prisma.Sql) => sql.strings.join("?").replace(/\s+/g, " ");

describe("stale-checkout", () => {
  it("one UPDATE: pendingCheckout* → NULL when older than 24 h and not entitled", async () => {
    const seen: Prisma.Sql[] = [];
    const task = createStaleCheckout(async (sql) => {
      seen.push(sql);
      return 4;
    });
    assert.equal(task.name, "stale-checkout");
    assert.deepEqual(await task.run(ctx), { count: 4 });
    const text = textOf(seen[0]!);
    assert.match(text, /UPDATE users SET "pendingCheckoutSessionId" = NULL, "pendingCheckoutPlan" = NULL, "pendingCheckoutAt" = NULL/);
    assert.match(text, /"pendingCheckoutAt" < \?::timestamp\(3\)/);
    assert.match(text, /AND NOT \(/);
    assert.match(text, /= 'active'/);
    assert.deepEqual(seen[0]!.values, [new Date(NOW.getTime() - STALE_CHECKOUT_AFTER_MS).toISOString(), NOW.toISOString(), NOW.toISOString()]);
  });

  it("clearStaleCheckouts runs the statement through the given client", async () => {
    let ran: Prisma.Sql | null = null;
    const n = await clearStaleCheckouts({ $executeRaw: async (sql) => ((ran = sql), 2) }, NOW);
    assert.equal(n, 2);
    assert.equal(textOf(ran!), textOf(clearStaleCheckoutsSql(NOW)));
  });

  it("refuses an invalid clock", () => {
    assert.throws(() => clearStaleCheckoutsSql(new Date(Number.NaN)));
  });

  it("is registered in the daily cron after the P1–P3 tasks", () => {
    const names = CRON_TASKS.map((t) => t.name);
    assert.ok(names.includes("stale-checkout"));
    assert.ok(names.indexOf("stale-checkout") > names.indexOf("worker-alive"));
  });
});
