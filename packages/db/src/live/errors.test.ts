import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createPoolReset, dbErrorCode, isTransientDbError, withTransientRetry } from "./errors";

/** Shapes the Prisma engine produces (PrismaClientKnownRequestError / InitializationError / raw-query P2010). */
function known(code: string, message = "x", meta?: Record<string, unknown>) {
  return Object.assign(new Error(message), { code, meta, clientVersion: "6.17.1" });
}

describe("isTransientDbError (plan 6.7 rule 2)", () => {
  it("P1017, P1001 and the SQLSTATEs 57P01, 08006, 08003 and ECONNRESET are transient", () => {
    assert.equal(isTransientDbError(known("P1017", "Server has closed the connection.")), true);
    assert.equal(isTransientDbError(Object.assign(new Error("Can't reach database server"), { errorCode: "P1001" })), true);
    for (const state of ["57P01", "08006", "08003"]) {
      assert.equal(isTransientDbError(known("P2010", `Raw query failed. Code: \`${state}\``, { code: state })), true, state);
      assert.equal(isTransientDbError(known(state)), true, `${state} as code`);
    }
    assert.equal(isTransientDbError(Object.assign(new Error("read ECONNRESET"), { code: "ECONNRESET" })), true);
    assert.equal(isTransientDbError(new Error("socket hang up: read ECONNRESET")), true);
  });

  it("the admin-shutdown message without a code is transient (pg_terminate_backend, Neon suspend)", () => {
    assert.equal(isTransientDbError(new Error("FATAL: terminating connection due to administrator command")), true);
    assert.equal(isTransientDbError(known("P2010", "Raw query failed. Code: `57P01`. Message: `terminating connection`")), true);
  });

  it("a unique violation, 22P02 and other request errors are not transient", () => {
    assert.equal(isTransientDbError(known("P2002", "Unique constraint failed")), false);
    assert.equal(isTransientDbError(known("P2010", "Raw query failed. Code: `23505`", { code: "23505" })), false);
    assert.equal(isTransientDbError(known("P2010", "Raw query failed. Code: `22P02`. Message: invalid input syntax")), false);
    assert.equal(isTransientDbError(known("22P02")), false);
    assert.equal(isTransientDbError(known("P2025", "Record not found")), false);
    assert.equal(isTransientDbError(new Error("boom")), false);
    assert.equal(isTransientDbError(null), false);
    assert.equal(isTransientDbError("ECONNRESET"), false);
  });

  it("looks through `cause`", () => {
    const wrapped = new Error("persist failed", { cause: known("P1017") });
    assert.equal(isTransientDbError(wrapped), true);
  });

  it("dbErrorCode prefers the wrapped SQLSTATE", () => {
    assert.equal(dbErrorCode(known("P2010", "x", { code: "57P01" })), "57P01");
    assert.equal(dbErrorCode(known("P2002")), "P2002");
    assert.equal(dbErrorCode(new Error("x")), null);
  });
});

describe("withTransientRetry", () => {
  it("retries a transient failure at once and reports it", async () => {
    let calls = 0;
    const seen: unknown[] = [];
    const value = await withTransientRetry(
      async () => {
        calls++;
        if (calls === 1) throw known("P1017");
        return 42;
      },
      { onTransient: (e) => seen.push(e) },
    );
    assert.equal(value, 42);
    assert.equal(calls, 2);
    assert.equal(seen.length, 1);
  });

  it("throws the second failure (the outbox backs off); resets the pool before the retry", async () => {
    let calls = 0;
    let resets = 0;
    await assert.rejects(
      withTransientRetry(
        async () => {
          calls++;
          throw known("P1017");
        },
        { reset: async () => void resets++ },
      ),
      /x/,
    );
    assert.equal(calls, 2);
    assert.equal(resets, 1);
    calls = 0;
    await assert.rejects(
      withTransientRetry(
        async () => {
          calls++;
          throw known("P1017");
        },
        { maxImmediateRetries: 3 },
      ),
    );
    assert.equal(calls, 4);
  });

  it("createPoolReset is single-flight and rate-limited", async () => {
    let disconnects = 0;
    let t = 0;
    let release!: () => void;
    const db = { $disconnect: () => new Promise<void>((r) => ((release = r), disconnects++)) };
    const reset = createPoolReset(db, 1000, () => t);
    const p1 = reset();
    const p2 = reset();
    assert.equal(p1, p2);
    release();
    await p1;
    assert.equal(disconnects, 1);
    t = 500;
    await reset();
    assert.equal(disconnects, 1, "within the interval: skipped");
    t = 2000;
    const p3 = reset();
    release();
    await p3;
    assert.equal(disconnects, 2);
  });

  it("never retries a permanent error", async () => {
    let calls = 0;
    await assert.rejects(
      withTransientRetry(async () => {
        calls++;
        throw known("P2002");
      }),
    );
    assert.equal(calls, 1);
  });
});
