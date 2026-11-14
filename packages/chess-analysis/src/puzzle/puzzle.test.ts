// puzzle/validAttack.ts and puzzle/line.ts (phase-05 plan §12.1 "PKG/chess-analysis/src/puzzle/*.test.ts"):
// validAttack (no second move, mate in 1 with other mates, gap just above vs just below 0.5), the "too winning" and
// "< 2 legal moves" skips, the line trim to odd length, the final forced move dropped, one-movers, the repetition
// stop and MAX_LINE_PLIES.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Chess } from "chess.js";
import { encodeMate, NO_SECOND } from "../codec";
import { winningChances } from "../winpct";
import { extendLine, MAX_LINE_PLIES, trimLine, type LineSearchResult } from "./line";
import { puzzleVerdict, uniquenessGap, validAttack, winsEnough } from "./validAttack";

/** The integer centipawn second score whose gap to `best` is just above (`side` = 1) or below (−1) `target`. */
function secondForGap(best: number, target: number, side: 1 | -1): number {
  const wb = winningChances(best);
  for (let cp = best; cp > -1000; cp--) {
    const gap = wb - winningChances(cp);
    if (side === 1 ? gap > target : gap >= target) return side === 1 ? cp : cp + 1;
  }
  throw new Error("no such second");
}

describe("validAttack", () => {
  it("is valid with no second legal move", () => {
    assert.equal(validAttack({ best: 40, second: NO_SECOND, mover: "w" }), true);
    assert.equal(uniquenessGap({ best: 40, second: NO_SECOND, mover: "w" }), null);
  });

  it("separates a gap just above 0.5 from one just below (T = 0.5)", () => {
    const best = 700;
    const above = secondForGap(best, 0.5, 1);
    const below = secondForGap(best, 0.5, -1);
    const gapAbove = uniquenessGap({ best, second: above, mover: "w" })!;
    const gapBelow = uniquenessGap({ best, second: below, mover: "w" })!;
    assert.ok(gapAbove > 0.5 && gapAbove < 0.51, `gap ${gapAbove}`);
    assert.ok(gapBelow <= 0.5 && gapBelow > 0.49, `gap ${gapBelow}`);
    assert.equal(validAttack({ best, second: above, mover: "w" }), true);
    assert.equal(validAttack({ best, second: below, mover: "w" }), false);
  });

  it("reads the evals from the mover's point of view (Black to move)", () => {
    assert.equal(validAttack({ best: -700, second: 100, mover: "b" }), true);
    assert.equal(validAttack({ best: -700, second: -650, mover: "b" }), false);
  });

  it("keeps a mate in 1 unique while the second move stays at wc ≤ 0.6, and accepts other mates in 1", () => {
    const mate1 = encodeMate("w", 1);
    assert.equal(validAttack({ best: mate1, second: encodeMate("w", 1), mover: "w" }), true);
    assert.equal(validAttack({ best: mate1, second: 300, mover: "w" }), true); // wc(300) ≈ 0.50
    assert.equal(validAttack({ best: mate1, second: 400, mover: "w" }), false); // wc(400) ≈ 0.63
    assert.equal(validAttack({ best: mate1, second: encodeMate("w", 3), mover: "w" }), false);
    const mate1b = encodeMate("b", 1);
    assert.equal(validAttack({ best: mate1b, second: encodeMate("b", 1), mover: "b" }), true);
  });

  it("winsEnough: ≥ +200 cp or a forced mate for the mover", () => {
    assert.equal(winsEnough(200, "w"), true);
    assert.equal(winsEnough(199, "w"), false);
    assert.equal(winsEnough(-250, "b"), true);
    assert.equal(winsEnough(encodeMate("w", 4), "w"), true);
    assert.equal(winsEnough(encodeMate("b", 4), "w"), false);
  });
});

