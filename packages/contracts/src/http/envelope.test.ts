import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { z } from "zod";
import { ErrorBody, ErrorEnvelope, ok, PageMeta } from "./envelope";

describe("envelope", () => {
  it("parses a full error body", () => {
    const body = {
      error: {
        code: "validation_failed",
        message: "Check the highlighted fields.",
        fields: { "user.name": "Too long" },
        details: { issues: [{ path: ["user", "name"], code: "too_big", message: "Too long" }] },
        requestId: "req_1",
      },
    };
    assert.deepEqual(ErrorEnvelope.parse(body), body);
  });

  it("degrades an unknown code to internal", () => {
    const parsed = ErrorBody.parse({ code: "from_the_future", message: "x", requestId: "r" });
    assert.equal(parsed.code, "internal");
  });

  it("requires requestId and message", () => {
    assert.equal(ErrorBody.safeParse({ code: "internal", message: "x" }).success, false);
    assert.equal(ErrorBody.safeParse({ code: "internal", requestId: "r" }).success, false);
  });

  it("rejects a negative or fractional retryAfterSec", () => {
    assert.equal(ErrorBody.safeParse({ code: "rate_limited", message: "x", requestId: "r", retryAfterSec: -1 }).success, false);
    assert.equal(ErrorBody.safeParse({ code: "rate_limited", message: "x", requestId: "r", retryAfterSec: 1.5 }).success, false);
    assert.equal(ErrorBody.safeParse({ code: "rate_limited", message: "x", requestId: "r", retryAfterSec: 30 }).success, true);
  });

  it("ok(schema) accepts { data } and { data, meta }", () => {
    const Page = ok(z.array(z.number()));
    assert.deepEqual(Page.parse({ data: [1, 2] }), { data: [1, 2] });
    assert.deepEqual(Page.parse({ data: [1], meta: { nextCursor: "abc", total: 3 } }), { data: [1], meta: { nextCursor: "abc", total: 3 } });
    assert.deepEqual(Page.parse({ data: [], meta: { nextCursor: null } }), { data: [], meta: { nextCursor: null } });
    assert.deepEqual(Page.parse({ data: [], meta: {} }), { data: [], meta: {} });
    assert.equal(Page.safeParse({ data: ["x"] }).success, false);
    assert.equal(Page.safeParse({}).success, false);
  });

  it("PageMeta needs nextCursor", () => {
    assert.equal(PageMeta.safeParse({ total: 1 }).success, false);
    assert.equal(PageMeta.safeParse({ nextCursor: null }).success, true);
  });
});
