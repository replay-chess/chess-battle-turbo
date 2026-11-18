// The trend chip on REAL band sides (FIX-2, docs/decisions.md D-P6-FIX2-3; review round 2 "tr.mts"). A member whose
// rate never changes (150 real J5 sides of one band, dated evenly over the last 90 days) must read "About the same"
// nearly always, with no lean to "Getting worse"; the plan's Δ ≥ ±20 % on ≥ 100 moves gave 34–66 % directional labels
// and "worse" 3.6× as often as "better" (pin). A real change (the recent month's fork games 4× as frequent) reads worse.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { loadBaseline } from "../../baselines/load";
import { member, rng } from "../../test/band-sides";
import { bandMix, bandOf } from "./band";
import { trendOf, trendWindows } from "./trend";

const NOW = new Date("2026-11-18T12:00:00.000Z");
const DAY = 86_400_000;
const v1 = loadBaseline("v1");

describe("trend on real band sides (v1, band 1500–1700, blitz)", () => {
  for (const theme of ["fork", "pin", "rc:missedThreat", "kingsideAttack"]) {
    it(`regression: trend-noise — a constant ${theme} rate reads "same" for ≥ 90 % of members, without a lean`, () => {
      const next = rng(4242);
      const t: Record<string, number> = { same: 0, worse: 0, better: 0, unknown: 0 };
      for (let m = 0; m < 200; m++) {
        const games = member(next, 150, { endedAt: () => new Date(NOW.getTime() - next() * 90 * DAY) });
        const mix = bandMix(bandOf(1600, "lichess"), v1, games.map((x) => ({ g: x.g, moves: x.d.stats.moves })), ["BLITZ"]);
        t[trendOf(trendWindows(games, NOW), theme, mix).trend]! += 1;
      }
      assert.ok(t.same! >= 180, JSON.stringify(t));
      assert.ok(Math.abs(t.worse! - t.better!) <= 10, `no lean: ${JSON.stringify(t)}`);
    });
  }

  it("a real change reads worse: the recent month's fork games 4× as frequent, the prior two months like the band", () => {
    const next = rng(77);
    let worse = 0;
    for (let m = 0; m < 100; m++) {
      const recent = member(next, 60, { boost: { theme: "fork", weight: 4 }, endedAt: () => new Date(NOW.getTime() - next() * 29 * DAY) });
      const prior = member(next, 90, { endedAt: () => new Date(NOW.getTime() - (31 + next() * 58) * DAY) }).map((x, i) => ({ ...x, g: { ...x.g, gameId: `p${i}` } }));
      if (trendOf(trendWindows([...recent, ...prior], NOW), "fork").trend === "worse") worse++;
    }
    assert.ok(worse >= 50, `worse for ${worse} of 100`);
  });

  it("fewer than 300 moves in a window is unknown (≈ 10 games; the plan's 100 moves was ≈ 3)", () => {
    const next = rng(5);
    const games = member(next, 12, { endedAt: (i) => new Date(NOW.getTime() - (i < 6 ? 5 : 45) * DAY) });
    assert.equal(trendOf(trendWindows(games, NOW), "fork").trend, "unknown");
  });
});
