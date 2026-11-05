import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ERROR_CODES, ERROR_STATUS } from "@repo/contracts/http/codes";
import { ErrorEnvelope } from "@repo/contracts/http/envelope";
import { ApiError, DEFAULT_ERROR_MESSAGES } from "./api-error";
import { apiErrorResponse, created, errorResponse, isRouteResult, respondWith } from "./respond";

describe("ApiError", () => {
  it("takes its status from the code ledger and a safe default message", () => {
    for (const code of ERROR_CODES) {
      const e = new ApiError(code);
      assert.equal(e.status, ERROR_STATUS[code]);
      assert.equal(e.message, DEFAULT_ERROR_MESSAGES[code]);
    }
    assert.equal(new ApiError("internal").message, "Something went wrong");
    assert.equal(new ApiError("rate_limited", { retryAfterSec: 2.2 }).retryAfterSec, 3);
  });
});

describe("error responses", () => {
  it("envelope, status, no-store, x-request-id, Retry-After", async () => {
    const res = errorResponse({ code: "rate_limited", retryAfterSec: 9, details: { bucket: "b" }, requestId: "rid-00000001" });
    assert.equal(res.status, 429);
    assert.equal(res.headers.get("cache-control"), "private, no-store");
    assert.equal(res.headers.get("x-request-id"), "rid-00000001");
    assert.equal(res.headers.get("retry-after"), "9");
    const body = ErrorEnvelope.parse(await res.json());
    assert.deepEqual(body.error, {
      code: "rate_limited",
      message: DEFAULT_ERROR_MESSAGES.rate_limited,
      details: { bucket: "b" },
      retryAfterSec: 9,
      requestId: "rid-00000001",
    });
  });
  it("apiErrorResponse keeps fields and adds a top-level mirror", async () => {
    const res = apiErrorResponse(new ApiError("validation_failed", { fields: { a: "bad" } }), "rid-00000002", {
      topLevel: { code: "legacy" },
    });
    const body = (await res.json()) as { code: string; error: { fields: unknown } };
    assert.equal(body.code, "legacy");
    assert.deepEqual(body.error.fields, { a: "bad" });
  });
  it("result markers", () => {
    assert.equal(isRouteResult(respondWith(1, {})), true);
    assert.equal(isRouteResult({ data: 1, options: {} }), false);
    assert.deepEqual(created({ a: 1 }, "/x").options, { status: 201, location: "/x" });
  });
});
