// Breakdowns (phase-06 plan §8.7–§8.9, §12.1): the phase-weighted mean; null below 60 moves; every phase sentence
// variant; clock per-bucket null below 30 moves; the section null below 100 timed moves; "doubles" / "triples" / "×";
// the chart's accessible sentence exactly as on the board; openings notes, priority, thresholds and ECO ranges.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { loadBaseline } from "../../baselines/load";
import { gameInput } from "../../test/gen";
import { aggregate } from "./aggregate";
import { bandMix, bandOf } from "./band";
import { clockAriaLabel, clockBreakdown, clockSentence, phaseBreakdown, phaseSentence, type PhaseRowDoc, pieceBreakdown } from "./breakdown";
import { analysedOf } from "./compute";
import { openingsBreakdown } from "./openings";

const at = new Date("2026-11-10T12:00:00Z");
const mix = bandMix(bandOf(1184, "lichess"), loadBaseline("v0-synthetic"), [], ["BLITZ"]);

describe("phase breakdown", () => {
  it("is the move-weighted mean of P3's phase accuracy (games with acc ≥ 0 and ≥ 3 moves), null below 60 moves", () => {
    const games = analysedOf([
      gameInput({ gameId: "1", color: "w", endedAt: at, phaseMoves: [30, 40, 10], phaseAccuracy: [90, 60, 80] }),
      gameInput({ gameId: "2", color: "b", endedAt: at, phaseMoves: [10, 30, 0], phaseAccuracy: [70, 80, -1] }),
      gameInput({ gameId: "3", color: "w", endedAt: at, phaseMoves: [2, 40, 30], phaseAccuracy: [10, 70, 90] }),
    ]);
    const rows = phaseBreakdown(games, mix);
    assert.equal(rows[0]!.you, null, "40 opening moves < 60: the game with 2 opening moves is left out");
    assert.equal(rows[1]!.you, Math.round((60 * 40 + 80 * 30 + 70 * 40) / 110));
    assert.equal(rows[1]!.moves, 110);
    assert.equal(rows[2]!.you, null, "40 endgame moves");
    assert.deepEqual(rows.map((r) => r.band), [84, 76, 74]);
    assert.deepEqual(phaseBreakdown(games, null).map((r) => r.band), [null, null, null]);
  });

  const row = (phase: PhaseRowDoc["phase"], you: number | null, band: number | null): PhaseRowDoc => ({ phase, you, band, moves: 100 });
  it("speaks every sentence variant", () => {
    assert.equal(phaseSentence([row("opening", 88, 84), row("middlegame", 71, 76), row("endgame", 75, 74)]), "Accuracy by phase. Your openings are above your band; the middlegame is where it drops.");
    assert.equal(phaseSentence([row("opening", 88, 84), row("middlegame", 71, 76), row("endgame", 79, 74)]), "Accuracy by phase. Your openings and your endgames are above your band; the middlegame is where it drops.");
    assert.equal(phaseSentence([row("opening", 80, 84), row("middlegame", 80, 76), row("endgame", 70, 74)]), "Accuracy by phase. Your middlegame is above your band; the opening is where it drops.");
    assert.equal(phaseSentence([row("opening", 90, 84), row("middlegame", 80, 76), row("endgame", 79, 74)]), "Accuracy by phase. You are above your band in every phase.");
    assert.equal(phaseSentence([row("opening", 80, 84), row("middlegame", 66, 76), row("endgame", 70, 74)]), "Accuracy by phase. Every phase is below your band; the middlegame drops most.");
    assert.equal(phaseSentence([row("opening", 85, 84), row("middlegame", 75, 76), row("endgame", 74, 74)]), "Accuracy by phase. You are close to your band in every phase.");
    assert.equal(phaseSentence([row("opening", 88, 84), row("middlegame", 75, 76), row("endgame", 74, 74)]), "Accuracy by phase. Your openings are above your band; the rest is close to it.");
    assert.equal(phaseSentence([row("opening", 85, 84), row("middlegame", 70, 76), row("endgame", null, 74)]), "Accuracy by phase. The middlegame is where it drops below your band.");
    assert.equal(phaseSentence([row("opening", null, 84), row("middlegame", null, null), row("endgame", null, 74)]), "Accuracy by phase. Not enough moves in each phase to compare yet.");
  });

  it("regression: phase-sentence-unknown-phase — a phase without a number is never described", () => {
    // The review case: opening 82/76 and middlegame 74/68 above, endgame null (fewer than 60 moves).
    assert.equal(phaseSentence([row("opening", 82, 76), row("middlegame", 74, 68), row("endgame", null, 79)]), "Accuracy by phase. Your openings and your middlegame are above your band.");
    assert.equal(phaseSentence([row("opening", 82, 76), row("middlegame", 69, 68), row("endgame", null, 79)]), "Accuracy by phase. Your openings are above your band; your middlegame is close to it.");
    assert.equal(phaseSentence([row("opening", 77, 76), row("middlegame", 69, 68), row("endgame", null, 79)]), "Accuracy by phase. Your openings and your middlegame are close to your band.");
    assert.equal(phaseSentence([row("opening", 92, 76), row("middlegame", 88, 68), row("endgame", null, 79)]), "Accuracy by phase. Your openings and your middlegame are above your band.");
    assert.equal(phaseSentence([row("opening", 60, 76), row("middlegame", 50, 68), row("endgame", null, 79)]), "Accuracy by phase. The middlegame is where it drops below your band.");
  });
});

