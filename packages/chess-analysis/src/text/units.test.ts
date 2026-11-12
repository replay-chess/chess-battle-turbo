// One case per template rule (phase-03 plan §8.4 reason templates, §8.6, §8.7): reasons, phase line, summary,
// headline, coach line, best decision, ask and why. The full documents are snapshot-tested in templates.test.ts.
import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { mockGradeInput } from "../../fixtures/labels/design-mock";
import { INITIAL_FEN } from "../board";
import { classifyGame } from "../classify";
import { encodeCp, encodeMate, J, NO_SECOND } from "../codec";
import { intentOf } from "../intent";
import { replaySan, uciOf } from "../replay";
import { askText, threatFact } from "./ask";
import { bestDecisionText, CLEAN_LOSS_LINE, moveText } from "./clean";
import { COACH_LINE_MAX, coachLineText } from "./coachline";
import { headlineText, type HeadlineInput } from "./headline";
import { seeExchange, see } from "../see";
import { phaseLine } from "./phase";
import { missGain, plyReason, reasonText, UNGRADED_REASON } from "./reasons";
import { NOTHING_TO_FIX, summarySentences, turningPointSentence } from "./summary";
import { materialPhrase, replyLoss, tradePhrase } from "./facts";
import { whySentences } from "./why";

const GAME = mockGradeInput("GAME");
const fens = GAME.replay.fens;

describe("reasons (§8.4 R-CLS-08)", () => {
  it("one line per label", () => {
    const r = (code: Parameters<typeof reasonText>[0]["code"], extra = {}) =>
      reasonText({ code, bestSan: "Rxf5", winBefore: 75, ...extra });
    assert.equal(r(J.UNGRADED), UNGRADED_REASON);
    assert.equal(UNGRADED_REASON, "Not graded yet. Still analysing this move.");
    assert.equal(r(J.BOOK), "Known opening theory.");
    assert.equal(r(J.FORCED), "The only legal move.");
    assert.equal(r(J.BEST), "The engine’s top choice.");
    assert.equal(r(J.EXCELLENT), "Almost as good as the engine’s move, Rxf5.");
    assert.equal(r(J.GOOD), "Fine; Rxf5 was a little better.");
    assert.equal(r(J.BRILLIANT), "A sound sacrifice.");
    assert.equal(r(J.INACCURACY), "Engine preferred Rxf5.");
    assert.equal(r(J.MISTAKE), "Engine preferred Rxf5.");
    assert.equal(r(J.BLUNDER), "Engine preferred Rxf5.");
    assert.equal(r(J.MISS, { miss: { kind: "piece", piece: "b" } }), "Missed Rxf5, which wins a bishop.");
    assert.equal(r(J.MISS, { miss: { kind: "mate", moves: 2 } }), "Missed Rxf5, a mate in 2.");
    assert.equal(r(J.MISS, { miss: null }), "Missed Rxf5.");
  });

  it("GREAT names the outcome the move keeps", () => {
    assert.equal(reasonText({ code: J.GREAT, bestSan: null, winBefore: 80 }), "The only move that keeps the win.");
    assert.equal(reasonText({ code: J.GREAT, bestSan: null, winBefore: 52 }), "The only move that keeps the draw.");
    assert.equal(reasonText({ code: J.GREAT, bestSan: null, winBefore: 33 }), "The only move that keeps the hold.");
  });

  it("drops the SAN when the best move is unknown", () => {
    assert.equal(reasonText({ code: J.EXCELLENT, bestSan: null }), "Almost as good as the engine’s move.");
    assert.equal(reasonText({ code: J.MISTAKE, bestSan: null }), "The engine had a better move.");
    assert.equal(reasonText({ code: J.MISS, bestSan: null }), "Missed a chance here.");
  });

  it("MISS facts from the board: GAME 19.Qd2 missed Rxf5, which wins a bishop", () => {
    assert.deepEqual(missGain(fens[36] as string, "f1f5", GAME.evals[36] as number, "w"), {
      kind: "piece",
      piece: "b",
    });
    assert.equal(
      plyReason({
        code: J.MISS,
        fenBefore: fens[36] as string,
        bestUci: "f1f5",
        evalBefore: 290,
        mover: "w",
        winBefore: 74,
      }),
      "Missed Rxf5, which wins a bishop.",
    );
    assert.deepEqual(missGain(fens[36] as string, "f1f5", encodeMate("w", 3), "w"), { kind: "mate", moves: 3 });
    assert.equal(missGain(INITIAL_FEN, "e2e4", 20, "w"), null);
  });
});

