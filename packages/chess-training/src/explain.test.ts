// explain.ts: the deterministic explainer (phase-05 plan §8.12, §12.1). The fork sentence names the right targets on
// CC0 Lichess fork puzzles; the loose-piece, review-position and fork templates reproduce the design boards' coach
// lines on the `V3BankSession` / `V3PuzzleThemes` positions; the generic fallback is `verified: false`.
import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { Chess, type Square } from "chess.js";
import { evalText, explainItem, explainWrongMove, lookText, type ExplainInput } from "./explain";

/** Lichess puzzle database rows (CC0 1.0, database.lichess.org): [id, FEN before the setup move, moves, rating]. */
const FORKS: [id: string, fen: string, moves: string, rating: number][] = [
  ["005nD", "3rk2r/2qn1pp1/p1Q1R3/3n3p/8/8/PP4PP/5R1K b k - 0 23", "f7e6 c6e6 d5e7 e6f7", 1151],
  ["00Aas", "3r1rk1/1p2q1pp/5p2/8/1P1n4/6Q1/PPbB1PPP/R2B1RK1 w - - 9 20", "d1c2 d4e2 g1h1 e2g3 f2g3 d8d2", 1145],
  ["00BJm", "r2q1rk1/1Q2bppp/p1N1p3/1p6/2pP1n2/2P5/PP3PPP/R4RK1 b - - 1 18", "d8d5 c6e7 g8h8 e7d5", 1002],
  ["00Evs", "5qk1/pQ3pp1/7p/b2N1b2/P3r3/5K2/7P/R4B2 b - - 1 24", "g7g5 d5f6 g8h8 f6e4", 1057],
  ["00HzX", "4r1k1/5pp1/2R4p/1p6/8/1PP3QP/2q2PP1/6K1 w - - 0 29", "c6h6 c2c1 g1h2 c1h6", 1612],
  ["00IUT", "1r2r1k1/ppp1q1pp/4b3/4P3/1Q1p1P2/8/P5PP/R1BR2K1 w - - 6 19", "d1d4 c7c5 b4a3 c5d4 a3e7 e8e7", 1442],
  ["00Tll", "5r1k/1pp3p1/7p/pP1N4/P3P3/2PP3P/3BnbPK/R7 w - - 2 27", "d5c7 f2g3 h2h1 g3c7", 1513],
  ["00bTs", "2r4k/6bP/8/3p4/pp1qn3/3N1Q2/PPP3R1/1K5R w - - 5 35", "g2g7 e4d2 b1a1 d2f3", 1114],
  ["00rYo", "8/p1p4p/6p1/2p2k2/2Pb4/1P3P1K/P2RN2P/6r1 b - - 9 35", "g1f1 e2g3 f5f4 g3f1", 1048],
  ["00Uwn", "3r1rk1/p1p2pbp/1p4p1/7n/4P3/1P2BP1q/P1B3QP/3R1R1K b - - 6 23", "h3h4 e3g5 h5g3 g2g3", 1631],
];

const EXPECTED: Record<string, string> = {
  "005nD": "Qxe6+ hits the king and the knight at once. After Ne7, Qf7# is mate.",
  "00Aas": "Ne2+ hits the king and the queen at once. After the king moves, Nxg3+ wins the queen.",
  "00BJm": "Nxe7+ hits the king and the queen at once. After the king moves, Nxd5 wins the queen.",
  "00Evs": "Nf6+ hits the king and the rook at once. After the king moves, Nxe4 wins the rook.",
  "00HzX": "Qc1+ hits the king and the rook at once. After the king moves, Qxh6 wins the rook.",
  "00IUT": "c5 forks the queen on b4 and the rook on d4. After Qa3, cxd4 wins the rook.",
  "00Tll": "Bg3+ hits the king and the knight at once. After the king moves, Bxc7 wins the knight.",
  "00bTs": "Nd2+ hits the king and the queen at once. After the king moves, Nxf3 wins the queen.",
  "00rYo": "Ng3+ hits the king and the rook at once. After the king moves, Nxf1 wins the rook.",
  "00Uwn": "Bg5 forks the queen on h4 and the rook on d8. After Ng3+, Qxg3 wins the knight.",
};

