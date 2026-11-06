import assert from "node:assert/strict";
import { test } from "node:test";
import { Chess } from "chess.js";
import { detectEnd } from "../src/rules/end";
import { replay, sanToUci } from "../src/rules/chess";
import { INITIAL_FEN } from "../src/constants";

const after = (fen: string, sans: string[]) => {
  const c = new Chess(fen);
  for (const s of sans) c.move(s);
  return c;
};

test("checkmate wins for the mover", () => {
  assert.deepEqual(detectEnd(after(INITIAL_FEN, ["f3", "e5", "g4", "Qh4#"])), { method: "checkmate", winner: "b" });
});

test("order: checkmate beats a fifty-move count; stalemate beats insufficient", () => {
  // Mate delivered on the 100th half-move: checkmate, not fifty_move.
  const mate = after("7k/8/6K1/8/8/8/8/R7 w - - 99 120", ["Ra8#"]);
  assert.ok(mate.isDrawByFiftyMoves());
  assert.deepEqual(detectEnd(mate), { method: "checkmate", winner: "w" });
  // Stalemate with insufficient material (K+N vs K, stalemated): stalemate wins.
  const stale = new Chess("k7/2K5/2N5/8/8/8/8/8 b - - 0 1");
  assert.ok(stale.isStalemate() && stale.isInsufficientMaterial());
  assert.deepEqual(detectEnd(stale), { method: "stalemate", winner: null });
});

test("insufficient beats threefold and fifty", () => {
  const c = new Chess("8/8/4k3/8/8/4K3/8/8 w - - 100 80");
  assert.ok(c.isDrawByFiftyMoves());
  assert.deepEqual(detectEnd(c), { method: "insufficient_material", winner: null });
});

test("threefold by transposition", () => {
  const sans = "Nf3 Nf6 Nc3 Nc6 Nb1 Nb8 Ng1 Ng8 Nc3 Nc6 Nf3 Nf6 Ng1 Ng8 Nb1 Nb8".split(" ");
  const c = after(INITIAL_FEN, sans.slice(0, -1));
  assert.equal(detectEnd(c), null);
  c.move(sans.at(-1)!);
  assert.deepEqual(detectEnd(c), { method: "threefold", winner: null });
});

test("threefold survives a replay restore, but not loading the last FEN (socket §10 bug)", () => {
  const sans = "Nf3 Nf6 Ng1 Ng8 Nf3 Nf6 Ng1 Ng8".split(" ");
  const uci = sanToUci(INITIAL_FEN, sans);
  const r = replay(INITIAL_FEN, uci);
  assert.ok(r.ok);
  if (!r.ok) return;
  assert.equal(detectEnd(r.chess)?.method, "threefold");
  assert.equal(detectEnd(new Chess(r.chess.fen())), null);
});

test("fifty-move at halfmove 100 exactly", () => {
  const c = new Chess("8/8/4k3/8/8/4K3/8/R6r w - - 98 120");
  c.move("Ra7");
  assert.equal(detectEnd(c), null);
  c.move("Rh2");
  assert.deepEqual(detectEnd(c), { method: "fifty_move", winner: null });
});

test("insufficient table", () => {
  const cases: [string, boolean][] = [
    ["8/8/4k3/8/8/4K3/8/8 w - - 0 1", true], // K–K
    ["8/8/4k3/8/8/4K3/8/5B2 w - - 0 1", true], // KB–K
    ["8/8/4k3/8/8/4K3/8/5N2 w - - 0 1", true], // KN–K
    ["8/8/2b1k3/8/8/4K3/8/5B2 w - - 0 1", true], // KB–KB same colour (c6 and f1 are light)
    ["8/8/3bk3/8/8/4K3/8/5B2 w - - 0 1", false], // opposite colours (d6 dark)
    ["8/8/4k3/8/8/4K3/8/4NN2 w - - 0 1", false], // K+N+N
    ["8/8/4k3/8/8/4K3/4P3/8 w - - 0 1", false], // pawn
  ];
  for (const [fen, insufficient] of cases) {
    assert.equal(detectEnd(new Chess(fen))?.method === "insufficient_material", insufficient, fen);
  }
});