describe("phase line (§8.7)", () => {
  const division = { middlegamePly: 10, endgamePly: 20 };
  const flat = new Array<number>(31).fill(50);

  it("tokens by first match", () => {
    assert.equal(
      phaseLine({ series: flat, division, phaseAccuracy: [95, 80, 60], side: "w" }),
      "Opening solid · middlegame equal · endgame slipped",
    );
    assert.equal(
      phaseLine({
        series: flat,
        division: { middlegamePly: 10, endgamePly: null },
        phaseAccuracy: [89.6, 74.4, -1],
        side: "w",
      }),
      "Opening solid · middlegame slipped · endgame not reached",
    );
    const swing = flat.map((w, i) => (i <= 10 ? w : i <= 20 ? 50 - 3 * (i - 10) : 20 + 3 * (i - 20)));
    assert.equal(
      phaseLine({ series: swing, division, phaseAccuracy: [95, 95, 95], side: "w" }),
      "Opening solid · middlegame lost the thread · endgame won it",
    );
    // The same series seen by Black: the swings flip.
    assert.equal(
      phaseLine({ series: swing, division, phaseAccuracy: [95, 95, 95], side: "b" }),
      "Opening solid · middlegame won it · endgame lost the thread",
    );
  });
});

describe("summary (§8.7)", () => {
  it("accuracy, strongest phase, turning point, close", () => {
    const s = summarySentences({
      accuracy: 78.2,
      oppAccuracy: 85.1,
      phaseAccuracy: [96, 57.6, -1],
      turningPoint: "The game turned on move 19, when Qd2 missed Rxf5.",
      momentsCount: 3,
      isClean: false,
      result: "loss",
    });
    assert.deepEqual(
      s.map((x) => x.t),
      [
        "You played at 78 accuracy; your opponent at 85.",
        "Your opening was the strongest part (96).",
        "The game turned on move 19, when Qd2 missed Rxf5.",
        "3 moments are worth a second look.",
      ],
    );
    assert.ok(s.every((x) => x.v === false));
  });

  it("no strongest phase within 10 points, one moment, no opponent number, nothing to fix", () => {
    const one = summarySentences({
      accuracy: 90,
      oppAccuracy: null,
      phaseAccuracy: [99, 95, -1],
      turningPoint: "The game turned on move 5, when Nf3 missed Nc3.",
      momentsCount: 1,
      isClean: false,
      result: "win",
    });
    assert.deepEqual(
      one.map((x) => x.t),
      [
        "You played at 90 accuracy.",
        "The game turned on move 5, when Nf3 missed Nc3.",
        "1 moment is worth a second look.",
      ],
    );
    const none = summarySentences({
      accuracy: null,
      oppAccuracy: null,
      phaseAccuracy: [],
      turningPoint: null,
      momentsCount: 0,
      isClean: true,
      result: "win",
    });
    assert.deepEqual(
      none.map((x) => x.t),
      [NOTHING_TO_FIX],
    );
  });

  it("turning point variants", () => {
    const base = { startPly: 0, member: "w" as const, replyUci: null, rule: "severity" as const };
    assert.equal(
      turningPointSentence({
        ...base,
        ply: 36,
        fenBefore: fens[36] as string,
        playedUci: "d1d2",
        bestUci: "f1f5",
        code: J.MISS,
        rule: "miss",
        evalAfter: -62,
      }),
      "The game turned on move 19, when Qd2 missed Rxf5.",
    );
    assert.equal(
      turningPointSentence({
        ...base,
        ply: 40,
        fenBefore: fens[40] as string,
        playedUci: "f3c6",
        bestUci: "c3e2",
        replyUci: "c7c6",
        code: J.BLUNDER,
        evalAfter: -365,
      }),
      "The game turned on move 21, when Bxc6 lost a bishop for a pawn.",
    );
    // Fool's mate: 2.g4?? allows 2…Qh4#.
    const fool = replaySan(INITIAL_FEN, ["f3", "e5"]);
    assert.equal(
      turningPointSentence({
        ...base,
        ply: 2,
        fenBefore: fool.fens[2] as string,
        playedUci: "g2g4",
        bestUci: "b1c3",
        replyUci: "d8h4",
        code: J.BLUNDER,
        rule: "mate_created",
        evalAfter: encodeMate("b", 1),
      }),
      "The game turned on move 2, when g4 let Black force mate.",
    );
    assert.equal(
      turningPointSentence({
        ...base,
        ply: 2,
        fenBefore: fool.fens[2] as string,
        playedUci: "g2g4",
        bestUci: "b1c3",
        code: J.BLUNDER,
        rule: "mate_lost",
        evalAfter: 300,
      }),
      "The game turned on move 2, when g4 let a forced mate slip.",
    );
  });
});

