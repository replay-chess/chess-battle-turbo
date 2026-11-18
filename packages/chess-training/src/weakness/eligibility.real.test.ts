// The eligibility test on REAL band sides (FIX-2, docs/decisions.md D-P6-FIX2-1; review round 2 "fp.mts" and
// "cap2.mts"). Members are made of real J5 sides of the cells the 1600 band reads (FX band-sides-1600-blitz.json:
// Lichess CC0 games graded with the pinned Stockfish 18), compared with the committed v1 baseline:
//   - a member exactly at the band's level gets a `vs_band` list rarely (the plan's ratio ≥ 1.5 OR z ≥ 2 over ~30
//     themes did for 58–77 % of them: "you lose most points to pawn endgames" told to a band-average player);
//   - a member with a real excess made of real games (the theme's games 2–4× as frequent) is found, clustered endgame
//     themes included (capping only the member's count rejected a rook-endgame excess the band itself shows).
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { loadBaseline } from "../../baselines/load";
import { bandSides, member, rng } from "../../test/band-sides";
import { aggregate, type AnalysedGame } from "./aggregate";
import { bandMix, bandOf } from "./band";
import { rankPatterns } from "./patterns";

const v1 = loadBaseline("v1");
const rank = (games: AnalysedGame[]) =>
  rankPatterns(aggregate(games), bandMix(bandOf(1600, "lichess"), v1, games.map((x) => ({ g: x.g, moves: x.d.stats.moves })), ["BLITZ"]));

describe("eligibility on real band sides (v1, band 1500–1700, blitz)", () => {
  it("the fixture is the band's own players", () => {
    const sides = bandSides();
    assert.equal(sides.length, 1017);
    assert.ok(sides.every((s) => s.elo >= 1550 && s.elo < 1650 && (s.key === "1500:BLITZ" || s.key === "1600:BLITZ")));
  });

  for (const n of [50, 150, 300]) {
    it(`regression: weakness-false-positives — band-average members of ${n} games rarely get a vs_band list (≤ 8 %)`, () => {
      const next = rng(20261118 + n);
      const runs = 200;
      let flagged = 0;
      for (let m = 0; m < runs; m++) if (rank(member(next, n)).listMode === "vs_band") flagged++;
      // Measured 1–4 % (300 members); the plan's rule flagged 58–77 %. Bonferroni at 10 % bounds it near 10 %.
      assert.ok(flagged / runs <= 0.08, `${flagged} of ${runs} band-average members flagged`);
    });
  }

  it("a real excess is found: the fork games twice as frequent (≈ 1.6× the rate) at 300 games, most of the time", () => {
    const next = rng(7);
    let found = 0;
    for (let m = 0; m < 100; m++) if (rank(member(next, 300, { boost: { theme: "fork", weight: 2 } })).rows.some((r) => r.pattern === "fork")) found++;
    assert.ok(found >= 60, `fork found for ${found} of 100`);
  });

  it("a strong excess is found almost always: the fork games 4× as frequent at 150 games", () => {
    const next = rng(8);
    let found = 0;
    for (let m = 0; m < 100; m++) if (rank(member(next, 150, { boost: { theme: "fork", weight: 4 } })).rows.some((r) => r.pattern === "fork")) found++;
    assert.ok(found >= 90, `fork found for ${found} of 100`);
  });

  it("regression: cap-one-side — a clustered endgame excess is found against the band capped the same way", () => {
    // Rook endgames cluster (capped/raw ≈ 0.65 in the band): with only the member capped, a member at 2× the band's
    // rook-endgame games read ≈ 1.2× and was rejected.
    const next = rng(9);
    let found = 0;
    for (let m = 0; m < 100; m++) if (rank(member(next, 250, { boost: { theme: "rookEndgame", weight: 3 } })).rows.some((r) => r.pattern === "rookEndgame")) found++;
    assert.ok(found >= 60, `rookEndgame found for ${found} of 100`);
    const row = rank(member(rng(10), 250, { boost: { theme: "rookEndgame", weight: 3 } })).rows.find((r) => r.pattern === "rookEndgame");
    if (row) assert.ok(row.ratio! >= 1.25 && row.ratio! < 6, String(row.ratio));
  });
});
