import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { decodeCursor, encodeCursor } from "./cursor";

const b64url = (s: string) => Buffer.from(s).toString("base64url");

describe("cursor", () => {
  it("round-trips strings, numbers and null", () => {
    const parts = ["2026-11-02T08:00:00.000Z", 42, null, "cmvy5lged0001slshphrgntv9"];
    const c = encodeCursor(parts);
    assert.match(c, /^[A-Za-z0-9_-]+$/);
    assert.deepEqual(decodeCursor(c, 4), parts);
  });

  it("round-trips non-ASCII text", () => {
    const parts = ["Réti — 1.Nf3", "♞"];
    assert.deepEqual(decodeCursor(encodeCursor(parts), 2), parts);
  });

  it("matches the documented format base64url(JSON.stringify([1, ...parts]))", () => {
    assert.equal(encodeCursor(["a", 1]), b64url(JSON.stringify([1, "a", 1])));
  });

  it("returns null for tampered base64", () => {
    const c = encodeCursor(["a", 1]);
    assert.equal(decodeCursor(`${c}!`, 2), null);
    assert.equal(decodeCursor(c.slice(0, -3), 2), null);
    assert.equal(decodeCursor("A", 2), null);
    assert.equal(decodeCursor(b64url("not json"), 1), null);
    assert.equal(decodeCursor(Buffer.from([0xff, 0xfe, 0x5b]).toString("base64url"), 1), null);
  });

  it("returns null for the wrong arity", () => {
    const c = encodeCursor(["a", 1]);
    assert.equal(decodeCursor(c, 1), null);
    assert.equal(decodeCursor(c, 3), null);
  });

  it("returns null when the version is not 1", () => {
    assert.equal(decodeCursor(b64url(JSON.stringify([2, "a"])), 1), null);
    assert.equal(decodeCursor(b64url(JSON.stringify(["1", "a"])), 1), null);
  });

  it("returns null for non-array JSON, nested parts, empty and oversize input", () => {
    assert.equal(decodeCursor(b64url(JSON.stringify({ 0: 1 })), 0), null);
    assert.equal(decodeCursor(b64url(JSON.stringify([1, { a: 1 }])), 1), null);
    assert.equal(decodeCursor(b64url(JSON.stringify([1, [1]])), 1), null);
    assert.equal(decodeCursor("", 0), null);
    assert.equal(decodeCursor(undefined, 0), null);
    assert.equal(decodeCursor(null, 0), null);
    assert.equal(decodeCursor("A".repeat(300), 1), null);
  });
});
