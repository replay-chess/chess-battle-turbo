/**
 * Runs the limiter statement against a real Postgres (Docker, after `prisma migrate deploy`).
 * Skipped unless TEST_DATABASE_URL is set. Never point it at Neon.
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { PrismaClient } from "@repo/db";
import {
  RATE_LIMIT_SQL,
  checkRateLimit,
  type RateLimitQuery,
  type RateLimitStore,
  type WindowRow,
} from "./rate-limit-db";

const url = process.env.TEST_DATABASE_URL;

describe("rate-limit-db (Postgres)", { skip: url ? false : "TEST_DATABASE_URL not set" }, () => {
  let db: PrismaClient;
  const query: RateLimitQuery = (sql, key, windowSec) => db.$queryRawUnsafe<WindowRow[]>(sql, key, windowSec);
  const run = Date.now().toString(36);

  before(async () => {
    db = new PrismaClient({ datasourceUrl: url });
    await db.$connect();
  });

  after(async () => {
    await db.$executeRawUnsafe(`DELETE FROM "rate_limit_buckets" WHERE "key" LIKE $1`, `rl:int-%:${run}%`);
    await db.$executeRawUnsafe(`DELETE FROM "rate_limit_windows" WHERE "key" LIKE $1`, `rl:int-%:${run}%`);
    await db.$disconnect();
  });

  it("the burst table is UNLOGGED and the durable one is logged", async () => {
    const rows = await db.$queryRawUnsafe<{ relname: string; relpersistence: string }[]>(
      `SELECT relname, relpersistence::text AS relpersistence FROM pg_class
       WHERE relname IN ('rate_limit_buckets','rate_limit_windows') ORDER BY relname`,
    );
    assert.deepEqual(
      rows.map((r) => [r.relname, r.relpersistence]),
      [
        ["rate_limit_buckets", "u"],
        ["rate_limit_windows", "p"],
      ],
    );
  });

  for (const store of ["burst", "durable"] as const satisfies readonly RateLimitStore[]) {
    it(`${store}: 50 concurrent upserts on one key count 1..50 with no duplicates`, async () => {
      const key = `rl:int-${store}:${run}:concurrent`;
      const rows = await Promise.all(Array.from({ length: 50 }, () => query(RATE_LIMIT_SQL[store], key, 60)));
      const counts = rows.map((r) => Number(r[0]!.count)).sort((a, b) => a - b);
      assert.deepEqual(counts, Array.from({ length: 50 }, (_, i) => i + 1));
      const resets = new Set(rows.map((r) => new Date(r[0]!.resetAt).getTime()));
      assert.equal(resets.size, 1, "every hit in one window shares its resetAt");
    });

    it(`${store}: the window rolls over after resetAt`, async () => {
      const key = `rl:int-${store}:${run}:rollover`;
      const table = store === "burst" ? "rate_limit_buckets" : "rate_limit_windows";
      await query(RATE_LIMIT_SQL[store], key, 60);
      const second = await query(RATE_LIMIT_SQL[store], key, 60);
      assert.equal(Number(second[0]!.count), 2);
      // expire the window in place
      await db.$executeRawUnsafe(
        `UPDATE "${table}" SET "resetAt" = (now() AT TIME ZONE 'UTC') - interval '1 second' WHERE "key" = $1`,
        key,
      );
      const third = await query(RATE_LIMIT_SQL[store], key, 60);
      assert.equal(Number(third[0]!.count), 1);
      const resetMs = new Date(third[0]!.resetAt).getTime();
      const drift = Math.abs(resetMs - (Date.now() + 60_000));
      assert.ok(drift < 30_000, `resetAt should be ~60 s ahead in UTC (drift ${drift} ms)`);
    });
  }

  it("checkRateLimit denies the hit after the limit on a real table", async () => {
    const spec = { bucket: "int-check", limit: 3, windowSec: 60, by: "user" as const };
    const subject = { clerkUserId: `${run}-user` };
    const deps = { query, pepper: "p" };
    const results = [];
    for (let i = 0; i < 4; i++) results.push(await checkRateLimit(spec, subject, deps));
    assert.deepEqual(
      results.map((r) => r.allowed),
      [true, true, true, false],
    );
    // resetAt comes from the database clock and retryAfter from this process's clock; a few ms of skew between
    // them (a Docker VM, or Neon vs Vercel) rounds a 60 s window up to 61 s.
    assert.ok(results[3]!.retryAfterSec >= 1 && results[3]!.retryAfterSec <= 61, `retryAfterSec ${results[3]!.retryAfterSec}`);
    await db.$executeRawUnsafe(`DELETE FROM "rate_limit_buckets" WHERE "key" = $1`, `rl:int-check:c:${run}-user`);
  });
});
