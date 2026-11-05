import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  BURST_MAX_WINDOW_SEC,
  RATE_LIMITS,
  RATE_LIMIT_SQL,
  RateLimitSpecError,
  checkRateLimit,
  clientIpFrom,
  decideWindow,
  defineRateLimit,
  hashIp,
  keysFor,
  resolveIpPepper,
  retryAfterSeconds,
  storeFor,
  tableFor,
  type RateLimitQuery,
  type RateLimitSpec,
  type WindowRow,
} from "./rate-limit-db";

const NOW = new Date("2026-11-03T12:00:00.000Z");
const at = (ms: number) => new Date(NOW.getTime() + ms);

describe("decideWindow", () => {
  it("first hit opens a window", () => {
    const d = decideWindow(null, NOW, 3, 60);
    assert.equal(d.count, 1);
    assert.equal(d.resetAt.getTime(), at(60_000).getTime());
    assert.equal(d.allowed, true);
    assert.equal(d.retryAfterSec, 0);
  });

  it("a hit within the window increments and keeps resetAt", () => {
    const d = decideWindow({ count: 1, resetAt: at(30_000) }, NOW, 3, 60);
    assert.equal(d.count, 2);
    assert.equal(d.resetAt.getTime(), at(30_000).getTime());
    assert.equal(d.allowed, true);
  });

  it("a hit at or after resetAt starts a fresh window", () => {
    const exact = decideWindow({ count: 99, resetAt: NOW }, NOW, 3, 60);
    assert.deepEqual([exact.count, exact.resetAt.getTime(), exact.allowed], [1, at(60_000).getTime(), true]);
    const late = decideWindow({ count: 99, resetAt: at(-5_000) }, NOW, 3, 60);
    assert.deepEqual([late.count, late.allowed], [1, true]);
  });

  it("exactly limit is allowed; limit + 1 is denied with retryAfterSec >= 1", () => {
    const atLimit = decideWindow({ count: 2, resetAt: at(10_000) }, NOW, 3, 60);
    assert.equal(atLimit.count, 3);
    assert.equal(atLimit.allowed, true);
    const over = decideWindow({ count: 3, resetAt: at(10_000) }, NOW, 3, 60);
    assert.equal(over.count, 4);
    assert.equal(over.allowed, false);
    assert.equal(over.retryAfterSec, 10);
  });

  it("retryAfterSec rounds up and never goes below 1", () => {
    assert.equal(retryAfterSeconds(at(1), NOW), 1);
    assert.equal(retryAfterSeconds(at(1_001), NOW), 2);
    assert.equal(retryAfterSeconds(at(-500), NOW), 1);
    const almost = decideWindow({ count: 5, resetAt: at(200) }, NOW, 1, 60);
    assert.equal(almost.allowed, false);
    assert.ok(almost.retryAfterSec >= 1);
  });
});

