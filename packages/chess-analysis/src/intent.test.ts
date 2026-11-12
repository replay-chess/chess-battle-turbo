// Plan intent and chip feedback (phase-03 plan §8.8; §12.1 `CA/src/intent.test.ts`): check → attack; capture →
// trade; saving an attacked piece → defend; quiet → improve; plus the design moments and the feedback strings.
import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { mockGradeInput } from "../fixtures/labels/design-mock";
import { chipFeedback, intentOf, PLAN_CHIPS, PLAN_TEXT_MAX } from "./intent";
import { INITIAL_FEN } from "./board";
import { replaySan } from "./replay";

const game = mockGradeInput("GAME").replay;

describe("intentOf", () => {
  it("a check is an attack", () => {
    // Scholar's set-up: 1.e4 e5 2.Bc4 Nc6, then 3.Bxf7+ gives check (and captures).
    const r = intentOf("r1bqkbnr/pppp1ppp/2n5/4p3/2B1P3/8/PPPP1PPP/RNBQK1NR w KQkq - 2 3", "c4f7");
    assert.deepEqual(r, { intent: "attack", san: "Bxf7+", fact: "gives check" });
  });

  it("a piece aimed at the squares around the enemy king is an attack", () => {
    // 1.e4 e5 2.Qh5: the queen hits f7, next to the king on e8.
    const r = intentOf("rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2", "d1h5");
    assert.equal(r.intent, "attack");
    assert.equal(r.fact, "aims the queen at the king");
  });

  it("a capture that holds material is a trade (GAME 19.Rxf5)", () => {
    const r = intentOf(game.fens[36] as string, "f1f5");
    assert.deepEqual(r, { intent: "trade", san: "Rxf5", fact: "wins the bishop on f5" });
  });

  it("an even exchange is a trade", () => {
    // 1.e4 d5 2.exd5 Nf6 3.c4 c6 4.dxc6 Nxc6: the knight takes back the pawn and nothing can take it.
    const r = intentOf(
      replaySan(INITIAL_FEN, ["e4", "d5", "exd5", "Nf6", "c4", "c6", "dxc6"]).fens[7] as string,
      "b8c6",
    );
    assert.deepEqual(r, { intent: "trade", san: "Nxc6", fact: "wins the pawn on c6" });
    // 2…Qxd5 also hits d2, next to White's king, but the bishop, knight and queen guard d2: still a trade.
    const queen = intentOf(replaySan(INITIAL_FEN, ["e4", "d5", "exd5"]).fens[3] as string, "d8d5");
    assert.equal(queen.intent, "trade");
    // 1.e4 e5 2.Nf3 Nc6 3.Bb5 a6 4.Bxc6 dxc6: an even trade.
    const even = intentOf("r1bqkbnr/1ppp1ppp/p1n5/1B2p3/4P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 0 4", "b5c6");
    assert.deepEqual(even, { intent: "trade", san: "Bxc6", fact: "trades on c6" });
  });

  it("a capture that loses material is not a trade", () => {
    // White's queen takes the pawn on d5, which the c6-pawn defends: …cxd5 wins the queen.
    const r = intentOf("rnbqkbnr/pp2pppp/2p5/3p4/3P4/5Q2/PPP1PPPP/RNB1KBNR w KQkq - 0 3", "f3d5");
    assert.notEqual(r.intent, "trade");
  });

  it("moving an attacked, under-protected piece away is defence", () => {
    // 1.e4 e5 2.Nf3 Nc6 3.Bb5 a6: the pawn on a6 attacks the bishop on b5 (a cheaper attacker); 4.Ba4 saves it.
    const r = intentOf("r1bqkbnr/1ppp1ppp/p1n5/1B2p3/4P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 0 4", "b5a4");
    assert.deepEqual(r, { intent: "defend", san: "Ba4", fact: "takes the bishop on b5 out of danger" });
  });

  it("adding a defender to an attacked piece is defence (GAME 17.Qc1)", () => {
    const r = intentOf(game.fens[32] as string, "d1c1");
    assert.deepEqual(r, { intent: "defend", san: "Qc1", fact: "protects the bishop on e3" });
  });

  it("answering a check is defence", () => {
    // After 1.e4 e5 2.Bc4 Nf6 3.Bxf7+: the king must move.
    const r = intentOf("rnbqkb1r/pppp1Bpp/5n2/4p3/4P3/8/PPPP1PPP/RNBQK1NR b KQkq - 0 3", "e8e7");
    assert.deepEqual(r, { intent: "defend", san: "Ke7", fact: "answers the check" });
  });

  it("a quiet move is improvement, naming the piece it challenges (GAME 21.Ne2)", () => {
    const r = intentOf(game.fens[40] as string, "c3e2");
    assert.deepEqual(r, { intent: "improve", san: "Ne2", fact: "challenges the bishop on g3" });
    const opening = intentOf(INITIAL_FEN, "g1f3");
    assert.deepEqual(opening, { intent: "improve", san: "Nf3", fact: "brings the knight to f3" });
  });

  it("refuses an illegal move", () => {
    assert.throws(() => intentOf(INITIAL_FEN, "e2e5"), RangeError);
  });
});

describe("chipFeedback", () => {
  const it1 = intentOf(game.fens[36] as string, "f1f5");

  it("covers all five chips", () => {
    const fb = chipFeedback(it1, "Rxf5 wins the bishop on f5.");
    assert.deepEqual(Object.keys(fb), [...PLAN_CHIPS]);
    assert.equal(fb.trade, "Right instinct. Rxf5 wins the bishop on f5.");
    assert.equal(fb.unsure, "The engine’s idea here was to trade: Rxf5.");
    assert.equal(
      fb.attack,
      "You were thinking: attack. The engine’s idea here was to trade: Rxf5 wins the bishop on f5.",
    );
    assert.equal(
      fb.improve,
      "You were thinking: improve a piece. The engine’s idea here was to trade: Rxf5 wins the bishop on f5.",
    );
    for (const t of Object.values(fb)) assert.ok(t.length <= PLAN_TEXT_MAX);
  });

  it("falls back to the engine's fact when the why sentence is missing or too long", () => {
    assert.equal(chipFeedback(it1, null).trade, "Right instinct. Rxf5 wins the bishop on f5.");
    assert.equal(chipFeedback(it1, "x".repeat(400)).trade, "Right instinct. Rxf5 wins the bishop on f5.");
  });
});
