// The rating band (phase-06 plan §8.4, §12.1): 1184 → 1100–1300 (cells 1100 and 1200); clamps; the source order
// (Lichess ≥ 10 before Chess.com); unrated REPLAY rows skipped; the onboarding fallback; null → own_only; the
// Chess.com offset; time-class weighting (60 % blitz / 40 % rapid); the calibration mix.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { loadBaseline } from "../../baselines/load";
import type { BaselineV1 } from "../../baselines/schema";
import { gameInput } from "../../test/gen";
import { bandMix, bandOf, bandValue, median, resolveRating } from "./band";
import type { WeaknessGameInput } from "./types";

const baseline = loadBaseline("v0-synthetic");
const DAY = 86_400_000;
const NOW = Date.parse("2026-11-16T10:00:00.000Z");

function rated(n: number, o: Partial<Parameters<typeof gameInput>[0]> & { rating: (i: number) => number }): WeaknessGameInput[] {
  return Array.from({ length: n }, (_, i) => gameInput({ gameId: String(100 + i), color: "w", endedAt: new Date(NOW - i * DAY), ...o, ratingBefore: o.rating(i) }));
}

describe("bandOf", () => {
  it("1184 → centre 1200, 1100–1300, cells 1100 and 1200", () => {
    assert.deepEqual(bandOf(1184, "lichess"), { min: 1100, max: 1300, center: 1200, source: "lichess", rating: 1184, baselineBands: ["1100", "1200"] });
  });
  it("clamps the centre to 700…2400", () => {
    assert.equal(bandOf(650, "onboarding").center, 700);
    assert.deepEqual(bandOf(650, "onboarding").baselineBands, ["600", "700"]);
    assert.equal(bandOf(2480, "lichess").center, 2400);
    assert.deepEqual(bandOf(2480, "lichess").baselineBands, ["2300", "2400"]);
    assert.equal(bandOf(1150, "lichess").center, 1200, "round half up");
    assert.equal(bandOf(1149, "lichess").center, 1100);
  });
  it("median of an even list is the mean of the middle two", () => {
    assert.equal(median([1, 5, 3, 9]), 4);
    assert.equal(median([1180, 1184, 1188]), 1184);
  });
});

describe("resolveRating", () => {
  it("prefers ≥ 10 Lichess games (the median of the newest 20) over Chess.com", () => {
    const lichess = rated(25, { source: "LICHESS", rating: (i) => (i < 20 ? 1180 + (i % 3) * 4 : 2000) });
    const chesscom = rated(15, { source: "CHESSCOM", rating: () => 1500 });
    assert.deepEqual(resolveRating([...lichess, ...chesscom], null, baseline), { rating: 1184, source: "lichess" });
  });
  it("uses Chess.com with ≥ 10 games when Lichess has fewer, plus the offset of the majority time class", () => {
    const g = [...rated(9, { source: "LICHESS", rating: () => 1300 }), ...rated(12, { source: "CHESSCOM", timeClass: "RAPID", rating: () => 1400 })];
    assert.deepEqual(resolveRating(g, null, baseline), { rating: 1400, source: "chesscom" });
    const shifted: BaselineV1 = { ...baseline, ratingOffsets: { CHESSCOM: { BULLET: 0, BLITZ: 0, RAPID: -60 } } };
    assert.deepEqual(resolveRating(g, null, shifted), { rating: 1340, source: "chesscom" });
  });
  it("skips unrated REPLAY rows; rated REPLAY ≥ 10 counts", () => {
    const unrated = rated(15, { source: "REPLAY", mode: "ONLINE", rated: false, rating: () => 1500 });
    assert.equal(resolveRating(unrated, null, baseline), null);
    const ratedReplay = rated(10, { source: "REPLAY", mode: "ONLINE", rated: true, rating: () => 1520 });
    assert.deepEqual(resolveRating(ratedReplay, null, baseline), { rating: 1520, source: "replay" });
  });
  it("falls back to the onboarding band's midpoint, then null (→ own_only)", () => {
    assert.deepEqual(resolveRating([], "R1200_1600", baseline), { rating: 1400, source: "onboarding" });
    assert.deepEqual(resolveRating([], "UNDER_800", baseline), { rating: 700, source: "onboarding" });
    assert.deepEqual(resolveRating([], "R2000_PLUS", baseline), { rating: 2100, source: "onboarding" });
    assert.equal(resolveRating([], null, baseline), null);
  });
});