describe("specs", () => {
  it("burst with windowSec > 300 throws at definition", () => {
    assert.throws(
      () => defineRateLimit({ bucket: "too-long", limit: 5, windowSec: BURST_MAX_WINDOW_SEC + 1, by: "user" }),
      RateLimitSpecError,
    );
    assert.throws(
      () => defineRateLimit({ bucket: "too-long", limit: 5, windowSec: 3600, by: "user", store: "burst" }),
      /burst window must be ≤ 300/,
    );
  });

  it("burst at exactly 300 s and durable above 300 s are fine", () => {
    assert.doesNotThrow(() => defineRateLimit({ bucket: "edge", limit: 5, windowSec: 300, by: "ip" }));
    const durable = defineRateLimit({ bucket: "daily", limit: 20, windowSec: 86_400, by: "user", store: "durable" });
    assert.equal(durable.windowSec, 86_400);
  });

  it("rejects bad bucket names, limits and windows", () => {
    assert.throws(() => defineRateLimit({ bucket: "Bad Name", limit: 1, windowSec: 1, by: "ip" }), RateLimitSpecError);
    assert.throws(() => defineRateLimit({ bucket: "x", limit: 0, windowSec: 1, by: "ip" }), RateLimitSpecError);
    assert.throws(() => defineRateLimit({ bucket: "x", limit: 1.5, windowSec: 1, by: "ip" }), RateLimitSpecError);
    assert.throws(() => defineRateLimit({ bucket: "x", limit: 1, windowSec: 0, by: "ip" }), RateLimitSpecError);
    assert.throws(
      () => defineRateLimit({ bucket: "x", limit: 1, windowSec: 1, by: "account" as RateLimitSpec["by"] }),
      RateLimitSpecError,
    );
  });

  it("phase 1 buckets match plan §8.1", () => {
    assert.deepEqual(RATE_LIMITS.billingRefresh, {
      bucket: "billing-refresh",
      limit: 10,
      windowSec: 60,
      by: "user",
      store: "burst",
    });
    assert.deepEqual(RATE_LIMITS.healthDeep, {
      bucket: "health-deep",
      limit: 6,
      windowSec: 60,
      by: "ip",
      store: "burst",
    });
  });

  it("store defaults to burst and picks the table", () => {
    assert.equal(storeFor({}), "burst");
    assert.equal(storeFor({ store: "durable" }), "durable");
    assert.equal(tableFor("burst"), "rate_limit_buckets");
    assert.equal(tableFor("durable"), "rate_limit_windows");
  });
});

describe("keys", () => {
  const PEPPER = "test-pepper";
  const user: RateLimitSpec = { bucket: "b", limit: 1, windowSec: 60, by: "user" };
  const ip: RateLimitSpec = { bucket: "b", limit: 1, windowSec: 60, by: "ip" };
  const both: RateLimitSpec = { bucket: "b", limit: 1, windowSec: 60, by: "user+ip" };

  it("by user uses the Clerk id", () => {
    assert.deepEqual(keysFor(user, { clerkUserId: "user_123", ip: "1.2.3.4" }, PEPPER), ["rl:b:c:user_123"]);
  });

  it("by user falls back to the IP when signed out", () => {
    assert.deepEqual(keysFor(user, { clerkUserId: null, ip: "1.2.3.4" }, PEPPER), [
      `rl:b:ip:${hashIp("1.2.3.4", PEPPER)}`,
    ]);
  });

  it("by ip uses the hashed IP only", () => {
    const keys = keysFor(ip, { clerkUserId: "user_123", ip: "1.2.3.4" }, PEPPER);
    assert.equal(keys.length, 1);
    assert.match(keys[0]!, /^rl:b:ip:[0-9a-f]{16}$/);
  });

  it("by user+ip checks both", () => {
    assert.deepEqual(keysFor(both, { clerkUserId: "user_123", ip: "1.2.3.4" }, PEPPER), [
      "rl:b:c:user_123",
      `rl:b:ip:${hashIp("1.2.3.4", PEPPER)}`,
    ]);
  });

  it("no subject → no keys", () => {
    assert.deepEqual(keysFor(both, {}, PEPPER), []);
    assert.deepEqual(keysFor(ip, { clerkUserId: "user_1" }, PEPPER), []);
  });

  it("the IP hash never contains the raw IP and depends on the pepper", () => {
    const raw = "203.0.113.77";
    const key = keysFor(ip, { ip: raw }, PEPPER)[0]!;
    assert.ok(!key.includes(raw));
    assert.ok(!key.includes("203.0.113"));
    assert.notEqual(hashIp(raw, "a"), hashIp(raw, "b"));
    assert.equal(hashIp(raw, PEPPER).length, 16);
  });

  it("keys fit the VARCHAR(120) column", () => {
    const longest = keysFor(
      { bucket: "a".repeat(40), limit: 1, windowSec: 1, by: "user" },
      { clerkUserId: "user_" + "x".repeat(60) },
      PEPPER,
    )[0]!;
    assert.ok(longest.length <= 120, `key is ${longest.length} chars`);
  });

  it("clientIpFrom reads the first x-forwarded-for hop", () => {
    assert.equal(clientIpFrom(new Headers({ "x-forwarded-for": "198.51.100.1, 10.0.0.1" })), "198.51.100.1");
    assert.equal(clientIpFrom(new Headers({ "x-real-ip": "198.51.100.2" })), "198.51.100.2");
    assert.equal(clientIpFrom(new Headers()), null);
  });
});

