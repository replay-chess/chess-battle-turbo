// The worker's DB client (phase-03 plan P3-D11, §9.8): one immediate retry of a transient failure (network, `57P01`
// on a Neon suspend), never of a real error; round trips counted (the timer audit); bigint parameters sent as text.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CountingDb, idStr, isRetryableDbError, num, wasRetried, type Driver, type Row, type Statement } from "./client";

function driver(script: (Error | Row[][])[]): Driver & { calls: { ss: readonly Statement[]; tx: boolean }[] } {
  const calls: { ss: readonly Statement[]; tx: boolean }[] = [];
  return {
    calls,
    async run(ss, tx) {
      calls.push({ ss, tx });
      const next = script.shift();
      if (next instanceof Error) throw next;
      return next ?? ss.map(() => []);
    },
    async close() {},
  };
}

const err = (props: Record<string, unknown>, message = "x") => Object.assign(new Error(message), props);

describe("db client", () => {
  it("classifies transient failures", () => {
    assert.equal(isRetryableDbError(err({ code: "57P01" })), true, "admin shutdown (Neon suspend)");
    assert.equal(isRetryableDbError(err({ code: "08006" })), true);
    assert.equal(isRetryableDbError(err({ code: "ECONNRESET" })), true);
    assert.equal(isRetryableDbError(err({ code: "UND_ERR_SOCKET" })), true);
    assert.equal(isRetryableDbError(new TypeError("fetch failed")), true);
    assert.equal(isRetryableDbError(err({ name: "NeonDbError" }, "Error connecting to database: fetch failed")), true);
    assert.equal(isRetryableDbError(err({ sourceError: err({ code: "ETIMEDOUT" }) })), true, "the cause chain");
    assert.equal(isRetryableDbError(err({ code: "23505" })), false, "unique violation");
    assert.equal(isRetryableDbError(err({ code: "22012" })), false, "the lock guard");
    assert.equal(isRetryableDbError(err({ code: "42501" })), false, "permission denied");
    assert.equal(isRetryableDbError(null), false);
  });

  it("retries a transient failure once, immediately, and counts it", async () => {
    const d = driver([err({ code: "57P01" }), [[{ ok: 1 }]]]);
    const db = new CountingDb(d);
    assert.deepEqual(await db.query({ text: "SELECT 1", values: [] }), [{ ok: 1 }]);
    assert.equal(d.calls.length, 2);
    assert.deepEqual(db.counters, { roundTrips: 2, statements: 2, retries: 1 });
  });

  it("propagates a second transient failure, and never retries a real error", async () => {
    const twice = new CountingDb(driver([err({ code: "57P01" }), err({ code: "08006" }, "again")]));
    await assert.rejects(twice.query({ text: "SELECT 1", values: [] }), /again/);
    const d = driver([err({ code: "23505" }, "dup")]);
    await assert.rejects(new CountingDb(d).query({ text: "INSERT", values: [] }), /dup/);
    assert.equal(d.calls.length, 1);
  });

  // regression: lost-claim-response (FIX-1). Every statement was retried as itself, also the ones that are not
  // idempotent (the claim, the fail write), and nothing told a caller that its first attempt might have committed.
  it("retries a statement with its retry form, never one marked never, and marks errors from the retry", async () => {
    const formed = driver([err({ code: "ECONNRESET" }), [[{ adopted: 1 }]]]);
    const db = new CountingDb(formed);
    const claim: Statement = { text: "CLAIM", values: [1], retry: { text: "ADOPT_OR_CLAIM", values: [1] } };
    assert.deepEqual(await db.query(claim), [{ adopted: 1 }]);
    assert.deepEqual(
      formed.calls.map((c) => c.ss.map((s) => s.text)),
      [["CLAIM"], ["ADOPT_OR_CLAIM"]],
    );
    const batch = driver([err({ code: "57P01" }), [[], []]]);
    await new CountingDb(batch).batch([claim, { text: "PLAIN", values: [] }]);
    assert.deepEqual(batch.calls[1]!.ss.map((s) => s.text), ["ADOPT_OR_CLAIM", "PLAIN"]);

    const never = driver([err({ code: "ECONNRESET" }, "lost")]);
    await assert.rejects(new CountingDb(never).query({ text: "X", values: [], retry: "never" }), (e: unknown) => {
      assert.equal(wasRetried(e), false);
      return true;
    });
    assert.equal(never.calls.length, 1);

    const guard = driver([err({ code: "ECONNRESET" }), err({ code: "22012" }, "division by zero")]);
    await assert.rejects(new CountingDb(guard).batch([{ text: "GUARD", values: [] }]), (e: unknown) => {
      assert.equal(wasRetried(e), true, "the 22012 came from the retry");
      return true;
    });
    const first = driver([err({ code: "22012" }, "division by zero")]);
    await assert.rejects(new CountingDb(first).batch([{ text: "GUARD", values: [] }]), (e: unknown) => {
      assert.equal(wasRetried(e), false);
      return true;
    });
  });

  it("a batch is one round trip in one transaction; an empty batch is none", async () => {
    const d = driver([[[{ a: 1 }], [{ b: 2 }]]]);
    const db = new CountingDb(d);
    assert.deepEqual(await db.batch([{ text: "A", values: [] }, { text: "B", values: [] }]), [[{ a: 1 }], [{ b: 2 }]]);
    assert.deepEqual(await db.batch([]), []);
    assert.equal(d.calls.length, 1);
    assert.equal(d.calls[0]!.tx, true);
    assert.deepEqual(db.counters, { roundTrips: 1, statements: 2, retries: 0 });
  });

  it("sends bigint parameters as decimal text", async () => {
    const d = driver([]);
    await new CountingDb(d).query({ text: "SELECT $1", values: [9007199254740993n, "x"] });
    assert.deepEqual(d.calls[0]!.ss[0]!.values, ["9007199254740993", "x"]);
  });

  it("row helpers read int8 text and numbers exactly", () => {
    assert.equal(idStr("9007199254740993"), "9007199254740993");
    assert.equal(idStr(42), "42");
    assert.throws(() => idStr("1e3"));
    assert.equal(num("12"), 12);
    assert.throws(() => num("x"));
  });
});
