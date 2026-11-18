// Eligibility and ranking (phase-06 plan §8.6 as corrected by FIX-2, D-P6-FIX2-1; §12.1): the gates one at a time
// (k = 4 fails; gamesWith = 2 fails; a capped ratio below 1.25 fails; a tail probability above 10 % / the candidates
// fails; you ≤ band fails); ranking by excess loss, ties; top 3 + more 2; own_only; the most_frequent fallback; time
// pressure only with M_lt1 ≥ 100 and a blunder rate that rises with the clock; meta tags are never candidates; the
// rc:missedThreat / defensiveMove merge. The rule's error rate and power on real band sides: eligibility.real.test.ts.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { loadBaseline } from "../../baselines/load";
import type { BaselineV1 } from "../../baselines/schema";
import { isWeaknessCandidate, WEAKNESS_CANDIDATES } from "../themes";
import type { Aggregate, PatternAgg } from "./aggregate";
import { bandMix, bandOf } from "./band";
import { EVENTS_PER_GAME_CAP } from "./constants";
import { candidateKeys, ELIGIBILITY_ALPHA, ELIGIBILITY_TESTS, isEligibleVsBand, mergeSameLabel, rankPatterns, type RankedRow } from "./patterns";

/** k events spread as evenly as possible over `games` game sides (so the per-game cap bites only when k > 2·games). */
const pa = (k: number, L: number, games: number, phaseCount: [number, number, number] = [0, k, 0], eventsLt1 = 0): PatternAgg => {
  const perGame = new Map(Array.from({ length: games }, (_, i) => [`${i}:w`, Math.floor(k / games) + (i < k % games ? 1 : 0)] as const));
  return {
    k,
    L,
    games: new Set(perGame.keys()),
    phaseCount,
    eventsLt1,
    perGame,
    kCapped: [...perGame.values()].reduce((s, n) => s + Math.min(n, EVENTS_PER_GAME_CAP), 0),
  };
};

/**
 * With moves under a minute, the clock shows them in the lt1 bucket with the time-pressure blunders, and 1 blunder per
 * 100 moves with more time: the rate rises as the clock runs down whenever the time-pressure rate is ≥ 1.25 per 100
 * (FIX-2: time pressure is a candidate only then). `clock` overrides it.
 */
function agg(
  M: number,
  themes: Record<string, PatternAgg>,
  o: { Mlt1?: number; tp?: PatternAgg; clock?: { moves: [number, number, number, number]; blunders: [number, number, number, number] } } = {},
): Aggregate {
  const lt1 = o.Mlt1 ?? 0;
  const rest = M - lt1;
  return {
    n: 50,
    M,
    Mlt1: lt1,
    phaseMoves: [0, M, 0],
    clockMoves: o.clock?.moves ?? [rest, 0, 0, lt1],
    clockBlunders: o.clock?.blunders ?? [Math.round(rest / 100), 0, 0, o.tp?.k ?? 0],
    pieceMoves: [M, 0, 0, 0, 0, 0],
    pieceErrors: [0, 0, 0, 0, 0, 0],
    themes: new Map(Object.entries(themes)),
    tp: o.tp ?? pa(0, 0, 0),
  };
}

/** A one-cell-pair baseline where every theme has the given band rate (per 100) and loss. */
function flatBaseline(rate: Record<string, number>, loss = 10, tp = { per100Lt1: 2.2, loss100: 3 }): BaselineV1 {
  const b = structuredClone(loadBaseline("v0-synthetic"));
  for (const key of ["1100", "1200"]) {
    for (const tc of ["BULLET", "BLITZ", "RAPID"] as const) {
      const cell = b.bands[key]![tc];
      for (const t of Object.keys(cell.themes)) cell.themes[t] = { per100: rate[t] ?? 0.5, loss100: (rate[t] ?? 0.5) * loss };
      cell.timePressure = { ...cell.timePressure, per100Lt1: tp.per100Lt1, loss100: tp.loss100 };
    }
  }
  return b;
}

const mixFor = (b: BaselineV1) => bandMix(bandOf(1184, "lichess"), b, [], ["BLITZ"]);

