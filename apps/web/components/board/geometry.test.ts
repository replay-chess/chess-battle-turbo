import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { arrowGeometry } from "./ArrowLayer";
import { badgeIcon, badgePosition } from "./BadgeLayer";
import {
  diffPieces,
  displayPos,
  displayRows,
  isDarkSquare,
  isPromotionMove,
  parsePlacement,
  parseUci,
  placedPieces,
  squareAtPoint,
  squarePct,
  stepSquare,
  SQUARES,
} from "./geometry";
import { highlightFill } from "./OverlayLayer";

const START = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

describe("squares and orientation", () => {
  it("lists 64 squares in FEN order", () => {
    assert.equal(SQUARES.length, 64);
    assert.equal(SQUARES[0], "a8");
    assert.equal(SQUARES[63], "h1");
  });

  it("colours a1 dark and h1 light", () => {
    assert.equal(isDarkSquare("a1"), true);
    assert.equal(isDarkSquare("h1"), false);
    assert.equal(isDarkSquare("e4"), false);
    assert.equal(isDarkSquare("d4"), true);
  });

  it("maps squares to display positions for White", () => {
    assert.deepEqual(displayPos("a8", "w"), { col: 0, row: 0 });
    assert.deepEqual(displayPos("h1", "w"), { col: 7, row: 7 });
    assert.deepEqual(displayPos("e4", "w"), { col: 4, row: 4 });
  });

  it("maps squares to display positions for Black", () => {
    assert.deepEqual(displayPos("h1", "b"), { col: 0, row: 0 });
    assert.deepEqual(displayPos("a8", "b"), { col: 7, row: 7 });
    assert.deepEqual(displayPos("e4", "b"), { col: 3, row: 3 });
  });

  it("converts squares to % positions in both orientations", () => {
    assert.deepEqual(squarePct("a1", "w"), { left: 0, top: 87.5 });
    assert.deepEqual(squarePct("a1", "b"), { left: 87.5, top: 0 });
    assert.deepEqual(squarePct("e4", "w"), { left: 50, top: 50 });
    assert.deepEqual(squarePct("e4", "b"), { left: 37.5, top: 37.5 });
  });

  it("round-trips every square through a point in both orientations", () => {
    for (const o of ["w", "b"] as const) {
      for (const sq of SQUARES) {
        const { left, top } = squarePct(sq, o);
        assert.equal(squareAtPoint((left + 6.25) / 100, (top + 6.25) / 100, o), sq, `${sq} ${o}`);
      }
    }
  });

  it("returns null for points outside the board", () => {
    assert.equal(squareAtPoint(-0.01, 0.5, "w"), null);
    assert.equal(squareAtPoint(0.5, 1, "w"), null);
    assert.equal(squareAtPoint(Number.NaN, 0.5, "w"), null);
  });

  it("renders rows top to bottom from the player's side", () => {
    const w = displayRows("w");
    assert.equal(w[0]![0], "a8");
    assert.equal(w[7]![7], "h1");
    const b = displayRows("b");
    assert.equal(b[0]![0], "h1");
    assert.equal(b[7]![7], "a8");
  });

  it("steps the keyboard focus along the visual grid", () => {
    assert.equal(stepSquare("e2", "ArrowUp", "w"), "e3");
    assert.equal(stepSquare("e2", "ArrowUp", "b"), "e1");
    assert.equal(stepSquare("e2", "ArrowRight", "w"), "f2");
    assert.equal(stepSquare("e2", "ArrowRight", "b"), "d2");
    assert.equal(stepSquare("a8", "ArrowUp", "w"), "a8", "stops at the edge");
  });
});

describe("FEN placement", () => {
  it("reads the start position", () => {
    const p = parsePlacement(START);
    assert.equal(p.size, 32);
    assert.equal(p.get("e1"), "wk");
    assert.equal(p.get("d8"), "bq");
    assert.equal(p.get("e4"), undefined);
  });

  it("tolerates malformed input", () => {
    assert.equal(parsePlacement("").size, 0);
    assert.equal(parsePlacement("8/8/8/8/8/8/8/8 w - - 0 1").size, 0);
    assert.equal(parsePlacement("x7/8/8/8/8/8/8/K7").get("a1"), "wk");
  });

  it("detects promotion moves", () => {
    const p = parsePlacement("8/1P3k2/8/8/8/8/5p2/4K3 w - - 0 1");
    assert.equal(isPromotionMove(p, "b7", "b8"), true);
    assert.equal(isPromotionMove(p, "f2", "f1"), true);
    assert.equal(isPromotionMove(p, "e1", "e2"), false);
    assert.equal(isPromotionMove(p, "f7", "f8"), false);
  });

  it("parses UCI text", () => {
    assert.deepEqual(parseUci("e2e4"), { from: "e2", to: "e4" });
    assert.deepEqual(parseUci("B7-B8N"), { from: "b7", to: "b8", promotion: "n" });
    assert.equal(parseUci("Nf3"), null);
  });
});

