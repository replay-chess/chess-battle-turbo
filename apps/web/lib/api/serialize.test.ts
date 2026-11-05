import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { SerializeError, serialize, serializeModeFor } from "./serialize";

const decimalLike = { d: [1, 5], e: 0, s: 1, toFixed: () => "1.5", toString: () => "1.5", toJSON: () => "1.5" };

describe("serialize", () => {
  it("strict: nested BigInt throws with its path", () => {
    assert.throws(() => serialize({ a: { b: [1, 2n] } }, { mode: "strict" }), (err: unknown) => {
      assert.ok(err instanceof SerializeError);
      assert.match(err.message, /a\.b\.1/);
      return true;
    });
    assert.throws(() => serialize(5n, { mode: "strict" }), SerializeError);
  });
  it("lenient: BigInt becomes a string and is reported once", () => {
    const seen: string[] = [];
    const json = serialize({ id: 7n, more: [8n] }, { mode: "lenient", onCoerce: (kind, path) => seen.push(`${kind}@${path}`) });
    assert.equal(json, '{"id":"7","more":["8"]}');
    assert.deepEqual(seen, ["bigint@id"]);
  });
  it("Dates become ISO strings; undefined fields are dropped; null is kept", () => {
    const json = serialize({ at: new Date("2026-01-02T03:04:05.000Z"), gone: undefined, none: null, list: [undefined] }, { mode: "strict" });
    assert.equal(json, '{"at":"2026-01-02T03:04:05.000Z","none":null,"list":[null]}');
  });
  it("Decimal-like objects are rejected in strict and stringified in lenient", () => {
    assert.throws(() => serialize({ price: decimalLike }, { mode: "strict" }), /Decimal at price/);
    assert.equal(serialize({ price: decimalLike }, { mode: "lenient" }), '{"price":"1.5"}');
  });
  it("Map and Set are rejected in strict", () => {
    assert.throws(() => serialize({ m: new Map() }, { mode: "strict" }), /Map at m/);
    assert.throws(() => serialize({ s: new Set([1]) }, { mode: "strict" }), /Set at s/);
  });
  it("mode: strict in dev/test and local, lenient only for a production build serving production", () => {
    assert.equal(serializeModeFor({ NODE_ENV: "production", NEXT_PUBLIC_APP_ENV: "production" }), "lenient");
    assert.equal(serializeModeFor({ NODE_ENV: "production" }), "lenient");
    assert.equal(serializeModeFor({ NODE_ENV: "production", NEXT_PUBLIC_APP_ENV: "dev" }), "strict");
    assert.equal(serializeModeFor({ NODE_ENV: "production", NEXT_PUBLIC_APP_ENV: "test" }), "strict");
    assert.equal(serializeModeFor({ NODE_ENV: "development" }), "strict");
  });
});
