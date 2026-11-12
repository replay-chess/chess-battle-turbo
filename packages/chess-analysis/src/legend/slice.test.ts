// The helpers ported from the legacy analysis route (phase-03 plan §12.1 `CA/src/legend/slice.test.ts`):
// move-number slicing, result metadata, outcome mapping, plus the start-position check the port adds.
import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { legendFixture } from "../../fixtures/legend";
import {
  legacyUserOutcome,
  legendLineFrom,
  legendResultOf,
  outcomeForMember,
  parseResultFromMetadata,
  resultFromPgn,
  sliceIndex,
  startPlyOfFen,
} from "./slice";

describe("parseResultFromMetadata (ported)", () => {
  it("reads every notation the legacy route accepted", () => {
    for (const r of ["1-0", "white_won", "WHITE", " White "])
      assert.equal(parseResultFromMetadata({ result: r }), "white_won");
    for (const r of ["0-1", "black_won", "black"]) assert.equal(parseResultFromMetadata({ result: r }), "black_won");
    for (const r of ["1/2-1/2", "draw", "0.5-0.5"]) assert.equal(parseResultFromMetadata({ result: r }), "draw");
  });

  it("is null without metadata, without a result, or for an unknown one", () => {
    assert.equal(parseResultFromMetadata(null), null);
    assert.equal(parseResultFromMetadata(undefined), null);
    assert.equal(parseResultFromMetadata({}), null);
    assert.equal(parseResultFromMetadata({ result: 1 }), null);
    assert.equal(parseResultFromMetadata({ result: "*" }), null);
  });
});

describe("the PGN result", () => {
  it("reads the Result header, else the termination token", () => {
    assert.equal(resultFromPgn('[Result "0-1"]\n\n1.e4 e5 0-1'), "black_won");
    assert.equal(resultFromPgn("1.e4 e5 2.Nf3 1/2-1/2"), "draw");
    assert.equal(resultFromPgn('[Result "*"]\n\n1.e4 *'), null);
    assert.equal(resultFromPgn("1.e4 e5"), null);
  });

  it("prefers the position's metadata, as the legacy route did", () => {
    assert.equal(legendResultOf('[Result "1-0"]\n\n1.e4 1-0', { result: "draw" }), "draw");
    assert.equal(legendResultOf('[Result "1-0"]\n\n1.e4 1-0', null), "white_won");
    assert.equal(legendResultOf(null, null), null);
  });
});

describe("outcome mapping", () => {
  it("legacy creator/opponent results (ported getUserGameOutcome)", () => {
    assert.equal(legacyUserOutcome("DRAW", true), "draw");
    assert.equal(legacyUserOutcome("CREATOR_WON", true), "win");
    assert.equal(legacyUserOutcome("OPPONENT_TIMEOUT", true), "win");
    assert.equal(legacyUserOutcome("OPPONENT_WON", true), "loss");
    assert.equal(legacyUserOutcome("CREATOR_TIMEOUT", true), "loss");
    assert.equal(legacyUserOutcome("CREATOR_WON", false), "loss");
    assert.equal(legacyUserOutcome("OPPONENT_WON", false), "win");
    assert.equal(legacyUserOutcome(null, true), null);
    assert.equal(legacyUserOutcome("SOMETHING", false), null);
  });

  it("P2 games: games.outcome and the member's colour", () => {
    assert.equal(outcomeForMember("WHITE", "w"), "win");
    assert.equal(outcomeForMember("WHITE", "b"), "loss");
    assert.equal(outcomeForMember("BLACK", "b"), "win");
    assert.equal(outcomeForMember("DRAW", "b"), "draw");
    assert.equal(outcomeForMember("NONE", "w"), null);
    assert.equal(outcomeForMember(null, "w"), null);
  });
});

describe("move-number slicing", () => {
  it("indexes White and Black starts like the legacy parsePgnFromMoveNumber", () => {
    assert.equal(sliceIndex(31, "w"), 60);
    assert.equal(sliceIndex(31, "b"), 61);
    assert.equal(sliceIndex(1, "w"), 0);
    assert.equal(startPlyOfFen("b2r3r/k4p1p/p2q1np1/NppP4/3p1Q2/P4PPB/1PP4P/1K1RR3 w - - 1 24"), 46);
    assert.equal(startPlyOfFen("r3r1k1/pp3pbp/1qp3p1/2B5/2BP2b1/Q1n2N2/P4PPP/3R1K1R b - - 3 17"), 33);
  });

  it("slices the Opera Game at move 10 and counts its 17 moves", () => {
    const f = legendFixture("opera");
    const line = legendLineFrom(f.legendPgn, f.startFen);
    assert.ok(line);
    assert.equal(line.startIndex, 18);
    assert.equal(line.totalMoves, 17);
    assert.deepEqual(line.san.slice(0, 5), ["Nxb5", "cxb5", "Bxb5+", "Nbd7", "O-O-O"]);
    assert.equal(line.san.at(-1), "Rd8#");
  });

  it("falls back to the matching position when the stored move number is wrong", () => {
    const f = legendFixture("opera");
    const wrong = legendLineFrom(f.legendPgn, f.startFen, 7);
    assert.ok(wrong);
    assert.equal(wrong.startIndex, 18);
    assert.equal(wrong.san[0], "Nxb5");
  });

  it("returns null when the PGN never reaches the start position or does not parse", () => {
    const f = legendFixture("opera");
    assert.equal(legendLineFrom("1.e4 e5 2.Nf3 Nc6", f.startFen), null);
    assert.equal(legendLineFrom("1.e4 e5 2.Ke3 Ke6 3.Qh8", f.startFen), null);
    assert.equal(legendLineFrom("", f.startFen), null);
  });

  it("a Black-to-move position starts on Black's ply", () => {
    const f = legendFixture("kt");
    // The position after 24.Rxd4 (Black to move).
    const fen = "b2r3r/k4p1p/p2q1np1/NppP4/3R1Q2/P4PPB/1PP4P/1K2R3 b - - 0 24";
    const line = legendLineFrom(f.legendPgn, fen);
    assert.ok(line);
    assert.equal(line.startIndex, 47);
    assert.equal(line.san[0], "cxd4");
    assert.equal(line.totalMoves, 44);
  });
});
