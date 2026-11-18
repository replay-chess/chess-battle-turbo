// Strengths (phase-06 plan §8.20, §12.1; copy note C10): conversion shown at 9/10 and hidden at 4/5 reached; book exit
// 81 % White wins over 75 % Black; the phase strength from +3; at most 2; an empty list.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { loadBaseline } from "../../baselines/load";
import { gameInput, type GameSpec } from "../../test/gen";
import { bandMix, bandOf } from "./band";
import type { PhaseRowDoc } from "./breakdown";
import { analysedOf } from "./compute";
import { strengthsOf } from "./strengths";

const NOW = Date.parse("2026-11-16T10:00:00.000Z");
const mix = bandMix(bandOf(1184, "lichess"), loadBaseline("v0-synthetic"), [], ["BLITZ"]);
const close: PhaseRowDoc[] = [
  { phase: "opening", you: 84, band: 84, moves: 500 },
  { phase: "middlegame", you: 76, band: 76, moves: 900 },
  { phase: "endgame", you: 74, band: 74, moves: 300 },
];

function games(n: number, f: (i: number) => Partial<GameSpec>) {
  return analysedOf(Array.from({ length: n }, (_, i) => gameInput({ gameId: String(10 + i), color: i % 2 === 0 ? "w" : "b", endedAt: new Date(NOW - i * 3_600_000), ...f(i) })));
}

describe("strengths", () => {
  it("conversion: shown at 9 of 10 reached, hidden at 4 of 5 (too few) and at 7 of 10 (below 80 %)", () => {
    const nine = games(30, (i) => ({ reachedPlus3: i < 10, converted: i < 9 }));
    assert.deepEqual(strengthsOf(nine, close, mix), {
      sentences: ["You convert won positions: 9 of your last 10 games that reached +3 or better ended in a win."],
      keys: ["conversion"],
    });
    assert.deepEqual(strengthsOf(games(30, (i) => ({ reachedPlus3: i < 4, converted: i < 4 })), close, mix).keys, []);
    assert.deepEqual(strengthsOf(games(30, (i) => ({ reachedPlus3: i < 10, converted: i < 7 })), close, mix).keys, []);
    // Only the newest 30 count: an old conversion streak does not.
    assert.deepEqual(strengthsOf(games(60, (i) => ({ reachedPlus3: i >= 30, converted: i >= 30 })), close, mix).keys, []);
  });

  it("book exit: the better colour that qualifies (81 % White over 75 % Black)", () => {
    const g = games(52, (i) => {
      const k = Math.floor(i / 2);
      return i % 2 === 0 ? { bookExitWin: k < 26 ? (k < 21 ? 52 : 38) : null } : { bookExitWin: k < 24 ? (k < 18 ? 50 : 40) : null };
    });
    const s = strengthsOf(g, close, mix);
    assert.deepEqual(s.keys, ["book_exit_w"]);
    assert.deepEqual(s.sentences, ["Your openings as White are sound: you leave book with an equal position 81% of the time."]);
    const blackOnly = games(30, (i) => (i % 2 === 1 ? { bookExitWin: 60 } : { bookExitWin: 30 }));
    assert.deepEqual(strengthsOf(blackOnly, close, mix).keys, ["book_exit_b"]);
    const few = games(18, () => ({ bookExitWin: 60 }));
    assert.deepEqual(strengthsOf(few, close, mix).keys, [], "fewer than 10 games of each colour");
  });

  it("phase: the largest you − band ≥ 3", () => {
    const rows: PhaseRowDoc[] = [
      { phase: "opening", you: 87, band: 84, moves: 500 },
      { phase: "middlegame", you: 71, band: 76, moves: 900 },
      { phase: "endgame", you: 79, band: 74, moves: 300 },
    ];
    assert.deepEqual(strengthsOf(games(5, () => ({})), rows, mix), {
      sentences: ["Your endgame accuracy is 79, above players at your level (74)."],
      keys: ["phase_endgame"],
    });
    const two: PhaseRowDoc[] = [{ ...rows[0]!, you: 86 }, rows[1]!, { ...rows[2]!, you: 76 }];
    assert.deepEqual(strengthsOf(games(5, () => ({})), two, mix).keys, [], "+2 is not a strength");
  });

  it("keeps at most 2, in priority order", () => {
    const rows: PhaseRowDoc[] = [{ phase: "opening", you: 90, band: 84, moves: 500 }, close[1]!, close[2]!];
    const g = games(40, (i) => ({ reachedPlus3: i < 10, converted: i < 10, bookExitWin: i % 2 === 0 ? 60 : null }));
    const s = strengthsOf(g, rows, mix);
    assert.deepEqual(s.keys, ["conversion", "book_exit_w"]);
    assert.equal(s.sentences.length, 2);
  });

  it("an empty list when nothing stands out", () => {
    assert.deepEqual(strengthsOf([], close, null), { sentences: [], keys: [] });
  });
});