describe("clock breakdown", () => {
  const withClock = (clockMoves: [number, number, number, number], blunders: [number, number, number, number]) => {
    const g = gameInput({
      gameId: "1",
      color: "w",
      endedAt: at,
      phaseMoves: [100, clockMoves.reduce((s, x) => s + x, 0) - 100, 0],
      clockMoves,
      errors: blunders.flatMap((n, b) => Array.from({ length: n }, () => ({ judgement: 1 as const, phase: 1 as const, clockBucket: (b + 1) as 1 | 2 | 3 | 4, winLoss: 20, themes: [] }))),
    });
    return aggregate(analysedOf([g]));
  };

  it("rates per bucket from 30 moves, the section null below 100 timed moves", () => {
    const a = withClock([1250, 1000, 2000, 250], [10, 11, 52, 10]);
    const c = clockBreakdown(a, mix)!;
    assert.deepEqual(c.buckets.map((b) => b.per100), [0.8, 1.1, 2.6, 4]);
    assert.deepEqual(c.buckets.map((b) => b.band), [0.6, 0.8, 1.5, 2.2]);
    assert.equal(c.sentence, "Blunders per 100 moves, by time left on your clock. Below 2 minutes the rate triples.");
    const thin = withClock([200, 100, 29, 0], [1, 1, 1, 0]);
    assert.deepEqual(clockBreakdown(thin, null)!.buckets.map((b) => b.per100), [0.5, 1, null, null]);
    const untimed = aggregate(analysedOf([gameInput({ gameId: "2", color: "w", endedAt: at, phaseMoves: [100, 100, 0], clockMoves: [50, 30, 10, 9] })]));
    assert.equal(clockBreakdown(untimed, null), null, "99 timed moves");
  });

  it("doubles below 2.5×, triples below 3.5×, else N× higher; rises from 1.25×, drops at 0.8×, else about the same", () => {
    const head = "Blunders per 100 moves, by time left on your clock.";
    const s = (gt5: number, low: number) => clockSentence({ clockMoves: [100, 0, 100, 0], clockBlunders: [gt5, 0, low, 0] });
    assert.equal(s(10, 18), `${head} Below 2 minutes the rate doubles.`);
    assert.equal(s(10, 24), `${head} Below 2 minutes the rate doubles.`);
    assert.equal(s(10, 25), `${head} Below 2 minutes the rate triples.`);
    assert.equal(s(10, 35), `${head} Below 2 minutes the rate is 4× higher.`);
    assert.equal(s(10, 17), `${head} Below 2 minutes the rate rises.`);
    assert.equal(s(10, 13), `${head} Below 2 minutes the rate rises.`);
    assert.equal(s(10, 12), `${head} Your blunder rate stays about the same as the clock runs down.`);
    assert.equal(s(10, 9), `${head} Your blunder rate stays about the same as the clock runs down.`);
    assert.equal(s(10, 8), `${head} Below 2 minutes the rate drops.`);
    assert.equal(s(0, 0), `${head} Your blunder rate stays about the same as the clock runs down.`);
    assert.equal(s(0, 17), `${head} Below 2 minutes the rate rises.`);
  });

  it("regression: clock-sentence-flat-claim — the reference is 2–5 minutes when the member rarely has over 5, and a rise or fall is never 'about the same'", () => {
    const head = "Blunders per 100 moves, by time left on your clock.";
    // A 3+0 / 5+0 blitz player: gt5 has 5 moves; 2to5 1.0, 1to2 4.0, lt1 8.0 per 100 → about 6× higher.
    assert.equal(clockSentence({ clockMoves: [5, 400, 200, 150], clockBlunders: [0, 4, 8, 12] }), `${head} Below 2 minutes the rate is 6× higher.`);
    // Member B (real Stockfish 18 rows): gt5 4.8, 2to5 8.9, 1to2 7.1, lt1 9.5 per 100.
    assert.equal(clockSentence({ clockMoves: [878, 707, 281, 273], clockBlunders: [42, 63, 20, 26] }), `${head} Below 2 minutes the rate rises.`);
    // Member H (falling): 47.2 → 43.9 → 35.0 → 25.1.
    assert.equal(clockSentence({ clockMoves: [500, 500, 400, 400], clockBlunders: [236, 220, 140, 100] }), `${head} Below 2 minutes the rate drops.`);
    // No rate on a comfortable clock, or none under 2 minutes: nothing is claimed.
    assert.equal(clockSentence({ clockMoves: [20, 29, 200, 100], clockBlunders: [1, 1, 8, 9] }), `${head} Not enough timed moves in each range to compare yet.`);
    assert.equal(clockSentence({ clockMoves: [400, 300, 10, 15], clockBlunders: [4, 3, 1, 1] }), `${head} Not enough timed moves in each range to compare yet.`);
  });

  it("the chart's accessible name lists every value, as on the board", () => {
    assert.equal(
      clockAriaLabel([
        { key: "gt5", per100: 0.8 },
        { key: "2to5", per100: 1.1 },
        { key: "1to2", per100: 2.6 },
        { key: "lt1", per100: 3.4 },
      ]),
      "Blunders per 100 moves: over 5 minutes 0.8, 2 to 5 minutes 1.1, 1 to 2 minutes 2.6, under 1 minute 3.4",
    );
    assert.equal(clockAriaLabel([{ key: "gt5", per100: 1 }, { key: "lt1", per100: null }]), "Blunders per 100 moves: over 5 minutes 1.0, under 1 minute not enough moves");
  });

  it("piece rates from 30 moves of the piece", () => {
    const a = aggregate(analysedOf([gameInput({ gameId: "3", color: "w", endedAt: at, phaseMoves: [40, 40, 0], pieceMoves: [40, 30, 5, 3, 1, 1], errors: [{ judgement: 0, phase: 1, clockBucket: 2, winLoss: 9, themes: [], piece: 0 }] })]));
    assert.deepEqual(pieceBreakdown(a).map((p) => p.per100), [2.5, 0, null, null, null, null]);
  });
});