/** The Lichess row as the runner gets it: the position after the setup move, the member's line from there. */
function puzzle(fen: string, moves: string): ExplainInput {
  const [setup, ...solution] = moves.split(" ");
  const chess = new Chess(fen);
  chess.move({ from: setup!.slice(0, 2), to: setup!.slice(2, 4) });
  return { fen: chess.fen(), solution, theme: "fork", kind: "puzzle" };
}

const PIECES = ["king", "queen", "rook", "bishop", "knight", "pawn"] as const;
const LETTER: Record<(typeof PIECES)[number], string> = { king: "k", queen: "q", rook: "r", bishop: "b", knight: "n", pawn: "p" };

describe("fork sentences on 10 CC0 Lichess fork puzzles", () => {
  for (const [id, fen, moves] of FORKS) {
    it(`${id}: names the pieces the forking move attacks`, () => {
      const input = puzzle(fen, moves);
      const t = explainItem(input);
      assert.equal(t.correct, EXPECTED[id]);
      assert.equal(t.verified, true);
      assert.equal(t.look, "Look for one square where a piece attacks two things.");
      assert.equal(t.wrongGameMove, null);
      assert.equal(t.costText, null);

      // Independent check on the board: every piece named before " at once" / "." stands on a square the moved piece
      // attacks, and the king is named exactly when the move gives check.
      const board = new Chess(input.fen);
      const m = board.move({ from: input.solution[0]!.slice(0, 2), to: input.solution[0]!.slice(2, 4) });
      const clause = t.correct.split(/ at once\.| forks |\. /)[t.correct.includes(" forks ") ? 1 : 0]!;
      const named = PIECES.filter((p) => new RegExp(`\\bthe ${p}\\b`).test(clause));
      assert.ok(named.length >= 2, clause);
      assert.equal(named.includes("king"), board.inCheck(), `${id}: king named iff check`);
      for (const p of named) {
        const squares = board
          .board()
          .flat()
          .filter((x) => x && x.color !== m.color && x.type === LETTER[p])
          .map((x) => x!.square as Square);
        assert.ok(
          squares.some((sq) => board.attackers(sq, m.color).includes(m.to)),
          `${id}: the ${p} is not attacked from ${m.to}`,
        );
      }
    });
  }

  it("names a fork that comes later in the line", () => {
    const t = explainItem(puzzle("r2qk2r/pp2ppbp/1n1p2p1/3Pn3/2P5/2NBBP1P/PP3P2/R2QK2R b KQkq - 0 12", "e5c4 d3c4 b6c4 d1a4 d8d7 a4c4"));
    assert.equal(t.correct, "Bxc4 sets up Qa4+, which hits the king and the knight at once.");
  });
});

