import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mwLagMs, requestIdFrom } from "./request-id";

describe("request id", () => {
  it("keeps a well-formed incoming id and replaces anything else", () => {
    assert.equal(requestIdFrom(new Headers({ "x-request-id": "abc-123:XYZ.9" })), "abc-123:XYZ.9");
    for (const bad of ["short", "has space here", "x".repeat(129), "inject\"quote\""]) {
      assert.match(requestIdFrom(new Headers({ "x-request-id": bad })), /^[0-9a-f-]{36}$/, bad);
    }
    assert.match(requestIdFrom(new Headers()), /^[0-9a-f-]{36}$/);
  });
  it("mwLagMs from x-mw-start, never negative, null when unusable", () => {
    assert.equal(mwLagMs(new Headers({ "x-mw-start": "1000" }), 1012.4), 12);
    assert.equal(mwLagMs(new Headers({ "x-mw-start": "2000" }), 1000), 0);
    assert.equal(mwLagMs(new Headers({ "x-mw-start": "nope" }), 1000), null);
    assert.equal(mwLagMs(new Headers(), 1000), null);
  });
});
