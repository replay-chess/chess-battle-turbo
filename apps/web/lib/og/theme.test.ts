import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ALL_SQUARES,
  arrowPolygon,
  genericCardInput,
  genericTitleSize,
  isDarkSquare,
  OG_HEIGHT,
  OG_WIDTH,
  placementPieces,
  publicAsset,
  SHARE_FALLBACK_CARD,
  squareCentre,
  squareOrigin,
} from "./theme";
import { SHARE_IMAGE_HEIGHT, SHARE_IMAGE_WIDTH } from "@repo/contracts/http/share";

describe("og theme", () => {
  it("is the 1200×630 card the share contract names", () => {
    assert.equal(OG_WIDTH, SHARE_IMAGE_WIDTH);
    assert.equal(OG_HEIGHT, SHARE_IMAGE_HEIGHT);
  });

  it("keeps the P0 /og inputs: caps, the type label, the default title", () => {
    assert.deepEqual(genericCardInput({}), { title: "ReplayChess", subtitle: "", label: "", icon: "♟" });
    const legend = genericCardInput({ title: "Paul Morphy", subtitle: "x".repeat(400), type: "legend" });
    assert.equal(legend.label, "Chess Legend");
    assert.equal(legend.icon, "♚");
    assert.equal(legend.subtitle.length, 300);
    assert.equal(genericCardInput({ title: "t".repeat(250) }).title.length, 200);
    assert.equal(genericCardInput({ type: "nope" }).label, "");
    assert.equal(genericTitleSize("short"), 64);
    assert.equal(genericTitleSize("x".repeat(41)), 48);
  });

  it("the share fallback names nobody", () => {
    assert.equal(SHARE_FALLBACK_CARD.title, "ReplayChess");
    assert.equal(SHARE_FALLBACK_CARD.label, "");
  });

  it("square geometry for both orientations", () => {
    assert.deepEqual(squareOrigin("a1", "w"), { col: 0, row: 7 });
    assert.deepEqual(squareOrigin("h8", "w"), { col: 7, row: 0 });
    assert.deepEqual(squareOrigin("a1", "b"), { col: 7, row: 0 });
    assert.deepEqual(squareOrigin("e4", "b"), { col: 3, row: 3 });
    assert.equal(isDarkSquare("a1"), true);
    assert.equal(isDarkSquare("h1"), false);
    assert.equal(isDarkSquare("d5"), false);
    assert.equal(ALL_SQUARES.length, 64);
    assert.equal(ALL_SQUARES[0], "a8");
    assert.equal(ALL_SQUARES[63], "h1");
    assert.deepEqual(squareCentre("a8", "w", 800), { x: 50, y: 50 });
  });

  it("reads a FEN placement into /chess-icons names", () => {
    const p = placementPieces("rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1");
    assert.equal(p.size, 32);
    assert.equal(p.get("e1"), "wk");
    assert.equal(p.get("d8"), "bq");
    assert.equal(p.get("e4"), "wp");
    assert.equal(p.get("e2"), undefined);
    assert.equal(placementPieces("not a fen").size, 0);
  });

  it("draws an arrow polygon of 7 points ending short of the target", () => {
    const pts = arrowPolygon("e2", "e4", "w", 800).split(" ");
    assert.equal(pts.length, 7);
    const tip = pts[3]!.split(",").map(Number);
    const target = squareCentre("e4", "w", 800);
    assert.ok(tip[1]! > target.y, "the tip stops before the centre of e4 (moving up the board)");
    assert.equal(tip[0], target.x);
  });

  it("makes absolute asset URLs", () => {
    assert.equal(publicAsset("https://x.test/", "/chess-icons/wk.png"), "https://x.test/chess-icons/wk.png");
    assert.equal(publicAsset("http://localhost:3000", "board_icons/svg/best.svg"), "http://localhost:3000/board_icons/svg/best.svg");
  });
});