describe("design boards", () => {
  // V3PuzzleThemes (Lichess-style puzzle, position after the setup move ...Qd5).
  const nc7: ExplainInput = { fen: "r3kbnr/pp3ppp/8/1N1q4/8/8/PPPP1PPP/R1BQKB1R w KQkq - 1 2", solution: ["b5c7", "e8d8", "c7d5"], cpBest: 600, theme: "fork", kind: "puzzle" };

  it("V3PuzzleThemes Nc7+: the coach line and the hint, verbatim", () => {
    const t = explainItem(nc7);
    assert.equal(t.correct, "Nc7+ hits the king, the queen and the rook at once. After the king moves, Nxd5 wins the queen.");
    assert.equal(t.hint, "Your knight can give check from two squares. One of them also hits the queen.");
  });

  it("V3PuzzleThemes Nxf7: the no-check fork names squares and why the king cannot take", () => {
    const t = explainItem({ fen: "rn1qk2r/ppp1bpp1/3p3p/6N1/2B5/8/PPP2PPP/RNBQK2R w KQkq - 0 2", solution: ["g5f7"], cpBest: 300, theme: "fork", kind: "puzzle" });
    assert.equal(t.correct, "Nxf7 forks the queen on d8 and the rook on h8. The king can’t take back because your bishop guards f7.");
  });

  it("V3PuzzleThemes wrong Nd6+: says what the wrong square attacks (the board's line omits the f7 pawn, which d6 also hits)", () => {
    const w = explainWrongMove(nc7, "b5d6");
    assert.equal(w.text, "The knight check is there, but from d6 it only attacks the king, the pawn on b7 and the pawn on f7. Look for the square that hits three things.");
    assert.equal(w.verified, true);
  });

  // V3BankSession item 2 (Loose piece, MISS): Rxf5, played Qd2.
  const rxf5: ExplainInput = {
    fen: "r2r2k1/p1q2pp1/2p2n1p/5b2/8/1PNNP1bP/P1P1B1P1/R2Q1RK1 w - - 0 19",
    solution: ["f1f5", "g3h2", "g1h1"],
    playedUci: "d1d2",
    refuteUci: "f5d3",
    cpBest: 270,
    theme: "hangingPiece",
    kind: "mistake",
  };

  it("V3BankSession Rxf5 (loose piece): correct, wrong, hint and cost lines verbatim", () => {
    const t = explainItem(rxf5);
    assert.equal(t.correct, "Rxf5 wins the bishop. Nothing of Black’s defends f5, and the engine rates the position about +2.7.");
    assert.equal(t.wrongGameMove, "Not the move. Something of Black’s is loose: count the defenders of the bishop on f5.");
    assert.equal(t.hint, "Look at your rook on f1. What can it see now that the f-pawn is gone?");
    assert.equal(t.costText, "Rxf5 won a bishop here, about +2.7 for you. Qd2 let it go.");
    assert.equal(t.look, null);
    assert.equal(t.verified, true);
  });

  // V3BankSession item 3 (Defended pawn, BLUNDER): Ne2, played Bxc6.
  it("V3BankSession Ne2 (defended target): correct, wrong, hint and cost lines verbatim", () => {
    const t = explainItem({
      fen: "r3r1k1/p1q2ppb/2p2n1p/8/8/1PNNPBbP/P1PQ2P1/R4RK1 w - - 0 21",
      solution: ["c3e2"],
      playedUci: "f3c6",
      refuteUci: "c7c6",
      cpBest: 20,
      theme: "rc:defendedTarget",
      kind: "review_position",
    });
    assert.equal(t.correct, "Ne2 challenges the bishop on g3 and keeps the game level. c6 is guarded by the queen.");
    assert.equal(t.wrongGameMove, "Bxc6 is what you played: the queen on c7 guards c6, so it gives a bishop for a pawn.");
    assert.equal(t.hint, "Before taking on c6, count its defenders. Then look at the bishop on g3.");
    assert.equal(t.costText, "Bxc6 gave a bishop for a pawn: the queen on c7 guards c6.");
    assert.equal(t.verified, true);
  });

  // V3BankSession item 1 (Recapture first, INACCURACY): Qc1, played b3. The board's copy says "doubled e-pawns", but
  // after b3 Nxe3 fxe3 White has a single e-pawn with no d- or f-pawn beside it: it is isolated, not doubled. The
  // explainer states what the position shows, in the board's sentence.
  it("V3BankSession Qc1 (recapture first): the board's sentences with the true pawn damage (isolated, not doubled)", () => {
    const t = explainItem({
      fen: "r2r2k1/p1q2pp1/2pb1n1p/5b2/2n5/2NNB2P/PPP1BPP1/R2Q1RK1 w - - 0 17",
      solution: ["d1c1", "c4e3", "c1e3"],
      playedUci: "b2b3",
      refuteUci: "c4e3",
      cpBest: 30,
      theme: "rc:recapture",
      kind: "review_position",
    });
    assert.equal(t.correct, "Qc1 keeps the queen ready to recapture on e3, so you avoid an isolated e-pawn.");
    assert.equal(t.wrongGameMove, "b3 is what you played. After Nxe3 fxe3 your e-pawn is isolated. Keep the queen ready to take back.");
    assert.equal(t.hint, "Which piece can guard e3 without blocking anything?");
    assert.equal(t.costText, "After Nxe3 fxe3 your e-pawn ends up isolated.");
    // The structure really is what the sentence says.
    const b = new Chess("r2r2k1/p1q2pp1/2pb1n1p/5b2/2n5/2NNB2P/PPP1BPP1/R2Q1RK1 w - - 0 17");
    b.move("b3");
    b.move("Nxe3");
    b.move("fxe3");
    const whitePawns = b.board().flat().filter((x) => x && x.color === "w" && x.type === "p").map((x) => x!.square);
    assert.deepEqual(whitePawns.filter((s) => s[0] === "e"), ["e3"]);
    assert.ok(!whitePawns.some((s) => s[0] === "d" || s[0] === "f"));
  });

  it("doubled pawns are named when the recapture really doubles them", () => {
    // Black's knight takes on e3; f2xe3 lands next to the existing e-pawn on e4.
    const t = explainItem({
      fen: "4k3/8/8/8/2n1P3/4B3/PPP2PPP/3QK1NR w - - 0 1",
      solution: ["d1c1"],
      playedUci: "a2a3",
      refuteUci: "c4e3",
      cpBest: 0,
      theme: "rc:recapture",
      kind: "review_position",
    });
    assert.equal(t.wrongGameMove, "a3 is what you played. After Nxe3 fxe3 your e-pawns are doubled. Keep the queen ready to take back.");
  });
});

