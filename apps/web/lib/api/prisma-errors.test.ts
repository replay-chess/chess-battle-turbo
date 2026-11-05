import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ApiError } from "./api-error";
import { isRetryableConnectionError, mapPrismaError, prismaCodeOf, withConnectionRetry } from "./prisma-errors";

const err = (fields: Record<string, unknown>) => Object.assign(new Error("prisma"), fields);

describe("prisma error mapping", () => {
  it("reads code or errorCode", () => {
    assert.equal(prismaCodeOf(err({ code: "P2002" })), "P2002");
    assert.equal(prismaCodeOf(err({ errorCode: "P1001" })), "P1001");
    assert.equal(prismaCodeOf(err({ code: "ECONNRESET" })), null);
    assert.equal(prismaCodeOf("P2002"), null);
  });
  it("maps the four families", () => {
    const conflict = mapPrismaError(err({ code: "P2002", meta: { target: ["email"] } }))!;
    assert.ok(conflict instanceof ApiError);
    assert.equal(conflict.status, 409);
    assert.deepEqual(conflict.details, { target: ["email"] });
    assert.equal(mapPrismaError(err({ code: "P2025" }))!.code, "not_found");
    for (const code of ["P2024", "P2028", "P1001", "P1017"]) {
      const mapped = mapPrismaError(err({ code }))!;
      assert.equal(mapped.code, "unavailable", code);
      assert.equal(mapped.retryAfterSec, 2);
    }
    assert.equal(mapPrismaError(err({ code: "P2003" })), null);
    assert.equal(mapPrismaError(new Error("x")), null);
  });
  it("retries a GET once on P1001/P1017 after 300 ms", async () => {
    assert.equal(isRetryableConnectionError(err({ code: "P1017" })), true);
    const sleeps: number[] = [];
    let calls = 0;
    const value = await withConnectionRetry(
      "GET",
      async () => {
        calls += 1;
        if (calls === 1) throw err({ errorCode: "P1001" });
        return "ok";
      },
      async (ms) => {
        sleeps.push(ms);
      },
    );
    assert.equal(value, "ok");
    assert.deepEqual(sleeps, [300]);
  });
  it("never retries a write or a non-connection error", async () => {
    let calls = 0;
    const failing = async () => {
      calls += 1;
      throw err({ code: "P1001" });
    };
    await assert.rejects(withConnectionRetry("POST", failing, async () => undefined));
    assert.equal(calls, 1);
    calls = 0;
    await assert.rejects(
      withConnectionRetry("GET", async () => {
        calls += 1;
        throw err({ code: "P2002" });
      }, async () => undefined),
    );
    assert.equal(calls, 1);
  });
});