describe("best decision and clean loss (§8.6)", () => {
  it("suffix by label", () => {
    const b = { ply: 30, startPly: 0, san: "Qb8+", member: "w" as const };
    assert.equal(
      bestDecisionText({ ...b, code: J.BRILLIANT, evalAfter: encodeMate("w", 1) }),
      "Your best decision: 16.Qb8+, a sacrifice that forced mate.",
    );
    assert.equal(
      bestDecisionText({ ...b, code: J.BRILLIANT, evalAfter: 250 }),
      "Your best decision: 16.Qb8+, a sound sacrifice.",
    );
    assert.equal(
      bestDecisionText({ ...b, code: J.GREAT, evalAfter: 250 }),
      "Your best decision: 16.Qb8+, the only move that held.",
    );
    assert.equal(bestDecisionText({ ...b, code: J.BEST, evalAfter: 250 }), "Your best decision: 16.Qb8+.");
    assert.equal(moveText(31, 0, "Nxb8"), "16…Nxb8");
    assert.equal(moveText(0, 33, "Be6"), "17…Be6");
  });
});

describe("headline (§8.7)", () => {
  const worst = (over: Partial<NonNullable<HeadlineInput["worst"]>>): NonNullable<HeadlineInput["worst"]> => ({
    ply: 36,
    code: J.MISS,
    fill: false,
    fenBefore: fens[36] as string,
    playedUci: "d1d2",
    bestUci: "f1f5",
    replyUci: null,
    mateAgainst: false,
    ...over,
  });
  const h = (over: Partial<HeadlineInput>) =>
    headlineText({ isClean: false, startPly: 0, worst: worst({}), fillCount: 0, legend: null, ...over });

  it("the archive notes of V3GamesArchive", () => {
    assert.equal(h({}), "Missed Rxf5 · move 19");
    assert.equal(
      h({
        worst: worst({
          ply: 40,
          code: J.BLUNDER,
          fenBefore: fens[40] as string,
          playedUci: "f3c6",
          bestUci: "c3e2",
          replyUci: "c7c6",
        }),
      }),
      "Dropped a bishop · move 21",
    );
    assert.equal(h({ worst: worst({ code: J.BLUNDER, replyUci: null }) }), "Blunder · move 19");
    assert.equal(
      h({
        worst: worst({
          ply: 40,
          code: J.BLUNDER,
          fenBefore: fens[40] as string,
          playedUci: "f3c6",
          replyUci: "c7c6",
          mateAgainst: true,
        }),
      }),
      "Blunder · move 21",
    );
    assert.equal(h({ worst: worst({ code: J.MISTAKE }) }), "Mistake · move 19");
    assert.equal(h({ worst: worst({ code: J.INACCURACY, fill: true }), fillCount: 2 }), "2 inaccuracies");
    assert.equal(h({ worst: worst({ code: J.INACCURACY, fill: true }), fillCount: 1 }), "1 inaccuracy");
    assert.equal(h({ isClean: true, worst: null }), "Clean game");
  });

  it("legend games", () => {
    assert.equal(
      h({ isClean: true, worst: null, legend: { name: "Morphy", followed: true, userDivergencePly: null } }),
      "Played like Morphy",
    );
    assert.equal(
      h({
        isClean: true,
        worst: null,
        startPly: 18,
        legend: { name: "Morphy", followed: false, userDivergencePly: 4 },
      }),
      "Left Morphy’s path · move 12",
    );
    assert.equal(h({ legend: { name: "Morphy", followed: false, userDivergencePly: 4 } }), "Missed Rxf5 · move 19");
  });
});