describe("openings breakdown", () => {
  const g = (eco: string | null, result: "WIN" | "DRAW" | "LOSS" | null, n = 1) => Array.from({ length: n }, () => ({ ecoCode: eco, result }));
  it("groups by family over all in-scope games: top 4 by games, score %, ECO range, notes in priority order", () => {
    const rows = openingsBreakdown([
      ...g("C55", "WIN", 16), ...g("C57", "DRAW", 4), ...g("C59", "LOSS", 18),
      ...g("D35", "WIN", 7), ...g("D50", "DRAW", 4), ...g("D61", "LOSS", 13),
      ...g("B22", "WIN", 10), ...g("B22", "DRAW", 4), ...g("B22", "LOSS", 7),
      ...g("D02", "WIN", 10), ...g("D02", "DRAW", 3), ...g("D02", "LOSS", 6),
      ...g("B12", "WIN", 12), ...g(null, "WIN", 30), ...g("C00", null, 10),
    ]);
    assert.deepEqual(rows, [
      { family: "Two Knights Defence", ecoRange: "C55–C59", games: 38, points: 18, scorePct: 47, note: "most_played" },
      { family: "Queen’s Gambit Declined", ecoRange: "D30–D69", games: 24, points: 9, scorePct: 38, note: "most_points_lost" },
      { family: "Sicilian, Alapin", ecoRange: "B22", games: 21, points: 12, scorePct: 57, note: null },
      { family: "London System", ecoRange: "D02", games: 19, points: 11.5, scorePct: 61, note: "best_score" },
    ]);
  });
  it("needs 3 games per family; Most played needs 5, Best score 10; Most points lost needs a deficit", () => {
    const rows = openingsBreakdown([...g("C55", "WIN", 4), ...g("B22", "WIN", 3), ...g("D02", "LOSS", 2)]);
    assert.deepEqual(rows.map((r) => [r.family, r.note]), [["Two Knights Defence", null], ["Sicilian, Alapin", null]]);
    assert.deepEqual(openingsBreakdown([...g("C55", "WIN", 5)]).map((r) => r.note), ["most_played"]);
    // One row earns two notes: it shows the more useful one (points lost > best score > most played); no note moves.
    assert.deepEqual(openingsBreakdown([...g("C55", "LOSS", 5)]).map((r) => r.note), ["most_points_lost"]);
    assert.deepEqual(openingsBreakdown([...g("C55", "LOSS", 5), ...g("B22", "LOSS", 4)]).map((r) => r.note), ["most_points_lost", null]);
    assert.deepEqual(openingsBreakdown([...g("C55", "WIN", 12), ...g("B22", "LOSS", 4)]).map((r) => r.note), ["best_score", "most_points_lost"]);
    assert.deepEqual(openingsBreakdown([]), []);
  });

  it("regression: openings-note-wrong-row — each note sits on the row it describes, or on no row", () => {
    const lost = (r: { games: number; points: number }) => r.games * 0.5 - r.points;
    // Najdorf 20 games 6 points (lost 4), French Advance 6 games 2.5 points (lost 0.5).
    const a = openingsBreakdown([...g("B90", "WIN", 6), ...g("B90", "LOSS", 14), ...g("C02", "WIN", 2), ...g("C02", "DRAW", 1), ...g("C02", "LOSS", 3)]);
    assert.deepEqual(a.map((r) => [r.family, r.note]), [[a[0]!.family, "most_points_lost"], [a[1]!.family, null]]);
    assert.equal(lost(a[0]!), Math.max(...a.map(lost)));
    // Najdorf 15 games 80 %, French Advance 10 games 60 %: Best score is the Najdorf (also most played).
    const b = openingsBreakdown([...g("B90", "WIN", 12), ...g("B90", "LOSS", 3), ...g("C02", "WIN", 6), ...g("C02", "LOSS", 4)]);
    assert.deepEqual(b.map((r) => [r.scorePct, r.note]), [[80, "best_score"], [60, null]]);
  });
});
