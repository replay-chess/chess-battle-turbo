import assert from "node:assert/strict";
import { test } from "node:test";
import { canWinOnTime, flagOutcome } from "../src/rules/insufficient";

// White flags; the result depends only on Black's material (plan 8.9).
const withBlack = (black: string) => `${black}/8/8/8/8/8/8/4K2Q w - - 0 60`;

test("the other side has K, K+N or K+B → draw on time", () => {
  for (const b of ["4k3", "3nk3", "3bk3"]) {
    assert.deepEqual(flagOutcome(withBlack(b), "w"), { method: "timeout_vs_insufficient", winner: null }, b);
  }
});

test("K+N+N, K+P, K+R, K+B+B → the other side wins on time", () => {
  for (const b of ["2nnk3", "3pk3", "3rk3", "2bbk3"]) {
    assert.deepEqual(flagOutcome(withBlack(b), "w"), { method: "timeout", winner: "b" }, b);
  }
});

test("the flagging side's own material does not matter", () => {
  assert.equal(canWinOnTime("4k3/8/8/8/8/8/8/4K3 w - - 0 1", "b"), false);
  assert.deepEqual(flagOutcome("4k3/8/8/8/8/8/8/Q3K3 w - - 0 1", "w"), {
    method: "timeout_vs_insufficient",
    winner: null,
  });
});

test.todo("known Lichess difference: K+N vs K+P is a win on time there (helpmate exists); a draw here");
test.todo("known Lichess difference: K+B vs K+B with opposite-colour bishops can be a win on time there; a draw here");