describe("bandValue", () => {
  const band = bandOf(1184, "lichess");
  const moves = (tc: "BLITZ" | "RAPID" | "BULLET", m: number) => ({ g: gameInput({ gameId: String(m), color: "w", endedAt: new Date(NOW), timeClass: tc }), moves: m });

  it("is the moves-weighted mean of the two cells (the synthetic anchors: fork 1.6, loose piece 1.9)", () => {
    const mix = bandMix(band, baseline, [moves("BLITZ", 100)], ["RAPID", "BLITZ"]);
    assert.ok(Math.abs(bandValue(mix, (c) => c.themes.fork!.per100, "ALL")! - 1.6) < 1e-9);
    assert.ok(Math.abs(bandValue(mix, (c) => c.themes.hangingPiece!.per100, "ALL")! - 1.9) < 1e-9);
  });

  it("weights time classes by the member's move share (60 % blitz / 40 % rapid)", () => {
    const mix = bandMix(band, baseline, [moves("BLITZ", 60), moves("RAPID", 40), moves("BULLET", 0)], ["RAPID", "BLITZ"]);
    assert.deepEqual(mix.weights.map((w) => [w.tc, w.w]), [["BLITZ", 0.6], ["RAPID", 0.4]]);
    const cellMean = (tc: "BLITZ" | "RAPID") => (baseline.bands["1100"]![tc].clockMoves[0] + baseline.bands["1200"]![tc].clockMoves[0]) / 2;
    const expected = 0.6 * cellMean("BLITZ") + 0.4 * cellMean("RAPID");
    assert.ok(Math.abs(bandValue(mix, (c) => c.clockMoves[0], null)! - expected) < 1e-9);
  });

  it("applies the calibration to the share of moves our engine graded: cal = s_e·c + (1 − s_e)", () => {
    const calibrated: BaselineV1 = {
      ...baseline,
      calibration: { ...baseline.calibration, "1100": { MISTAKE: 1, BLUNDER: 1.2, MISS: 1, ALL: 1.5 }, "1200": { MISTAKE: 1, BLUNDER: 1.2, MISS: 1, ALL: 1.5 } },
    };
    const engine = { g: gameInput({ gameId: "1", color: "w", endedAt: new Date(NOW), evalSource: "ENGINE" }), moves: 50 };
    const lichess = { g: gameInput({ gameId: "2", color: "w", endedAt: new Date(NOW), evalSource: "LICHESS" }), moves: 50 };
    const mix = bandMix(band, calibrated, [engine, lichess], ["BLITZ"]);
    assert.equal(mix.engineShare, 0.5);
    assert.ok(Math.abs(bandValue(mix, (c) => c.themes.fork!.per100, "ALL")! - 1.6 * (0.5 * 1.5 + 0.5)) < 1e-9);
    assert.ok(Math.abs(bandValue(mix, (c) => c.timePressure.per100Lt1, "BLUNDER")! - 2.2 * (0.5 * 1.2 + 0.5)) < 1e-9);
    assert.ok(Math.abs(bandValue(mix, (c) => c.phaseAccuracy[0], null)! - 84) < 1e-9, "accuracies are not calibrated");
  });

  it("uses the scope's classes equally when nothing is analysed, and RAPID cells for CLASSICAL games", () => {
    const mix = bandMix(band, baseline, [], ["RAPID", "BLITZ"]);
    assert.deepEqual(mix.weights.map((w) => w.tc).sort(), ["BLITZ", "RAPID"]);
    const classical = bandMix(band, baseline, [moves("BLITZ", 0), { ...moves("BLITZ", 30), g: gameInput({ gameId: "9", color: "w", endedAt: new Date(NOW), timeClass: "CLASSICAL" }) }], ["CLASSICAL"]);
    assert.deepEqual(classical.weights, [{ tc: "RAPID", w: 1 }]);
  });

  it("is null when the baseline has no cell for the band", () => {
    const empty: BaselineV1 = { ...baseline, bands: { "600": baseline.bands["600"]! } };
    const mix = bandMix(bandOf(1500, "lichess"), empty, [], ["BLITZ"]);
    assert.equal(bandValue(mix, (c) => c.themes.fork!.per100, "ALL"), null);
  });
});