describe("coach line (§8.7, COV C-02)", () => {
  it("first match: legend finish, turning point, best decision, clean loss, nothing to fix", () => {
    const base = { turningPoint: null, isClean: false, bestDecision: null, result: null };
    assert.equal(
      coachLineText({ ...base, legendFinish: { name: "Morphy", year: 1858, ply: 14, startPly: 18, san: "Rd8#" } }),
      "17.Rd8# finished it the way Morphy did in 1858.",
    );
    assert.equal(
      coachLineText({ ...base, legendFinish: { name: "Morphy", year: null, ply: 14, startPly: 18, san: "Rd8#" } }),
      "17.Rd8# finished it the way Morphy did.",
    );
    assert.equal(
      coachLineText({ ...base, legendFinish: null, turningPoint: "The game turned on move 19, when Qd2 missed Rxf5." }),
      "The game turned on move 19, when Qd2 missed Rxf5.",
    );
    assert.equal(
      coachLineText({
        ...base,
        legendFinish: null,
        isClean: true,
        bestDecision: "Your best decision: 16.Qb8+, a sacrifice that forced mate.",
      }),
      "Your best decision: 16.Qb8+, a sacrifice that forced mate.",
    );
    assert.equal(coachLineText({ ...base, legendFinish: null, isClean: true, result: "loss" }), CLEAN_LOSS_LINE);
    assert.equal(coachLineText({ ...base, legendFinish: null }), NOTHING_TO_FIX);
  });

  it("a candidate over 160 characters falls through", () => {
    const long = `The game turned on move 19, when ${"Qd2 ".repeat(40)}missed Rxf5.`;
    assert.ok(long.length > COACH_LINE_MAX);
    assert.equal(
      coachLineText({ legendFinish: null, turningPoint: long, isClean: false, bestDecision: null, result: null }),
      NOTHING_TO_FIX,
    );
  });
});

describe("ask (§8.7)", () => {
  it("a hanging piece after the opponent's move (GAME moment 2)", () => {
    assert.equal(
      askText({ fenBefore: fens[36] as string, lastMove: { uci: "e5g3", san: "Bg3" }, moveNo: 19, winBefore: 74.4 }),
      "Move 19. Black just played Bg3. Something was available here. What would you play?",
    );
  });

  it("a threat on an under-protected piece", () => {
    // 1.e4 e5 2.Qh5 Nc6 3.Bc4 g6 4.Qf3 Nf6 5.Nc3 Nd4: the knight attacks the queen on f3 (a cheaper attacker).
    const g = replaySan(INITIAL_FEN, ["e4", "e5", "Qh5", "Nc6", "Bc4", "g6", "Qf3", "Nf6", "Nc3", "Nd4"]);
    assert.equal(
      threatFact({
        fenBefore: g.fens[10] as string,
        lastMove: { uci: uciOf(g.fens[9] as string, "Nd4"), san: "Nd4" },
        moveNo: 6,
        winBefore: 50,
      }),
      "Black’s knight on d4 is eyeing your queen on f3.",
    );
  });

  it("falls back to the Win% bands, and skips the facts without a previous move", () => {
    const at = (w: number) => threatFact({ fenBefore: INITIAL_FEN, lastMove: null, moveNo: 1, winBefore: w });
    assert.equal(at(50), "The position is still close.");
    assert.equal(at(60), "The position is still close.");
    assert.equal(at(61), "You are better here.");
    assert.equal(at(39), "You are under pressure.");
  });
});