describe("SQL", () => {
  it("statement snapshot (guards accidental edits)", () => {
    assert.equal(
      RATE_LIMIT_SQL.burst,
      `INSERT INTO "rate_limit_buckets" AS b ("key", "count", "resetAt")
VALUES ($1, 1, (now() AT TIME ZONE 'UTC') + make_interval(secs => $2::int))
ON CONFLICT ("key") DO UPDATE SET
  "count"   = CASE WHEN b."resetAt" <= (now() AT TIME ZONE 'UTC') THEN 1 ELSE b."count" + 1 END,
  "resetAt" = CASE WHEN b."resetAt" <= (now() AT TIME ZONE 'UTC')
                   THEN (now() AT TIME ZONE 'UTC') + make_interval(secs => $2::int) ELSE b."resetAt" END
RETURNING "count", "resetAt"`,
    );
    assert.equal(RATE_LIMIT_SQL.durable, RATE_LIMIT_SQL.burst.replace('"rate_limit_buckets"', '"rate_limit_windows"'));
  });
});

describe("checkRateLimit", () => {
  /** In-memory fake of the upsert, driven by decideWindow. */
  function fakeDb(clock: () => Date) {
    const tables = new Map<string, Map<string, WindowRow>>();
    const calls: { table: string; key: string; windowSec: number }[] = [];
    const query: RateLimitQuery = async (sql, key, windowSec) => {
      const table = /INSERT INTO "(\w+)"/.exec(sql)![1]!;
      calls.push({ table, key, windowSec });
      const rows = tables.get(table) ?? new Map<string, WindowRow>();
      tables.set(table, rows);
      const d = decideWindow(rows.get(key) ?? null, clock(), Number.MAX_SAFE_INTEGER, windowSec);
      rows.set(key, { count: d.count, resetAt: d.resetAt });
      return [{ count: d.count, resetAt: d.resetAt }];
    };
    return { query, calls };
  }

  it("allows up to the limit, then denies with Retry-After", async () => {
    let now = NOW;
    const db = fakeDb(() => now);
    const spec = defineRateLimit({ bucket: "t", limit: 2, windowSec: 60, by: "user" });
    const subject = { clerkUserId: "user_a" };
    const deps = { query: db.query, now: () => now, pepper: "p" };
    assert.equal((await checkRateLimit(spec, subject, deps)).allowed, true);
    assert.equal((await checkRateLimit(spec, subject, deps)).allowed, true);
    now = at(15_000);
    const third = await checkRateLimit(spec, subject, deps);
    assert.deepEqual(third, { allowed: false, retryAfterSec: 45, bucket: "t" });
    now = at(60_000);
    assert.equal((await checkRateLimit(spec, subject, deps)).allowed, true);
  });

  it("routes each store to its table", async () => {
    const db = fakeDb(() => NOW);
    await checkRateLimit(
      [
        { bucket: "short", limit: 5, windowSec: 60, by: "user" },
        { bucket: "long", limit: 5, windowSec: 3600, by: "user", store: "durable" },
      ],
      { clerkUserId: "u" },
      { query: db.query, now: () => NOW, pepper: "p" },
    );
    assert.deepEqual(
      db.calls.map((c) => [c.table, c.key, c.windowSec]),
      [
        ["rate_limit_buckets", "rl:short:c:u", 60],
        ["rate_limit_windows", "rl:long:c:u", 3600],
      ],
    );
  });

  it("user+ip denies when either key is over", async () => {
    const db = fakeDb(() => NOW);
    const spec: RateLimitSpec = { bucket: "both", limit: 1, windowSec: 60, by: "user+ip" };
    const deps = { query: db.query, now: () => NOW, pepper: "p" };
    assert.equal((await checkRateLimit(spec, { clerkUserId: "u1", ip: "1.1.1.1" }, deps)).allowed, true);
    // a different user from the same IP: user key is fresh, IP key is over
    const r = await checkRateLimit(spec, { clerkUserId: "u2", ip: "1.1.1.1" }, deps);
    assert.equal(r.allowed, false);
    assert.equal(r.bucket, "both");
  });

  it("fails open on a database error and reports it", async () => {
    const errors: string[] = [];
    const r = await checkRateLimit(
      { bucket: "x", limit: 1, windowSec: 60, by: "user" },
      { clerkUserId: "u" },
      {
        query: async () => {
          throw new Error("connection refused");
        },
        onError: (_err, bucket) => errors.push(bucket),
        pepper: "p",
      },
    );
    assert.deepEqual(r, { allowed: true, retryAfterSec: 0, failedOpen: true });
    assert.deepEqual(errors, ["x"]);
  });

  it("fails open when the statement returns no row", async () => {
    const r = await checkRateLimit(
      { bucket: "x", limit: 1, windowSec: 60, by: "user" },
      { clerkUserId: "u" },
      { query: async () => [], onError: () => {}, pepper: "p" },
    );
    assert.equal(r.allowed, true);
    assert.equal(r.failedOpen, true);
  });

  it("a burst spec over 300 s throws even when passed directly", async () => {
    await assert.rejects(
      checkRateLimit({ bucket: "x", limit: 1, windowSec: 600, by: "user" }, { clerkUserId: "u" }, { pepper: "p" }),
      RateLimitSpecError,
    );
  });

  it("no keys → allowed without a query", async () => {
    let called = false;
    const r = await checkRateLimit(
      { bucket: "x", limit: 1, windowSec: 60, by: "ip" },
      {},
      {
        query: async () => {
          called = true;
          return [];
        },
      },
    );
    assert.deepEqual(r, { allowed: true, retryAfterSec: 0 });
    assert.equal(called, false);
  });
});

