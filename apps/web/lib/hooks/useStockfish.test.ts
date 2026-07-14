import assert from "node:assert/strict";
import test from "node:test";
import { parseStockfishInfoLine } from "./useStockfish";

test("parses Stockfish MultiPV output", () => {
  assert.deepEqual(
    parseStockfishInfoLine(
      "info depth 16 multipv 2 score cp -34 nodes 100 pv e2e4 e7e5",
    ),
    {
      depth: 16,
      multipv: 2,
      scoreCp: -34,
      scoreMate: null,
      pv: ["e2e4", "e7e5"],
    },
  );
});

test("ignores non-PV engine messages", () => {
  assert.equal(parseStockfishInfoLine("bestmove e2e4"), null);
});