describe("eligibility gates (vs_band)", () => {
  const row = (o: Partial<RankedRow>): RankedRow => ({
    pattern: "fork",
    label: "Missed forks",
    unit: "per100",
    you: 3,
    band: 1.5,
    events: 30,
    moves: 1000,
    gamesWith: 10,
    lossYou100: 50,
    lossBand100: 20,
    ratio: 2,
    z: 3,
    score: 30,
    phaseMode: "middlegame",
    phaseCount: [0, 30, 0],
    eventsLt1: 0,
    ...o,
  });
  it("needs k ≥ 5, gamesWith ≥ 3, n ≥ 200 (100 for time pressure), you > band, capped ratio ≥ 1.25 and p ≤ α / candidates", () => {
    const ok = { p: ELIGIBILITY_ALPHA / 2 };
    assert.equal(isEligibleVsBand(row(ok)), true);
    assert.equal(isEligibleVsBand(row({ ...ok, events: 4 })), false, "k = 4");
    assert.equal(isEligibleVsBand(row({ ...ok, gamesWith: 2 })), false, "gamesWith = 2");
    assert.equal(isEligibleVsBand(row({ ...ok, ratio: 1.24 })), false, "ratio 1.24: too small an effect, however sure");
    assert.equal(isEligibleVsBand(row({ ...ok, ratio: 1.25 })), true, "ratio 1.25");
    assert.equal(isEligibleVsBand(row({ p: ELIGIBILITY_ALPHA * 1.01 })), false, "p just above the corrected level");
    assert.equal(isEligibleVsBand(row({ p: 0.01 })), false, "p 0.01: chance across ~30 themes (the plan's z ≥ 2 passed it)");
    assert.equal(isEligibleVsBand(row({ ratio: 3, p: undefined })), false, "no p: never eligible on the ratio alone");
    assert.equal(isEligibleVsBand(row({ ...ok, you: 1.5, band: 1.5 })), false, "you = band");
    assert.equal(isEligibleVsBand(row({ ...ok, you: 1.4, band: 1.5, ratio: 1.6 })), false, "you < band");
    assert.equal(isEligibleVsBand(row({ ...ok, moves: 199 })), false, "n < 200");
    assert.equal(isEligibleVsBand(row({ ...ok, pattern: "rc:timePressure", moves: 100 })), true, "time pressure from 100 moves");
    assert.equal(isEligibleVsBand(row({ ...ok, pattern: "rc:timePressure", moves: 99 })), false);
    assert.equal(isEligibleVsBand(row({ band: 0, ratio: null, z: null })), true, "band 0: any rate is above it");
  });

  it("the corrected level is 10 % over the taxonomy's candidates (Bonferroni)", () => {
    assert.equal(ELIGIBILITY_TESTS, WEAKNESS_CANDIDATES.length);
    assert.ok(ELIGIBILITY_TESTS >= 30);
    assert.ok(Math.abs(ELIGIBILITY_ALPHA - 0.1 / ELIGIBILITY_TESTS) < 1e-15);
  });
});