describe("why (§8.7)", () => {
  const grades = classifyGame(GAME);
  const why = (ply: number, best: string, reply: string | null) =>
    whySentences({
      fenBefore: fens[ply] as string,
      member: "w",
      playedUci: GAME.replay.uci[ply] as string,
      bestUci: best,
      evalBefore: GAME.evals[ply] as number,
      replyUci: reply,
      code: grades[ply]!.code,
      rule: grades[ply]!.rule,
      loss: grades[ply]!.loss,
      winBefore: grades[ply]!.winBefore,
      winAfter: grades[ply]!.winAfter,
      result: "loss",
      intent: intentOf(fens[ply] as string, best),
    }).map((s) => s.t);

  it("a won piece, the cost of a miss", () => {
    assert.deepEqual(why(36, "f1f5", null), [
      "Rxf5 wins the bishop on f5.",
      "You lose about 30 win% points, so this is a missed chance.",
    ]);
  });

  it("the reply that wins material, the move that decided the game", () => {
    assert.deepEqual(why(40, "c3e2", "c7c6"), [
      "Ne2 challenges the bishop on g3.",
      "After Bxc6, Qxc6 wins material.",
      "You lose about 23 win% points, so this is the move that decided the game.",
    ]);
  });

  it("an inaccuracy, not a disaster", () => {
    assert.deepEqual(why(32, "d1c1", "c4e3"), [
      "Qc1 protects the bishop on e3.",
      "You lose about 10 win% points, so this is an inaccuracy, not a disaster.",
    ]);
  });

  it("a forced mate, doubled pawns and a check", () => {
    // A mate in 2 for the mover: "starts a forced mate in 2".
    const mate = whySentences({
      fenBefore: "6k1/5ppp/8/8/8/8/5PPP/R5K1 w - - 0 1",
      member: "w",
      playedUci: "g1f1",
      bestUci: "a1a8",
      evalBefore: encodeMate("w", 1),
      replyUci: null,
      code: J.MISS,
      rule: "miss",
      loss: 40,
      winBefore: 60,
      winAfter: 55,
      result: "loss",
      intent: intentOf("6k1/5ppp/8/8/8/8/5PPP/R5K1 w - - 0 1", "a1a8"),
    }).map((s) => s.t);
    assert.equal(mate[0], "Ra8# is mate.");
    // 1.e4 e5 2.Nf3 Nc6 3.Bc4 Bc5 4.d3 Nf6 5.Be3?! Bxe3 6.fxe3: the reply Bxe3 leaves doubled e-pawns.
    const g = replaySan(INITIAL_FEN, ["e4", "e5", "Nf3", "Nc6", "Bc4", "Bc5", "d3", "Nf6"]);
    const doubled = whySentences({
      fenBefore: g.fens[8] as string,
      member: "w",
      playedUci: "c1e3",
      bestUci: "c2c3",
      evalBefore: encodeCp(30),
      replyUci: "c5e3",
      code: J.INACCURACY,
      rule: "severity",
      loss: 5.4,
      winBefore: 60,
      winAfter: 47,
      result: "loss",
      intent: intentOf(g.fens[8] as string, "c2c3"),
    }).map((s) => s.t);
    assert.equal(doubled[1], "After Be3, Bxe3 leaves you with doubled pawns.");
    assert.equal(doubled[2], "You lose about 5 win% points, so this is an inaccuracy, not a disaster.");
    const check = whySentences({
      fenBefore: g.fens[8] as string,
      member: "w",
      playedUci: "h2h3",
      bestUci: "e1g1",
      evalBefore: encodeCp(30),
      replyUci: "c5f2",
      code: J.MISTAKE,
      rule: "severity",
      loss: 11,
      winBefore: 60,
      winAfter: 40,
      result: "loss",
      intent: intentOf(g.fens[8] as string, "e1g1"),
    }).map((s) => s.t);
    assert.equal(check[1], "After h3, Bxf2+ gives a check.");
    assert.equal(check[2], "You lose about 11 win% points, so this is a mistake.");
  });

  it("a forced mate let slip", () => {
    const s = whySentences({
      fenBefore: "6k1/5ppp/8/8/8/8/5PPP/R5K1 w - - 0 1",
      member: "w",
      playedUci: "g1f1",
      bestUci: "a1a8",
      evalBefore: encodeMate("w", 1),
      replyUci: null,
      code: J.INACCURACY,
      rule: "mate_lost",
      loss: 2.2,
      winBefore: 100,
      winAfter: 95.3,
      result: "loss",
      intent: intentOf("6k1/5ppp/8/8/8/8/5PPP/R5K1 w - - 0 1", "a1a8"),
    }).map((x) => x.t);
    assert.equal(s.at(-1), "You had a forced mate here and let it slip, so this is an inaccuracy, not a disaster.");
    assert.equal(NO_SECOND, 32767);
  });

  // regression: decided-the-game-needs-a-loss (FIX-1). The blunder sentence claimed "decided the game" from Win%
  // after < 30 alone, so members who went on to win or draw were told their blunder decided the game.
  it("calls a blunder the move that decided the game only for a lost game the move turned", () => {
    const g = grades[40]!;
    assert.equal(g.code, J.BLUNDER);
    const cost = (result: "win" | "loss" | "draw" | null, winBefore = g.winBefore) =>
      whySentences({
        fenBefore: fens[40] as string,
        member: "w",
        playedUci: GAME.replay.uci[40] as string,
        bestUci: "c3e2",
        evalBefore: GAME.evals[40] as number,
        replyUci: null,
        code: g.code,
        rule: g.rule,
        loss: g.loss,
        winBefore,
        winAfter: g.winAfter,
        result,
        intent: intentOf(fens[40] as string, "c3e2"),
      }).at(-1)?.t;
    assert.equal(cost("loss"), "You lose about 23 win% points, so this is the move that decided the game.");
    for (const result of ["win", "draw", null] as const) {
      assert.equal(cost(result), "You lose about 23 win% points, so this is a blunder.", String(result));
    }
    // Already lost before the move (Win% before < 30): this blunder did not decide anything.
    assert.equal(cost("loss", 25), "You lose about 23 win% points, so this is a blunder.");
  });

  // regression: en-passant-square (FIX-1). exd6 e.p. takes the pawn that stands on d5, not on d6.
  it("names the square of the pawn an en-passant capture wins", () => {
    const fen = "4k3/8/8/3pP3/8/8/8/4K3 w - d6 0 2";
    const first = whySentences({
      fenBefore: fen,
      member: "w",
      playedUci: "e1d1",
      bestUci: "e5d6",
      evalBefore: encodeCp(150),
      replyUci: null,
      code: J.MISTAKE,
      rule: "severity",
      loss: 11,
      winBefore: 64,
      winAfter: 53,
      result: null,
      intent: intentOf(fen, "e5d6"),
    })[0]!.t;
    assert.equal(first, "exd6 wins the pawn on d5.");
  });
});

