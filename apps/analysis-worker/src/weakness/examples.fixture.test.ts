// Chess-correctness fixture `FX/weakness/examples.json` (phase-06 plan §12.5, §8.19; FIX-1): 10 mistakes of real CC0
// Lichess games stored as the bank stores them (the position before the opponent's setup move + `setupUci`). The
// example the profile shows (examples.ts exampleFen / toExamples) must be the position after the setup: a legal FEN with
// the member to move, oriented to the member's colour, from which the member's played and best moves are legal.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { describe, it } from "node:test";
import { Chess } from "chess.js";
import { exampleFen, toExamples } from "./examples";

type Example = { id: string; color: "w" | "b"; fen: string; setupUci: string; expectedFen: string; played: string; best: string | null; judgement: string };
const require = createRequire(import.meta.url);
const { examples } = JSON.parse(readFileSync(require.resolve("@repo/chess-fixtures/weakness/examples.json"), "utf8")) as { examples: Example[] };

const legal = (fen: string, uci: string) => {
  const c = new Chess(fen);
  try {
    c.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), ...(uci.length > 4 ? { promotion: uci[4] } : {}) });
    return true;
  } catch {
    return false;
  }
};

describe("FX weakness/examples.json: the example position of a bank mistake", () => {
  it("holds 10 real mistakes of both colours, each with its setup move", () => {
    assert.equal(examples.length, 10);
    assert.deepEqual(new Set(examples.map((e) => e.color)), new Set(["w", "b"]));
    for (const e of examples) {
      assert.match(e.setupUci, /^[a-h][1-8][a-h][1-8][qrbn]?$/, e.id);
      assert.notEqual(new Chess(e.fen).turn(), e.color, `${e.id}: the stored FEN has the opponent to move (the setup comes first)`);
    }
  });

  it("exampleFen applies the setup: the expected FEN, legal, the member to move; the played and best moves are legal there", () => {
    for (const e of examples) {
      const fen = exampleFen(e.fen, e.setupUci);
      assert.equal(fen, e.expectedFen, e.id);
      const c = new Chess(fen!);
      assert.equal(c.turn(), e.color, `${e.id}: the member to move`);
      assert.equal(c.isGameOver(), false, e.id);
      assert.ok(legal(fen!, e.played), `${e.id}: the played move ${e.played}`);
      if (e.best) assert.ok(legal(fen!, e.best), `${e.id}: the best move ${e.best}`);
    }
  });

  it("toExamples orients each board to the member's colour and keeps the mistake ref; a broken setup gives no board", () => {
    const rows = examples.map((e, i) => ({ pattern: `p${i}`, ref: e.id, fen: e.fen, setupUci: e.setupUci, color: e.color }));
    const out = toExamples(rows);
    assert.equal(out.size, examples.length);
    examples.forEach((e, i) => assert.deepEqual(out.get(`p${i}`), { fen: e.expectedFen, orient: e.color, mistakeRef: e.id }));
    const broken = toExamples([{ pattern: "x", ref: "r", fen: examples[0]!.fen, setupUci: "a1a8", color: examples[0]!.color }]);
    assert.equal(broken.size, 0, "an illegal setup move never shows a wrong board");
  });
});
