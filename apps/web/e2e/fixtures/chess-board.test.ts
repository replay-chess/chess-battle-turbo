import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Chess } from "chess.js";
import { fenFromBoard, legalMovesFromBoard } from "./chess-board";

const NAMES: Record<string, string> = { p: "pawn", n: "knight", b: "bishop", r: "rook", q: "queen", k: "king" };

/** The board's pieces as the DOM shows them (v3 alt text, or the legacy board's "White n"). */
function piecesOf(fen: string, style: "v3" | "legacy" = "v3") {
  const chess = new Chess(fen);
  const out: { square: string; alt: string }[] = [];
  for (const row of chess.board()) {
    for (const c of row) {
      if (!c) continue;
      const color = c.color === "w" ? "White" : "Black";
      out.push({ square: c.square, alt: `${color} ${style === "v3" ? NAMES[c.type] : c.type}` });
    }
  }
  return out;
}

// The Immortal Game position of the first design legend (Anderssen), after 1.Nxc7+ as friend-full played it in CI.
const IMMORTAL_AFTER_NC7 = "rnb1k1nr/p1Np1ppp/8/1pb2N1P/4PBP1/3P1Q2/PqP5/R4KR1 b kq - 1 1";

describe("fenFromBoard", () => {
  it("rebuilds the placement from either board's alt text", () => {
    for (const style of ["v3", "legacy"] as const) {
      assert.equal(fenFromBoard(piecesOf(IMMORTAL_AFTER_NC7, style), "b"), "rnb1k1nr/p1Np1ppp/8/1pb2N1P/4PBP1/3P1Q2/PqP5/R4KR1 b - - 0 1");
    }
  });

  it("is null for an unknown piece name", () => {
    assert.equal(fenFromBoard([{ square: "e1", alt: "White wizard" }], "w"), null);
  });
});

describe("legalMovesFromBoard", () => {
  it("in check, only the king's escapes (the case the piece-by-piece search ran out of time on)", () => {
    const moves = legalMovesFromBoard(piecesOf(IMMORTAL_AFTER_NC7), "b");
    assert.ok(moves.length > 0);
    for (const [from] of moves) assert.equal(from, "e8");
  });

  it("puts moves that end the game last", () => {
    // White to move: Ra1-a8 is a back-rank mate; every other move is quiet.
    const fen = "6k1/5ppp/8/8/8/8/8/R5K1 w - - 0 1";
    const moves = legalMovesFromBoard(piecesOf(fen), "w");
    const first = new Chess(fen);
    first.move({ from: moves[0]![0], to: moves[0]![1] });
    assert.equal(first.isGameOver(), false);
    assert.deepEqual(moves.at(-1), ["a1", "a8"]);
  });

  it("is empty when there is no position to read", () => {
    assert.deepEqual(legalMovesFromBoard([], "w"), []);
  });
});