describe("diffPieces", () => {
  const ids = (fen: string) => placedPieces(fen);

  it("keeps ids and slides the moved piece", () => {
    const next = "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1";
    const d = diffPieces(ids(START), next, { from: "e2", to: "e4" });
    const pawn = d.pieces.find((p) => p.sq === "e4")!;
    assert.equal(pawn.id, "wp@e2");
    assert.equal(pawn.from, "e2");
    assert.equal(d.pieces.filter((p) => p.from).length, 1, "only one piece moves");
    assert.equal(d.removed.length, 0);
    assert.equal(d.pieces.find((p) => p.sq === "e1")!.id, "wk@e1");
  });

  it("accepts a FEN for the previous position", () => {
    const next = "rnbqkbnr/pppppppp/8/8/8/5N2/PPPPPPPP/RNBQKB1R b KQkq - 1 1";
    const d = diffPieces(START, next);
    const knight = d.pieces.find((p) => p.sq === "f3")!;
    assert.equal(knight.id, "wn@g1");
    assert.equal(knight.from, "g1");
  });

  it("removes a captured piece", () => {
    const before = "4k3/8/8/3p4/4P3/8/8/4K3 w - - 0 1";
    const after = "4k3/8/8/3P4/8/8/8/4K3 b - - 0 1";
    const d = diffPieces(ids(before), after, { from: "e4", to: "d5" });
    const pawn = d.pieces.find((p) => p.sq === "d5")!;
    assert.equal(pawn.id, "wp@e4");
    assert.equal(pawn.from, "e4");
    assert.deepEqual(
      d.removed.map((p) => [p.id, p.sq]),
      [["bp@d5", "d5"]],
    );
  });

  it("moves the rook when castling", () => {
    const before = "r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1";
    const after = "r3k2r/8/8/8/8/8/8/R4RK1 b kq - 1 1";
    const d = diffPieces(ids(before), after, { from: "e1", to: "g1" });
    const king = d.pieces.find((p) => p.sq === "g1")!;
    const rook = d.pieces.find((p) => p.sq === "f1")!;
    assert.equal(king.id, "wk@e1");
    assert.equal(king.from, "e1");
    assert.equal(rook.id, "wr@h1", "the h-rook, not the a-rook");
    assert.equal(rook.from, "h1");
    assert.equal(d.pieces.find((p) => p.sq === "a1")!.from, undefined);
    assert.equal(d.removed.length, 0);
  });

  it("castles long on the queen side", () => {
    const before = "r3k2r/8/8/8/8/8/8/R3K2R b KQkq - 0 1";
    const after = "2kr3r/8/8/8/8/8/8/R3K2R w KQ - 1 2";
    const d = diffPieces(ids(before), after, { from: "e8", to: "c8" });
    assert.equal(d.pieces.find((p) => p.sq === "d8")!.id, "br@a8");
    assert.equal(d.pieces.find((p) => p.sq === "h8")!.from, undefined);
  });

  it("removes the en passant pawn from its own square", () => {
    const before = "4k3/8/8/3Pp3/8/8/8/4K3 w - e6 0 2";
    const after = "4k3/8/4P3/8/8/8/8/4K3 b - - 0 2";
    const d = diffPieces(ids(before), after, { from: "d5", to: "e6" });
    const pawn = d.pieces.find((p) => p.sq === "e6")!;
    assert.equal(pawn.id, "wp@d5");
    assert.equal(pawn.from, "d5");
    assert.deepEqual(
      d.removed.map((p) => p.sq),
      ["e5"],
    );
  });

  it("swaps the piece at the end of a promotion slide", () => {
    const before = "8/1P3k2/8/8/8/8/8/4K3 w - - 0 1";
    const after = "1N6/5k2/8/8/8/8/8/4K3 b - - 0 1";
    const d = diffPieces(ids(before), after, { from: "b7", to: "b8" });
    const n = d.pieces.find((p) => p.sq === "b8")!;
    assert.equal(n.id, "wp@b7");
    assert.equal(n.piece, "wn");
    assert.equal(n.from, "b7");
    assert.equal(n.fromPiece, "wp");
    assert.equal(d.removed.length, 0);
  });

  it("finds an unhinted capture-promotion", () => {
    const before = "r7/1P3k2/8/8/8/8/8/4K3 w - - 0 1";
    const after = "Q7/5k2/8/8/8/8/8/4K3 b - - 0 1";
    const d = diffPieces(ids(before), after);
    const q = d.pieces.find((p) => p.sq === "a8")!;
    assert.equal(q.fromPiece, "wp");
    assert.equal(q.from, "b7");
    assert.deepEqual(
      d.removed.map((p) => p.id),
      ["br@a8"],
    );
  });

  it("gives new pieces unique ids and no slide", () => {
    const d = diffPieces(ids("4k3/8/8/8/8/8/8/4K3 w - - 0 1"), "4k3/8/8/8/8/8/8/R3K3 w - - 0 1", null, 7);
    const r = d.pieces.find((p) => p.sq === "a1")!;
    assert.equal(r.id, "wr@a1#7");
    assert.equal(r.from, undefined);
  });

  it("goes back one ply with a stale move hint", () => {
    const after = "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1";
    const fwd = diffPieces(ids(START), after, { from: "e2", to: "e4" });
    const back = diffPieces(fwd.pieces, START, { from: "e2", to: "e4" });
    const pawn = back.pieces.find((p) => p.sq === "e2")!;
    assert.equal(pawn.id, "wp@e2");
    assert.equal(pawn.from, "e4");
  });

  it("keeps every id unique", () => {
    const d = diffPieces(ids(START), "r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3");
    assert.equal(new Set(d.pieces.map((p) => p.id)).size, d.pieces.length);
  });
});