describe("rankPatterns", () => {
  const b = flatBaseline({ fork: 1, pin: 1, skewer: 1, hangingPiece: 1, mateIn1: 1, rookEndgame: 1 }, 10);

  it("ranks eligible rows by excess loss, then events, then key; ≤ 5 rows", () => {
    const a = agg(2000, {
      fork: pa(60, 1200, 20),
      pin: pa(60, 900, 20),
      // FIX-2: spread over 20 games each (40 capped events vs 20 expected), so all five are clear weaknesses.
      skewer: pa(40, 900, 20),
      hangingPiece: pa(40, 700, 20),
      mateIn1: pa(40, 700, 20),
      rookEndgame: pa(80, 1500, 20),
    });
    const r = rankPatterns(a, mixFor(b));
    assert.equal(r.listMode, "vs_band");
    assert.deepEqual(r.rows.map((x) => x.pattern), ["rookEndgame", "fork", "pin", "skewer", "hangingPiece"]);
    assert.ok(r.rows.every((x) => x.score === x.lossYou100 - x.lossBand100!));
    // hangingPiece and mateIn1 tie on score and events: key ascending keeps hangingPiece, and the 6th is dropped.
    assert.equal(r.rows.length, 5);
  });

  it("regression: endgame-tag-clustering — events clustered in a few games are not many independent moves (≤ 2 per game count)", () => {
    // Member B (real Stockfish 18): pawnEndgame 23 events from 4 of 58 games (z 16.7 before). Band 0.4 per 100.
    const clustered = flatBaseline({ pawnEndgame: 0.4, fork: 0.4 }, 10);
    const perGame = (counts: number[]): PatternAgg => {
      const m = new Map(counts.map((n, i) => [`${i}:w`, n] as const));
      const k = counts.reduce((x, y) => x + y, 0);
      return { k, L: k * 20, games: new Set(m.keys()), phaseCount: [0, 0, k], eventsLt1: 0, perGame: m, kCapped: counts.reduce((x, n) => x + Math.min(n, EVENTS_PER_GAME_CAP), 0) };
    };
    const a = agg(2000, { pawnEndgame: perGame([9, 6, 5, 3]), fork: perGame([2, 2, 2, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 2]) });
    const r = rankPatterns(a, mixFor(clustered));
    assert.ok(!r.rows.some((x) => x.pattern === "pawnEndgame"), "4 games are thin evidence: 8 capped events vs 8 expected");
    // The same 23 events spread over 20 games are a weakness (and fork, 23 over 20 games, is one).
    const spread = rankPatterns(agg(2000, { pawnEndgame: pa(23, 460, 20) }), mixFor(clustered));
    assert.deepEqual(spread.rows.map((x) => x.pattern), ["pawnEndgame"]);
    assert.ok(r.rows.some((x) => x.pattern === "fork"));
  });

  it("time pressure is not capped per game: its moves under a minute cluster in the same scrambles", () => {
    const b = flatBaseline({}, 10, { per100Lt1: 2, loss100: 1 });
    // 12 blunders under a minute in 3 scrambles (4 each) over 150 moves under a minute: 8.0 vs 2.0 per 100.
    const perGame = new Map([["0:w", 4], ["1:w", 4], ["2:w", 4]] as const);
    const tp: PatternAgg = { k: 12, L: 300, games: new Set(perGame.keys()), phaseCount: [0, 6, 6], eventsLt1: 12, perGame: new Map(perGame), kCapped: 6 };
    const r = rankPatterns(agg(2000, {}, { Mlt1: 150, tp }), mixFor(b));
    assert.deepEqual(r.rows.map((x) => [x.pattern, Number(x.ratio!.toFixed(2))]), [["rc:timePressure", 4]]);
  });

  it("time pressure is a candidate only with M_lt1 ≥ 100", () => {
    const tp = pa(10, 400, 6);
    const a99 = agg(2000, { fork: pa(60, 1200, 20) }, { Mlt1: 99, tp });
    assert.ok(!candidateKeys(a99).includes("rc:timePressure"));
    const a100 = agg(2000, { fork: pa(60, 1200, 20) }, { Mlt1: 100, tp });
    assert.ok(candidateKeys(a100).includes("rc:timePressure"));
    const r = rankPatterns(a100, mixFor(b));
    const tpRow = r.rows.find((x) => x.pattern === "rc:timePressure")!;
    assert.equal(tpRow.unit, "per100_under1min");
    assert.equal(tpRow.you, 10);
    assert.equal(tpRow.moves, 100);
  });

  it("meta, phase and evaluation tags are never candidates", () => {
    for (const k of ["advantage", "crushing", "equality", "mate", "oneMove", "short", "long", "veryLong", "opening", "middlegame", "endgame"]) {
      assert.equal(isWeaknessCandidate(k), false, k);
      assert.ok(!WEAKNESS_CANDIDATES.includes(k), k);
    }
    const a = agg(2000, { mate: pa(80, 3000, 30), crushing: pa(80, 3000, 30), fork: pa(60, 1200, 20) });
    assert.deepEqual(rankPatterns(a, mixFor(b)).rows.map((x) => x.pattern), ["fork"]);
  });

  it("own_only without a band: k ≥ 5 and gamesWith ≥ 3, ranked by own loss, no band numbers", () => {
    const a = agg(2000, { fork: pa(6, 200, 3), pin: pa(5, 300, 3), skewer: pa(4, 900, 4), hangingPiece: pa(9, 100, 2) });
    const r = rankPatterns(a, null);
    assert.equal(r.listMode, "own_only");
    assert.deepEqual(r.rows.map((x) => x.pattern), ["pin", "fork"]);
    assert.ok(r.rows.every((x) => x.band === null && x.ratio === null && x.z === null && x.score === x.lossYou100));
  });

  it("falls back to the 3 most frequent (k ≥ 3) when nothing beats the band", () => {
    const high = flatBaseline({ fork: 9, pin: 9, skewer: 9, hangingPiece: 9 }, 10);
    const a = agg(2000, { fork: pa(30, 600, 10), pin: pa(12, 600, 10), skewer: pa(2, 600, 2), hangingPiece: pa(20, 600, 10), rookEndgame: pa(3, 60, 3) });
    const r = rankPatterns(a, mixFor(high));
    assert.equal(r.listMode, "most_frequent");
    assert.deepEqual(r.rows.map((x) => x.pattern), ["fork", "hangingPiece", "pin"]);
    assert.ok(r.rows.every((x) => x.band === null && x.lossBand100 === null));
  });

  it("merges rows that read the same: the larger of rc:missedThreat and defensiveMove stays", () => {
    const both = (key: string) => key === "rc:missedThreat" || key === "defensiveMove" || isWeaknessCandidate(key);
    const a = agg(2000, { "rc:missedThreat": pa(30, 600, 15), defensiveMove: pa(20, 900, 10), fork: pa(25, 500, 10) });
    const r = rankPatterns(a, mixFor(flatBaseline({ "rc:missedThreat": 0.5, fork: 0.5 })), { isCandidate: both });
    assert.ok(r.rows.some((x) => x.pattern === "rc:missedThreat"));
    assert.ok(!r.rows.some((x) => x.pattern === "defensiveMove"));
    const rows = mergeSameLabel([
      { pattern: "defensiveMove", label: "Missed threats", events: 40, score: 1 } as RankedRow,
      { pattern: "rc:missedThreat", label: "Missed threats", events: 30, score: 9 } as RankedRow,
    ]);
    assert.deepEqual(rows.map((x) => x.pattern), ["defensiveMove"]);
  });
});

