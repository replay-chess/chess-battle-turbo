import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Color, CursorParam, FenLoose, IsoDateTime, Limit, Ref, Uci } from "./common";

const ok = (schema: { safeParse(v: unknown): { success: boolean } }, v: unknown) => schema.safeParse(v).success;

describe("common primitives", () => {
  it("Ref accepts cuids only", () => {
    assert.ok(ok(Ref, "cmvy5lged0001slshphrgntv9"));
    assert.ok(!ok(Ref, "123"));
    assert.ok(!ok(Ref, "Cmvy5lged0001slshphrgntv9"));
    assert.ok(!ok(Ref, "c" + "a".repeat(40)));
  });

  it("IsoDateTime needs a UTC instant", () => {
    assert.ok(ok(IsoDateTime, "2026-11-02T08:00:00.000Z"));
    assert.ok(ok(IsoDateTime, "2026-11-02T08:00:00Z"));
    assert.ok(!ok(IsoDateTime, "2026-11-02T08:00:00+05:30"));
    assert.ok(!ok(IsoDateTime, "2026-11-02"));
  });

  it("Limit coerces, defaults and clamps by rejecting", () => {
    assert.equal(Limit().parse(undefined), 20);
    assert.equal(Limit(30, 100).parse("75"), 75);
    assert.ok(!ok(Limit(), "0"));
    assert.ok(!ok(Limit(), "51"));
    assert.ok(!ok(Limit(), "2.5"));
  });

  it("CursorParam is optional base64url up to 256 chars", () => {
    assert.ok(ok(CursorParam, undefined));
    assert.ok(ok(CursorParam, "WzEsImEiXQ"));
    assert.ok(!ok(CursorParam, "a+b/"));
    assert.ok(!ok(CursorParam, "a".repeat(257)));
  });

  it("Uci and Color", () => {
    for (const m of ["e2e4", "e7e8q", "a1h8"]) assert.ok(ok(Uci, m), m);
    for (const m of ["e2e9", "e7e8k", "e2-e4", "O-O"]) assert.ok(!ok(Uci, m), m);
    assert.ok(ok(Color, "w") && ok(Color, "b") && !ok(Color, "white"));
  });

  it("FenLoose checks the layout, not legality", () => {
    assert.ok(ok(FenLoose, "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1"));
    assert.ok(ok(FenLoose, "8/8/8/8/8/8/8/K6k w - -"));
    assert.ok(!ok(FenLoose, "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP w KQkq - 0 1"));
    assert.ok(!ok(FenLoose, "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR x KQkq - 0 1"));
    assert.ok(!ok(FenLoose, "hello"));
  });
});
