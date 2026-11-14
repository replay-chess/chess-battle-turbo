// bank/candidates.ts (phase-05 plan §12.1): the judgement set, inaccuracies at ≥ 7 Win% inside 10–90 (D-1), the book
// and first-6-ply skips, the top 4 by Win% loss, the key-moment union, `colorUnknown` games and the MISSED_PUNISH
// mapping.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { J, type Color } from "../codec";
import { winPct } from "../winpct";
import { BANK_SKIP_FIRST_PLIES, MAX_BANK_PER_GAME, selectCandidates, type CandidateInput } from "./candidates";

interface Ply {
  ply: number;
  code: number;
  /** White-POV evals before and after the ply. */
  before: number;
  after: number;
}

/** A 40-ply game from the initial position: every ply BEST at 0 cp except the listed ones. */
function game(plies: Ply[], extra: Partial<CandidateInput> = {}, side: Color = "w"): CandidateInput {
  const n = 40;
  const judgements = Array.from({ length: n }, () => J.BEST as number);
  const evals = Array.from({ length: n + 1 }, () => 0);
  for (const p of plies) {
    judgements[p.ply] = p.code;
    evals[p.ply] = p.before;
    evals[p.ply + 1] = p.after;
  }
  return { judgements, evals, side, startMover: "w", startPly: 0, momentPlies: [], ...extra };
}

const plies = (input: CandidateInput) => selectCandidates(input).map((c) => c.ply);

describe("selectCandidates", () => {
  it("takes MISTAKE, BLUNDER and MISS plies of the side, never good moves or the other side's errors", () => {
    const input = game([
      { ply: 10, code: J.MISTAKE, before: 0, after: -250 },
      { ply: 14, code: J.BLUNDER, before: 0, after: -600 },
      { ply: 18, code: J.MISS, before: 300, after: 0 },
      { ply: 22, code: J.GOOD, before: 0, after: -30 },
      { ply: 25, code: J.BLUNDER, before: 0, after: 700 }, // Black's blunder
    ]);
    assert.deepEqual(plies(input), [10, 14, 18]);
  });

  it("D-1: an inaccuracy needs ≥ 7 Win% lost from an undecided position (10 ≤ Win% before ≤ 90)", () => {
    const sevenish = game([
      { ply: 10, code: J.INACCURACY, before: 0, after: -80 }, // ≈ 7.3 Win%
      { ply: 14, code: J.INACCURACY, before: 0, after: -70 }, // ≈ 6.4 Win%
    ]);
    assert.ok(winPct(0) - winPct(-80) >= 7 && winPct(0) - winPct(-70) < 7);
    assert.deepEqual(plies(sevenish), [10]);
    // Decided before the move: Win% before above 90 (≈ +630 cp) or below 10.
    const decided = game([
      { ply: 10, code: J.INACCURACY, before: 650, after: 400 },
      { ply: 14, code: J.INACCURACY, before: -600, after: -1000 },
    ]);
    assert.ok(winPct(650) > 90 && winPct(-600) < 10);
    assert.deepEqual(plies(decided), []);
  });

  it("skips BOOK plies and the first 6 plies of the game (absolute ply)", () => {
    const early = game([
      { ply: 2, code: J.BLUNDER, before: 0, after: -800 },
      { ply: 4, code: J.MISTAKE, before: 0, after: -300 },
      { ply: 6, code: J.MISTAKE, before: 0, after: -300 },
      { ply: 8, code: J.BOOK, before: 0, after: -300 },
    ]);
    assert.equal(BANK_SKIP_FIRST_PLIES, 6);
    assert.deepEqual(plies(early), [6]);
    // A game started from a legend position at absolute ply 19 keeps its early plies.
    const legend = game([{ ply: 2, code: J.BLUNDER, before: 0, after: -800 }], { startPly: 20 });
    assert.deepEqual(plies(legend), [2]);
  });

  it("keeps the top 4 by Win% loss, returned in ply order", () => {
    const input = game([
      { ply: 8, code: J.MISTAKE, before: 0, after: -200 },
      { ply: 12, code: J.BLUNDER, before: 0, after: -900 },
      { ply: 16, code: J.MISTAKE, before: 0, after: -260 },
      { ply: 20, code: J.BLUNDER, before: 0, after: -500 },
      { ply: 24, code: J.MISTAKE, before: 0, after: -230 },
      { ply: 28, code: J.BLUNDER, before: 0, after: -700 },
    ]);
    assert.equal(MAX_BANK_PER_GAME, 4);
    assert.deepEqual(plies(input), [12, 16, 20, 28]);
  });

  it("forces every key-moment ply in first (the union), still capped at 4", () => {
    const input = game(
      [
        { ply: 8, code: J.INACCURACY, before: 0, after: -90 }, // a fill moment
        { ply: 12, code: J.BLUNDER, before: 0, after: -900 },
        { ply: 16, code: J.BLUNDER, before: 0, after: -800 },
        { ply: 20, code: J.BLUNDER, before: 0, after: -700 },
        { ply: 24, code: J.BLUNDER, before: 0, after: -600 },
        { ply: 4, code: J.MISTAKE, before: 0, after: -400 }, // a moment inside the first 6 plies
      ],
      { momentPlies: [4, 8, 24] },
    );
    const out = selectCandidates(input);
    assert.deepEqual(
      out.map((c) => [c.ply, c.moment]),
      [
        [4, true],
        [8, true],
        [12, false],
        [24, true],
      ],
    );
  });

  it("drops a moment ply that is not an error or has no known best move", () => {
    const input = game([{ ply: 10, code: J.BLUNDER, before: 0, after: -900 }], {
      momentPlies: [14, 10],
      hasBest: (p) => p !== 10,
    });
    assert.deepEqual(plies(input), []);
  });

  it("extracts nothing from a game whose colours are unknown", () => {
    const input = game([{ ply: 10, code: J.BLUNDER, before: 0, after: -900 }], { colorUnknown: true, momentPlies: [10] });
    assert.deepEqual(selectCandidates(input), []);
  });

  it("maps MISS to MISSED_PUNISH and every other error to OWN_ERROR; Black reads its own point of view", () => {
    const input = game(
      [
        { ply: 11, code: J.MISS, before: -400, after: 0 },
        { ply: 15, code: J.BLUNDER, before: 0, after: 700 },
      ],
      {},
      "b",
    );
    const out = selectCandidates(input);
    assert.deepEqual(
      out.map((c) => [c.ply, c.source]),
      [
        [11, "MISSED_PUNISH"],
        [15, "OWN_ERROR"],
      ],
    );
    assert.ok(Math.abs(out[1]!.winBefore - 50) < 1e-9);
    assert.ok(out[1]!.winAfter < 10);
  });
});
