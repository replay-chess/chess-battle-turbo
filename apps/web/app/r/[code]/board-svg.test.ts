// The share page's board markup (FIX-2): the same geometry as the share image (lib/og/theme.ts), and a function the
// island can run from its source text alone (html.ts inlines `shareBoardSvg.toString()`).
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ALL_SQUARES, arrowPolygon, isDarkSquare, placementPieces, squareOrigin } from "@/lib/og/theme";
import { shareBoardSvg, type BoardFrame } from "./board-svg";

const START: BoardFrame = { p: "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR", l: ["e2", "e4"], q: "blunder", c: null };

function rects(svg: string): { x: number; y: number; fill: string }[] {
  return [...svg.matchAll(/<rect x="(\d+)" y="(\d+)" width="100" height="100" style="fill:var\(--article-board-(\w+)\)"\/>/g)].map((m) => ({
    x: Number(m[1]),
    y: Number(m[2]),
    fill: m[3]!,
  }));
}

describe("shareBoardSvg", () => {
  for (const orientation of ["w", "b"] as const) {
    it(`squares, pieces and the arrow sit where the share image puts them (${orientation} at the bottom)`, () => {
      const svg = shareBoardSvg(START, orientation, ["g1", "f3"], "Position after 1.e4.");
      const squares = rects(svg).slice(0, 64);
      assert.equal(squares.length, 64);
      for (const sq of ALL_SQUARES) {
        const o = squareOrigin(sq, orientation);
        const r = squares.find((x) => x.x === o.col * 100 && x.y === o.row * 100)!;
        assert.equal(r.fill, isDarkSquare(sq) ? "dark" : "light", sq);
      }
      const images = [...svg.matchAll(/<image href="\/chess-icons\/(\w\w)\.png" x="([\d.]+)" y="([\d.]+)"/g)];
      const pieces = placementPieces(START.p);
      assert.equal(images.length, pieces.size);
      for (const [sq, piece] of pieces) {
        const o = squareOrigin(sq, orientation);
        assert.ok(images.some((m) => m[1] === piece && Number(m[2]) === o.col * 100 + 5 && Number(m[3]) === o.row * 100 + 5), `${piece} on ${sq}`);
      }
      assert.ok(svg.includes(`points="${arrowPolygon("g1", "f3", orientation, 800)}"`), "the image's arrow polygon");
      assert.match(svg, /<rect x="\d+" y="\d+" width="100" height="100" style="fill:var\(--article-board-last\)"\/>/);
      assert.match(svg, /data-testid="share-badge" data-q="blunder"/);
    });
  }

  it("escapes the label, draws the check ring and the Interesting disc", () => {
    const svg = shareBoardSvg({ ...START, q: "interesting", c: "e8" }, "w", null, `a "quoted" <label>`);
    assert.match(svg, /aria-label="a &quot;quoted&quot; &lt;label&gt;"/);
    assert.match(svg, /<circle cx="450" cy="50" r="46"/);
    assert.match(svg, /style="fill:var\(--mq-interesting\)"/);
    assert.doesNotMatch(svg, /data-testid="share-arrow"/);
  });

  it("runs from its source text alone (the island's copy)", () => {
    // tsx (esbuild, keepNames) wraps inner functions in `__name(fn, "name")`; Next's SWC build does not, so the shim
    // stands in for esbuild's helper here only.
    const copy = new Function("__name", `return (${shareBoardSvg.toString()});`)((f: unknown) => f) as typeof shareBoardSvg;
    assert.equal(copy(START, "b", ["d2", "d4"], "x"), shareBoardSvg(START, "b", ["d2", "d4"], "x"));
  });
});