describe("other templates and the fallback", () => {
  it("mate in one and forced mate", () => {
    // Back-rank mate: Re8#.
    const one = explainItem({ fen: "6k1/5ppp/8/8/8/8/5PPP/4R1K1 w - - 0 1", solution: ["e1e8"], theme: "backRankMate", kind: "puzzle" });
    assert.equal(one.correct, "Re8# is mate.");
    assert.equal(one.hint, "Look for a check that leaves the king no square.");
    const two = explainItem({ fen: "6k1/5ppp/8/8/8/8/5PPP/4R1K1 w - - 0 1", solution: ["e1e8"], mateBest: 2, theme: "mateIn2", kind: "puzzle" });
    assert.equal(two.correct, "Re8# forces mate in 2.");
  });

  it("a material win with the engine's number", () => {
    const t = explainItem({ fen: "4k3/8/8/3q4/8/8/3R4/4K3 w - - 0 1", solution: ["d2d5"], cpBest: 940, theme: "advantage", kind: "puzzle" });
    assert.equal(t.correct, "Rxd5 wins the queen. Nothing of Black’s defends d5, and the engine rates the position about +9.4.");
  });

  it("says the engine's choice when nothing specific is true, and the wrong-move fallback is not verified", () => {
    const input: ExplainInput = { fen: "4k3/8/8/8/8/8/4P3/4K3 w - - 0 1", solution: ["e2e4"], cpBest: 150, theme: "quietMove", kind: "puzzle" };
    const t = explainItem(input);
    assert.equal(t.correct, "e4 is the engine's choice here, about +1.5 for you.");
    assert.equal(t.look, "Look for checks, captures and threats first.");
    const w = explainWrongMove(input, "e2e3");
    assert.equal(w.verified, false);
    assert.equal(w.text, "Not the move. Look at your pawn on e2. What can it see?");
    assert.equal(explainWrongMove(input, "a1a8").verified, false, "an illegal move gets the fallback");
  });

  it("refuses a solution that is not legal in the position", () => {
    assert.throws(() => explainItem({ fen: "4k3/8/8/8/8/8/4P3/4K3 w - - 0 1", solution: ["e2e5"], theme: "fork", kind: "puzzle" }));
  });

  it("formats evaluations from the member's side", () => {
    assert.equal(evalText(270), "+2.7");
    assert.equal(evalText(-43), "-0.4");
    assert.equal(evalText(4), "0.0");
    assert.equal(evalText(null, 3), "M3");
    assert.equal(evalText(null, -2), "-M2");
    assert.equal(evalText(null), null);
    assert.equal(lookText("pin"), "Look for a piece that cannot move without exposing a bigger one behind it.");
  });
});
