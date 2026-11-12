import assert from "node:assert/strict";
import { test } from "node:test";
import { createWithFreeFen, withHalfmove } from "./unique-fen";

const FEN = "rn2kb1r/p3qppp/2p2n2/1p2p1B1/2B1P3/1QN5/PPP2PPP/R3K2R w KQkq - 0 10";
const conflict = Object.assign(new Error("Unique constraint failed on the fields: (`fen`)"), { code: "P2002", meta: { target: ["fen"] } });

test("withHalfmove sets field 5 only", () => {
  assert.equal(withHalfmove(FEN, 37), "rn2kb1r/p3qppp/2p2n2/1p2p1B1/2B1P3/1QN5/PPP2PPP/R3K2R w KQkq - 37 10");
  assert.throws(() => withHalfmove("8/8/8/8 w", 1), /six-field/);
});

test("regression: int-unique-fen: a taken FEN is retried with another halfmove clock", async () => {
  const taken = new Set<string>();
  for (let h = 0; h < 99; h++) taken.add(withHalfmove(FEN, h));
  const seen: string[] = [];
  const fen = await createWithFreeFen(FEN, async (f) => {
    seen.push(f);
    if (taken.has(f)) throw conflict;
    return f;
  }, 5_000);
  assert.equal(fen, withHalfmove(FEN, 99), "found the one free value");
  assert.ok(seen.length > 1);
});

test("other errors are not retried", async () => {
  let calls = 0;
  await assert.rejects(
    createWithFreeFen(FEN, async () => {
      calls++;
      throw Object.assign(new Error("other"), { code: "P2002", meta: { target: ["referenceId"] } });
    }),
    /other/,
  );
  assert.equal(calls, 1);
});