describe("arrows, badges, highlights", () => {
  it("draws knight arrows as an L along the long leg first", () => {
    const g = arrowGeometry("g1", "f3", "w");
    assert.equal(g.knight, true);
    assert.match(g.d, /^M \S+ \S+ L 650 550 L /);
    const straight = arrowGeometry("e2", "e4", "w");
    assert.equal(straight.knight, false);
    assert.equal(straight.d.split("L").length, 2);
  });

  it("flips arrow coordinates with the orientation", () => {
    const w = arrowGeometry("e2", "e4", "w");
    const b = arrowGeometry("e2", "e4", "b");
    assert.notEqual(w.d, b.d);
    assert.match(w.d, /^M 450 /);
    assert.match(b.d, /^M 350 /);
  });

  it("places badges at the top-right corner, clamped inside the board", () => {
    assert.deepEqual(badgePosition("e4", "w"), { left: 59.375, top: 48.875 });
    assert.deepEqual(badgePosition("h8", "w"), { left: 95.75, top: 0 });
    assert.deepEqual(badgePosition("a1", "b"), { left: 95.75, top: 0 }, "relative to the orientation");
  });

  it("uses the owner's icons, by king colour for end-of-game marks", () => {
    const p = parsePlacement("4k3/8/8/8/8/8/8/4K3 w - - 0 1");
    assert.equal(badgeIcon("brilliant", "e1", p), "/board_icons/svg/brilliant.svg");
    assert.equal(badgeIcon("miss", "e1", p), "/board_icons/svg/missed_win.svg");
    assert.equal(badgeIcon("mate", "e8", p), "/board_icons/svg/checkmate_black.svg");
    assert.equal(badgeIcon("flag", "e1", p), "/board_icons/svg/resign_white.svg");
    assert.equal(badgeIcon("draw", "e8", p), "/board_icons/svg/draw_black.svg");
    assert.equal(badgeIcon("win", "e1", p), "/board_icons/svg/winner.svg");
    assert.equal(badgeIcon("interesting", "e1", p), null);
  });

  it("resolves highlight values", () => {
    assert.equal(highlightFill("green"), "linear-gradient(var(--highlight-green), var(--highlight-green))");
    assert.equal(highlightFill("highlight-red"), "linear-gradient(var(--highlight-red), var(--highlight-red))");
    assert.equal(highlightFill("rgba(1, 2, 3, 0.5)"), "linear-gradient(rgba(1, 2, 3, 0.5), rgba(1, 2, 3, 0.5))");
    const g = "radial-gradient(circle, red 0, transparent 70%)";
    assert.equal(highlightFill(g), g);
  });
});