describe("FIX-2: the band's rate is capped like the member's (regression: cap-one-side)", () => {
  // A member exactly like the band: 30 rook-endgame events, 3 in each of 10 games, over 3000 moves; the band's raw
  // rate 1.0 per 100 but only 0.67 per 100 with ≤ 2 events a game (v1 measured 0.63–0.67 for rook endgames). Capping
  // the member alone (20 capped events against 30 expected) read as 0.67× the band: a stricter bar for clustered themes.
  it("the ratio and the test read capped100 when the baseline has it", () => {
    const b = flatBaseline({ rookEndgame: 1 }, 10);
    for (const key of ["1100", "1200"]) for (const tc of ["BULLET", "BLITZ", "RAPID"] as const) b.bands[key]![tc].themes.rookEndgame!.capped100 = 0.6667;
    const like = rankPatterns(agg(3000, { rookEndgame: pa(30, 900, 10) }), mixFor(b));
    assert.equal(like.listMode, "most_frequent", "like the band: no row against it");
    const row = rankPatterns(agg(3000, { rookEndgame: pa(30, 900, 10) }), mixFor(b), {}).rows[0]!;
    assert.equal(row.pattern, "rookEndgame");
    // Twice the band's clustered rate (60 events, 3 a game over 20 games: 40 capped vs 20 expected) is a weakness.
    const twice = rankPatterns(agg(3000, { rookEndgame: pa(60, 1800, 20) }), mixFor(b));
    assert.equal(twice.listMode, "vs_band");
    assert.ok(Math.abs(twice.rows[0]!.ratio! - 40 / 20.001) < 0.01, String(twice.rows[0]!.ratio));
  });

  it("without capped100 (v0) the raw per100 stands in, and the dispersion widens the test", () => {
    const b = flatBaseline({ fork: 1 }, 10);
    const a = agg(3000, { fork: pa(48, 900, 40) });
    const plain = rankPatterns(a, mixFor(b));
    assert.equal(plain.rows[0]!.pattern, "fork");
    assert.ok(Math.abs(plain.rows[0]!.ratio! - 48 / 30) < 1e-9);
    const wide = structuredClone(b);
    wide.dispersion = { fork: 4 };
    assert.equal(rankPatterns(a, mixFor(wide)).listMode, "most_frequent", "φ = 4: 48 vs 30 is chance");
  });
});

describe("FIX-2: time pressure needs a blunder rate that rises with the clock (regression: tp-headline-contradicts-clock)", () => {
  // weak-member (rv2): 22.5 blunders per 100 under a minute against a band of 6.7, but 45.6 / 39.4 / 30.1 per 100
  // with more time: the Clock tab said "Below 2 minutes the rate drops" under a time-pressure headline.
  it("a falling rate is no time-pressure row, however far above the band", () => {
    const b = flatBaseline({}, 10, { per100Lt1: 6.7, loss100: 1 });
    const tp = pa(36, 900, 12);
    const falling = agg(3000, {}, { Mlt1: 160, tp, clock: { moves: [1400, 900, 540, 160], blunders: [638, 355, 163, 36] } });
    assert.ok(!candidateKeys(falling).includes("rc:timePressure"));
    assert.ok(!rankPatterns(falling, mixFor(b)).rows.some((r) => r.pattern === "rc:timePressure"));
    const rising = agg(3000, {}, { Mlt1: 160, tp, clock: { moves: [1400, 900, 540, 160], blunders: [70, 60, 60, 36] } });
    assert.deepEqual(rankPatterns(rising, mixFor(b)).rows.map((r) => r.pattern), ["rc:timePressure"]);
  });
});