describe("material phrase (§8.7 turning point)", () => {
  // regression: material-phrase-piece-type (FIX-1). The gained piece was looked up by value, so a bishop (3) was
  // always reported as a knight.
  it("names the piece the member took, not the first piece of that value", () => {
    const s = turningPointSentence({
      ply: 0,
      startPly: 0,
      fenBefore: "1r2k3/1b6/8/8/8/8/8/1Q2K3 w - - 0 1",
      member: "w",
      playedUci: "b1b7",
      bestUci: "b1b4",
      replyUci: "b8b7",
      code: J.BLUNDER,
      rule: "severity",
      evalAfter: encodeCp(-700),
    });
    assert.equal(s, "The game turned on move 1, when Qxb7 lost the queen for a bishop.");
    assert.equal(materialPhrase("q", "n"), "the queen for a knight");
    assert.equal(materialPhrase("r", "b"), "the exchange");
    assert.equal(materialPhrase("r", "n"), "the exchange");
    assert.equal(materialPhrase("b", null), "a bishop");
    assert.equal(materialPhrase("n", "p"), "a knight for a pawn");
  });
});

describe("the whole trade, recaptures included (§8.7 turning point and headline)", () => {
  // regression: turning-point-ignores-recapture (FIX-2, review round 2). The phrase named only the piece the reply
  // took and the piece the played move took, not what the member wins back on the reply's square.
  const QUEEN_FOR_N_AND_P = "6k1/8/5n2/3p4/8/8/Q2R4/6K1 w - - 0 1";
  const tp = (fenBefore: string, playedUci: string, replyUci: string) =>
    turningPointSentence({
      ply: 20,
      startPly: 0,
      fenBefore,
      member: "w",
      playedUci,
      bestUci: null,
      replyUci,
      code: J.BLUNDER,
      rule: "severity",
      evalAfter: encodeCp(-500),
    });
  const headline = (fenBefore: string, playedUci: string, replyUci: string) =>
    headlineText({
      isClean: false,
      startPly: 0,
      fillCount: 0,
      legend: null,
      worst: { ply: 20, code: J.BLUNDER, fill: false, fenBefore, playedUci, bestUci: null, replyUci, mateAgainst: false },
    });

  it("Qxd5 Nxd5 Rxd5: the queen for a knight and a pawn", () => {
    const r = replyLoss(QUEEN_FOR_N_AND_P, "a2d5", "f6d5")!;
    assert.equal(r.net, 5);
    assert.deepEqual(r.lostPieces, ["q"]);
    assert.deepEqual(r.gainedPieces, ["p", "n"]);
    assert.equal(tp(QUEEN_FOR_N_AND_P, "a2d5", "f6d5"), "The game turned on move 11, when Qxd5+ lost the queen for a knight and a pawn.");
    assert.equal(headline(QUEEN_FOR_N_AND_P, "a2d5", "f6d5"), "Lost the queen for a knight and a pawn · move 11");
  });

  it("a hung knight taken by a pawn that the member takes back: a knight for a pawn", () => {
    // 1.Nd5?? (the knight walks into …e6xd5) and White retakes with the c-pawn.
    const fen = "4k3/8/4p3/8/8/2N5/2P5/4K3 w - - 0 1";
    const r = replyLoss(fen, "c3d5", "e6d5")!;
    assert.equal(r.net, 3);
    assert.deepEqual(r.lostPieces, ["n"]);
    assert.deepEqual(r.gainedPieces, []);
    // c2 does not reach d5: nothing comes back, so the knight is simply lost.
    assert.equal(tp(fen, "c3d5", "e6d5"), "The game turned on move 11, when Nd5 lost a knight.");
    const back = "4k3/8/4p3/8/2P5/2N5/8/4K3 w - - 0 1";
    const r2 = replyLoss(back, "c3d5", "e6d5")!;
    assert.equal(r2.net, 2);
    assert.deepEqual(r2.gainedPieces, ["p"]);
    assert.equal(tp(back, "c3d5", "e6d5"), "The game turned on move 11, when Nd5 lost a knight for a pawn.");
    assert.equal(headline(back, "c3d5", "e6d5"), "Dropped a knight · move 11");
  });

  it("pieces of the same kind cancel; the exchange keeps its name", () => {
    assert.equal(tradePhrase(["b", "n"], ["b"]), "a knight");
    assert.equal(tradePhrase(["r"], ["b"]), "the exchange");
    assert.equal(tradePhrase(["r"], ["b", "p"]), "a rook for a bishop and a pawn");
    assert.equal(tradePhrase(["q"], ["r", "p", "p"]), "the queen for a rook and two pawns");
    assert.equal(tradePhrase(["n"], ["n"]), null);
    assert.equal(tradePhrase(["k" as never, "p"], []), "a pawn");
  });

  it("seeExchange plays the line see() evaluates", () => {
    const fen = "6k1/8/8/3n4/8/8/3R4/6K1 w - - 0 1"; // Rxd5 wins the knight, nothing recaptures
    assert.deepEqual(seeExchange(fen, "d5"), { value: 3, captures: ["n"] });
    assert.equal(see(fen, "d5"), 3);
    const defended = "6k1/8/4p3/3n4/8/8/3R4/6K1 w - - 0 1"; // …exd5 would follow, a knight for a rook loses
    assert.deepEqual(seeExchange(defended, "d5"), { value: 0, captures: [] });
    assert.equal(see(defended, "d5"), 0);
  });
});