describe("IP pepper fail-safe (plan §8.1, §11.3)", () => {
  it("uses RATE_LIMIT_IP_PEPPER when set, without reporting", () => {
    const reports: string[] = [];
    assert.equal(resolveIpPepper({ RATE_LIMIT_IP_PEPPER: "pep", CLERK_SECRET_KEY: "sk" }, (s) => reports.push(s)), "pep");
    assert.deepEqual(reports, []);
  });

  it("derives a stable, secret-dependent pepper from a server secret when unset, and reports it", () => {
    const reports: string[] = [];
    const a = resolveIpPepper({ CLERK_SECRET_KEY: "sk_test_one" }, (s) => reports.push(s));
    const again = resolveIpPepper({ CLERK_SECRET_KEY: "sk_test_one" });
    const b = resolveIpPepper({ CLERK_SECRET_KEY: "sk_test_two" });
    const internal = resolveIpPepper({ INTERNAL_API_SECRET: "internal" });
    assert.equal(a.length, 64);
    assert.equal(a, again, "same on every instance");
    assert.notEqual(a, b);
    assert.ok(!a.includes("sk_test_one"), "the secret itself is not the pepper");
    assert.notEqual(internal, "");
    assert.deepEqual(reports, ["derived"]);
    assert.notEqual(hashIp("203.0.113.7", a), hashIp("203.0.113.7", ""), "not the unsalted hash");
  });

  it("falls back to an empty pepper only with no secret at all, and reports it", () => {
    const reports: string[] = [];
    assert.equal(resolveIpPepper({}, (s) => reports.push(s)), "");
    assert.deepEqual(reports, ["none"]);
  });
});
