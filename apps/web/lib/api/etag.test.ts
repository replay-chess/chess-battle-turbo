import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { fnv1a64, ifNoneMatchHit, quoteEtag, strongEtag } from "./etag";

describe("etag", () => {
  it("fnv1a64 matches the reference vectors", () => {
    assert.equal(fnv1a64(""), "cbf29ce484222325");
    assert.equal(fnv1a64("a"), "af63dc4c8601ec8c");
    assert.equal(fnv1a64("foobar"), "85944171f73967e8");
  });
  it("is stable for equal JSON; key order matters only through JSON.stringify", () => {
    assert.equal(strongEtag(JSON.stringify({ a: 1, b: 2 })), strongEtag(JSON.stringify({ a: 1, b: 2 })));
    assert.notEqual(strongEtag(JSON.stringify({ a: 1, b: 2 })), strongEtag(JSON.stringify({ b: 2, a: 1 })));
    assert.match(strongEtag("x"), /^"[0-9a-f]{16}"$/);
  });
  it("handles UTF-8 beyond ASCII", () => {
    assert.notEqual(fnv1a64("é"), fnv1a64("e"));
    assert.equal(fnv1a64("♞").length, 16);
  });
  it("If-None-Match: exact, weak, lists and *", () => {
    const tag = '"abc"';
    assert.equal(ifNoneMatchHit('"abc"', tag), true);
    assert.equal(ifNoneMatchHit('W/"abc"', tag), true);
    assert.equal(ifNoneMatchHit('"x", "abc"', tag), true);
    assert.equal(ifNoneMatchHit("*", tag), true);
    assert.equal(ifNoneMatchHit('"abd"', tag), false);
    assert.equal(ifNoneMatchHit(null, tag), false);
  });
  it("quoteEtag quotes bare tags only", () => {
    assert.equal(quoteEtag("v1"), '"v1"');
    assert.equal(quoteEtag('"v1"'), '"v1"');
    assert.equal(quoteEtag('W/"v1"'), 'W/"v1"');
  });
});