describe("puzzleVerdict", () => {
  const unique = { best: 600, second: 0, mover: "w" as const, legalCount: 30 };

  it("a unique winning move is a puzzle", () => {
    const v = puzzleVerdict({ ...unique, evalBeforeSetup: 20 });
    assert.equal(v.isPuzzle, true);
    assert.ok(v.gap !== null && v.gap > 0.5);
  });

  it("fewer than 2 legal moves → review position", () => {
    const v = puzzleVerdict({ ...unique, legalCount: 1, second: NO_SECOND, evalBeforeSetup: 20 });
    assert.deepEqual(v, { isPuzzle: false, gap: null, reason: "few_legal_moves" });
  });

  it("not unique, not winning → review position", () => {
    assert.equal(puzzleVerdict({ ...unique, second: 550, evalBeforeSetup: 20 }).isPuzzle, false);
    const notWinning = puzzleVerdict({ best: 150, second: -900, mover: "w", legalCount: 20, evalBeforeSetup: 0 });
    assert.equal(notWinning.isPuzzle === false && notWinning.reason, "not_winning");
  });

  it("too winning: already above +300 (or mating) before the opponent's move, and no mate now", () => {
    const v = puzzleVerdict({ ...unique, evalBeforeSetup: 450 });
    assert.equal(v.isPuzzle === false && v.reason, "too_winning");
    const hadMate = puzzleVerdict({ ...unique, evalBeforeSetup: encodeMate("w", 6) });
    assert.equal(hadMate.isPuzzle === false && hadMate.reason, "too_winning");
    // A mate now is never "too winning".
    const mate = puzzleVerdict({ ...unique, best: encodeMate("w", 2), evalBeforeSetup: 450 });
    assert.equal(mate.isPuzzle, true);
    // Black's point of view.
    const black = puzzleVerdict({ best: -600, second: 0, mover: "b", legalCount: 25, evalBeforeSetup: -450 });
    assert.equal(black.isPuzzle === false && black.reason, "too_winning");
  });
});

describe("trimLine", () => {
  it("drops a trailing defender move (odd length)", () => {
    assert.deepEqual(trimLine(["a", "b", "c", "d"], [false, false]), ["a", "b", "c"]);
  });

  it("drops a final forced solver move with the reply before it", () => {
    assert.deepEqual(trimLine(["a", "b", "c", "d", "e"], [false, false, true]), ["a", "b", "c"]);
    assert.deepEqual(trimLine(["a", "b", "c"], [false, true]), ["a"]);
  });

  it("never returns an empty line, even when the first move was forced", () => {
    assert.deepEqual(trimLine(["a"], [true]), ["a"]);
    assert.deepEqual(trimLine(["a", "b", "c"], [true, true]), ["a"]);
  });
});

/** A search answering from a table keyed by the FEN's placement + side; unknown positions answer "no move". */
function tableSearch(table: Record<string, LineSearchResult>) {
  const asked: string[] = [];
  const search = async (fen: string): Promise<LineSearchResult> => {
    const key = fen.split(" ").slice(0, 2).join(" ");
    asked.push(key);
    return table[key] ?? { best: null, eval: 0, second: NO_SECOND, pv: [] };
  };
  return { search, asked };
}

function keyAfter(fen: string, moves: string[]): string {
  const c = new Chess(fen);
  for (const m of moves) c.move({ from: m.slice(0, 2), to: m.slice(2, 4), promotion: m[4] });
  return c.fen().split(" ").slice(0, 2).join(" ");
}

