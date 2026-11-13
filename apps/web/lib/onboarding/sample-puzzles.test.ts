// The onboarding boards use the fixture FENs (packages/chess-fixtures/design/onboarding.json, phase-04 plan §12.5).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { describe, it } from "node:test";
import { RATING_BANDS } from "@repo/contracts/http/p04-plain";
import { LEGEND_POSITION, SAMPLE_PUZZLES, samplePuzzleFor } from "./sample-puzzles";

const require = createRequire(import.meta.url);
const fixture = JSON.parse(readFileSync(require.resolve("@repo/chess-fixtures/design/onboarding.json"), "utf8")) as {
  lines: Record<string, { startFen: string }>;
};

describe("sample puzzles", () => {
  it("every band but New to chess has the fixture's FEN", () => {
    for (const wire of RATING_BANDS) {
      const band = wire.toUpperCase() as Uppercase<typeof wire>;
      if (band === "NEW_TO_CHESS") {
        assert.equal(samplePuzzleFor(band), null);
        continue;
      }
      assert.equal(SAMPLE_PUZZLES[band].fen, fixture.lines[`PUZZLE_${band}`]?.startFen, band);
      assert.equal(samplePuzzleFor(band)?.fen, SAMPLE_PUZZLES[band].fen);
    }
  });

  it("regression: sample-puzzles-lichess-cc0 (FIX-1): the other bands are Lichess puzzles whose rating sits in the band, solver to move", () => {
    const bounds = { UNDER_800: [0, 800], R1200_1600: [1200, 1600], R1600_2000: [1600, 2000], R2000_PLUS: [2000, 3500] } as const;
    for (const [band, [lo, hi]] of Object.entries(bounds) as [keyof typeof bounds, readonly [number, number]][]) {
      const p = SAMPLE_PUZZLES[band];
      assert.match(p.lichessId ?? "", /^[A-Za-z0-9]{5}$/, band);
      assert.ok(p.rating >= lo && p.rating < hi, `${band}: ${p.rating}`);
      const turn = p.fen.split(" ")[1] === "w" ? "White" : "Black";
      assert.equal(p.label, `Sample puzzle around ${p.rating}. ${turn} to move.`);
    }
    assert.equal(SAMPLE_PUZZLES.R800_1200.lichessId, null, "the design board's own position");
  });

  it("no band picked yet → the 800–1200 board of V3OnbRating", () => {
    assert.equal(samplePuzzleFor(null)?.fen, fixture.lines.PUZZLE_R800_1200?.startFen);
  });

  it("the legend position is the KT fixture line", () => {
    assert.equal(LEGEND_POSITION.fen, fixture.lines.KT?.startFen);
  });
});