describe("extendLine", () => {
  // White: Qh5xf7 style back-and-forth position with plenty of material; the table drives the engine answers.
  const FEN = "r1bqkb1r/pppp1ppp/2n2n2/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR w KQkq - 4 4";

  it("a mate in one stays one move (the game is over)", async () => {
    const { search, asked } = tableSearch({});
    const out = await extendLine({ fen: FEN, best: "h5f7", pv: ["h5f7"], search });
    assert.deepEqual(out.line, ["h5f7"]);
    assert.equal(out.stop, "game_over");
    assert.equal(asked.length, 0);
  });

  it("grows by the PV reply and a unique winning search, then stops when the next move is not unique", async () => {
    const fen = "6k1/5ppp/8/8/8/8/5PPP/R5K1 w - - 0 1";
    const after2 = keyAfter(fen, ["a1a7", "g8f8"]);
    const { search } = tableSearch({
      // After Ra7 Kf8: Ra8+ is unique and winning; its PV supplies Black's reply.
      [after2]: { best: "a7a8", eval: 900, second: 100, pv: ["a7a8", "f8e7"] },
      // After Ra8+ Ke7: no unique move any more.
      [keyAfter(fen, ["a1a7", "g8f8", "a7a8", "f8e7"])]: { best: "a8a7", eval: 900, second: 880, pv: ["a8a7"] },
    });
    const out = await extendLine({ fen, best: "a1a7", pv: ["a1a7", "g8f8"], search });
    assert.deepEqual(out.line, ["a1a7", "g8f8", "a7a8"]);
    assert.equal(out.stop, "not_unique");
    assert.equal(out.searches, 2);
  });

  it("stops when the solver is no longer winning enough", async () => {
    const fen = "6k1/5ppp/8/8/8/8/5PPP/R5K1 w - - 0 1";
    const { search } = tableSearch({
      [keyAfter(fen, ["a1a7", "g8f8"])]: { best: "a7a8", eval: 150, second: -400, pv: ["a7a8"] },
    });
    const out = await extendLine({ fen, best: "a1a7", pv: ["a1a7", "g8f8"], search });
    assert.deepEqual(out.line, ["a1a7"]);
    assert.equal(out.stop, "not_winning");
  });

  it("asks the reply search when the variation has no defender move", async () => {
    const fen = "6k1/5ppp/8/8/8/8/5PPP/R5K1 w - - 0 1";
    const { search } = tableSearch({
      [keyAfter(fen, ["a1a7", "h7h6"])]: { best: "a7a8", eval: 900, second: 0, pv: ["a7a8"] },
    });
    const replies: string[] = [];
    const reply = async (f: string) => {
      replies.push(f);
      return replies.length === 1 ? "h7h6" : null;
    };
    const out = await extendLine({ fen, best: "a1a7", pv: ["a1a7"], search, reply });
    assert.deepEqual(out.line, ["a1a7", "h7h6", "a7a8"]);
    assert.equal(out.replySearches, 2);
    assert.equal(out.stop, "no_reply");
  });

  it("stops on a repetition", async () => {
    // Rooks shuffle: after Ra1-a2 Kg8-h8 Ra2-a1 Kh8-g8 the start position comes back.
    const fen = "6k1/8/8/8/8/8/8/R5K1 w - - 0 1";
    const { search } = tableSearch({
      [keyAfter(fen, ["a1a2", "g8h8"])]: { best: "a2a1", eval: 900, second: 0, pv: ["a2a1", "h8g8"] },
    });
    const out = await extendLine({ fen, best: "a1a2", pv: ["a1a2", "g8h8"], search });
    assert.deepEqual(out.line, ["a1a2", "g8h8", "a2a1"]);
    assert.equal(out.stop, "repetition");
  });

  it("never exceeds MAX_LINE_PLIES and stops at the search budget", async () => {
    const fen = "4k3/8/8/8/8/8/8/R3K2R w - - 0 1";
    // An endless chain of unique winning moves: every solver position answers a legal rook/king move.
    const search = async (f: string): Promise<LineSearchResult> => {
      const c = new Chess(f);
      const m = c.moves({ verbose: true }).find((x) => x.piece === "r" && !x.captured)!;
      return { best: `${m.from}${m.to}`, eval: 900, second: 0, pv: [`${m.from}${m.to}`] };
    };
    const reply = async (f: string) => {
      const c = new Chess(f);
      const m = c.moves({ verbose: true })[0]!;
      return `${m.from}${m.to}`;
    };
    const out = await extendLine({ fen, best: "a1a7", pv: ["a1a7"], search, reply });
    assert.ok(out.line.length <= MAX_LINE_PLIES);
    assert.equal(out.line.length % 2, 1);
    assert.ok(out.searches <= 3);
    const budget = await extendLine({ fen, best: "a1a7", pv: ["a1a7"], search, reply, maxSearches: 1 });
    assert.equal(budget.searches, 1);
    assert.equal(budget.line.length, 3);
    assert.equal(budget.stop, "budget");
  });

  it("refuses an illegal first move", async () => {
    const { search } = tableSearch({});
    await assert.rejects(() => extendLine({ fen: FEN, best: "a1a8", pv: [], search }), RangeError);
  });
});
