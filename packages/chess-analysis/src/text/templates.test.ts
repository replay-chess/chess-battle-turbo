// Review text snapshots and invariants (phase-03 plan §12.1 `CA/src/text/*.test.ts`, task A5 acceptance):
// deterministic snapshots for GAME and CLEAN, including the coach line (the turning point for GAME, the best decision
// for CLEAN, the legend-followed variant); every SAN in every template is legal at its position; every number traces
// to the arrays; the length limits hold; no emoji and no "!".
//
// The snapshots are the copy the owner reviews (A5): a change to a template shows up here as a diff.
import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { Chess } from "chess.js";
import { loadEdgeFiles, edgeGradeInput } from "../../fixtures/labels/edge";
import { loadOracleGames, oracleBest, oracleEvals, oracleReplay } from "../../fixtures/oracle";
import { REVIEW_INPUTS, fixtureReview } from "../../fixtures/review-inputs";
import { gradeAnalysis, gradePlies, type AnalysisInput } from "../analysis";
import { encodeMove, moveNo } from "../codec";
import { replayUci, type Replay } from "../replay";
import type { ReviewContent, ReviewMoment } from "../review";
import { ASK_MAX } from "./ask";
import { BEST_DECISION_MAX } from "./clean";
import { COACH_LINE_MAX } from "./coachline";
import { HEADLINE_MAX } from "./headline";
import { PHASE_LINE_MAX } from "./phase";

const s = (t: string) => ({ t, v: false });

const GAME_SNAPSHOT: ReviewContent = {
  v: 1,
  source: "template",
  summary: [
    s("You played at 78 accuracy; your opponent at 85."),
    s("Your opening was the strongest part (96)."),
    s("The game turned on move 19, when Qd2 missed Rxf5."),
    s("3 moments are worth a second look."),
  ],
  coachLine: s("The game turned on move 19, when Qd2 missed Rxf5."),
  phaseLine: "Opening solid · middlegame lost the thread · endgame not reached",
  headline: "Missed Rxf5 · move 19",
  isClean: false,
  bestPly: 34,
  bestDecision: "Your best decision: 18.fxe3.",
  moments: [
    {
      ply: 32,
      judgement: 9,
      playedUci: "b2b3",
      bestUci: "d1c1",
      accept: ["d1c1"],
      pv: "d1c1 c4e3 c1e3",
      winBefore: 47.5,
      winAfter: 37.6,
      intent: "defend",
      ask: "Move 17. The position is still close. What would you play?",
      why: [
        s("Qc1 protects the bishop on e3."),
        s("You lose about 10 win% points, so this is an inaccuracy, not a disaster."),
      ],
      plan: {
        attack: "You were thinking: attack. The engine’s idea here was to defend: Qc1 protects the bishop on e3.",
        defend: "Right instinct. Qc1 protects the bishop on e3.",
        trade: "You were thinking: trade. The engine’s idea here was to defend: Qc1 protects the bishop on e3.",
        improve:
          "You were thinking: improve a piece. The engine’s idea here was to defend: Qc1 protects the bishop on e3.",
        unsure: "The engine’s idea here was to defend: Qc1.",
      },
      mistakeRef: null,
    },
    {
      ply: 36,
      judgement: 11,
      playedUci: "d1d2",
      bestUci: "f1f5",
      accept: ["f1f5"],
      pv: "f1f5 g3h2 g1h1",
      winBefore: 74.4,
      winAfter: 44.3,
      intent: "trade",
      ask: "Move 19. Black just played Bg3. Something was available here. What would you play?",
      why: [s("Rxf5 wins the bishop on f5."), s("You lose about 30 win% points, so this is a missed chance.")],
      plan: {
        attack: "You were thinking: attack. The engine’s idea here was to trade: Rxf5 wins the bishop on f5.",
        defend: "You were thinking: defend. The engine’s idea here was to trade: Rxf5 wins the bishop on f5.",
        trade: "Right instinct. Rxf5 wins the bishop on f5.",
        improve: "You were thinking: improve a piece. The engine’s idea here was to trade: Rxf5 wins the bishop on f5.",
        unsure: "The engine’s idea here was to trade: Rxf5.",
      },
      mistakeRef: null,
    },
    {
      ply: 40,
      judgement: 12,
      playedUci: "f3c6",
      bestUci: "c3e2",
      accept: ["c3e2"],
      pv: "c3e2 g3h2 g1h1",
      winBefore: 44,
      winAfter: 20.7,
      intent: "improve",
      ask: "Move 21. The position is still close. What would you play?",
      why: [
        s("Ne2 challenges the bishop on g3."),
        s("After Bxc6, Qxc6 wins material."),
        s("You lose about 23 win% points, so this is the move that decided the game."),
      ],
      plan: {
        attack:
          "You were thinking: attack. The engine’s idea here was to improve a piece: Ne2 challenges the bishop on g3.",
        defend:
          "You were thinking: defend. The engine’s idea here was to improve a piece: Ne2 challenges the bishop on g3.",
        trade:
          "You were thinking: trade. The engine’s idea here was to improve a piece: Ne2 challenges the bishop on g3.",
        improve: "Right instinct. Ne2 challenges the bishop on g3.",
        unsure: "The engine’s idea here was to improve a piece: Ne2.",
      },
      mistakeRef: null,
    },
  ],
};

const CLEAN_SNAPSHOT: ReviewContent = {
  v: 1,
  source: "template",
  summary: [s("You played at 100 accuracy; your opponent at 100."), s("Nothing big to fix in this one.")],
  coachLine: s("Your best decision: 16.Qb8+, a sacrifice that forced mate."),
  phaseLine: "Opening solid · middlegame solid · endgame not reached",
  headline: "Clean game",
  isClean: true,
  bestPly: 30,
  bestDecision: "Your best decision: 16.Qb8+, a sacrifice that forced mate.",
  moments: [],
};

const OPERA_FROM_10_SNAPSHOT: ReviewContent = {
  ...CLEAN_SNAPSHOT,
  coachLine: s("17.Rd8# finished it the way Morphy did in 1858."),
  phaseLine: "Opening not reached · middlegame won it · endgame not reached",
  headline: "Played like Morphy",
  bestPly: 12,
};

describe("review snapshots", () => {
  it("GAME (the design's review: 3 moments, the turning point as the coach line)", () => {
    assert.deepEqual(fixtureReview("GAME"), GAME_SNAPSHOT);
  });

  it("CLEAN (the Opera Game: clean, the best decision as the coach line)", () => {
    assert.deepEqual(fixtureReview("CLEAN"), CLEAN_SNAPSHOT);
  });

  it("the Opera Game from Morphy's position, followed to 17.Rd8# (the legend-followed coach line)", () => {
    assert.deepEqual(fixtureReview("OPERA_FROM_10"), OPERA_FROM_10_SNAPSHOT);
  });

  it("is deterministic", () => {
    assert.deepEqual(fixtureReview("GAME"), fixtureReview("GAME"));
  });
});

// ── Invariants over every review the corpora produce ────────────────────────────────────────────────────────────

const SAN_RE =
  /(?<![\w’'])(?:(\d+)(\.|…))?((?:O-O(?:-O)?|[KQRBN][a-h]?[1-8]?x?[a-h][1-8]|[a-h](?:x[a-h])?[1-8](?:=[QRBN])?)[+#]?)(?![\w%])/g;
const FORBIDDEN = /[!\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}]|\u{FE0F}/u;

function legalIn(fen: string, san: string): boolean {
  try {
    new Chess(fen).move(san);
    return true;
  } catch {
    return false;
  }
}

/**
 * Every SAN-shaped token of `text` must be a legal move: a numbered one ("17.Qc1", "25…Kb6") in the position before
 * that move; an unnumbered one in one of `positions`. Squares after "on " and "to " are squares, not moves.
 */
function assertSansLegal(text: string, replay: Replay, startPly: number, positions: readonly string[], where: string) {
  for (const m of text.matchAll(SAN_RE)) {
    const before = text.slice(Math.max(0, (m.index ?? 0) - 3), m.index);
    if (before.endsWith("on ") || before.endsWith("to ")) continue;
    const [, num, sep, san] = m;
    if (num) {
      const ply = 2 * (Number(num) - 1) + (sep === "…" ? 1 : 0) - startPly;
      const fen = replay.fens[ply];
      assert.ok(
        fen && legalIn(fen, san as string),
        `${where}: ${num}${sep}${san} is not legal at ply ${ply}: "${text}"`,
      );
    } else {
      assert.ok(
        positions.some((p) => legalIn(p, san as string)),
        `${where}: ${san} is not legal at its position: "${text}"`,
      );
    }
  }
}

function afterMove(fen: string, uci: string): string {
  const c = new Chess(fen);
  c.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
  return c.fen();
}

function checkReview(input: AnalysisInput, side: "w" | "b", where: string) {
  const replay = replayUci(input.startFen, input.moves);
  const { grades } = gradePlies(input);
  const result = gradeAnalysis(input);
  const review = result.reviews[side];
  assert.ok(review, `${where}: a review for ${side}`);
  const texts: { t: string; positions: string[]; max: number; label: string }[] = [];
  const all = replay.fens;

  for (const x of review.summary) texts.push({ t: x.t, positions: all, max: 400, label: "summary" });
  if (review.coachLine) texts.push({ t: review.coachLine.t, positions: all, max: COACH_LINE_MAX, label: "coachLine" });
  texts.push({ t: review.phaseLine, positions: [], max: PHASE_LINE_MAX, label: "phaseLine" });
  if (review.headline) texts.push({ t: review.headline, positions: all, max: HEADLINE_MAX, label: "headline" });
  if (review.bestDecision)
    texts.push({ t: review.bestDecision, positions: [], max: BEST_DECISION_MAX, label: "bestDecision" });

  assert.ok(review.summary.length >= 1 && review.summary.length <= 4, `${where}: summary length`);
  assert.ok(review.moments.length <= 3, `${where}: ≤ 3 moments`);
  for (const m of review.moments) {
    const fen = replay.fens[m.ply] as string;
    const afterPlayed = afterMove(fen, m.playedUci);
    // The moment's position, the one after the played move (the reply) and the one before the opponent's last move.
    const positions = [fen, afterPlayed, ...(m.ply > 0 ? [replay.fens[m.ply - 1] as string] : [])];
    texts.push({ t: m.ask, positions, max: ASK_MAX, label: `ask ${m.ply}` });
    for (const w of m.why) texts.push({ t: w.t, positions, max: 400, label: `why ${m.ply}` });
    for (const p of Object.values(m.plan)) texts.push({ t: p, positions, max: 200, label: `plan ${m.ply}` });
    assert.ok(m.why.length >= 1 && m.why.length <= 3, `${where}: why count at ${m.ply}`);
    assert.ok(m.pv.length <= 60, `${where}: pv length`);
    // The line replays from the moment's position, best move first; the accept list is legal and starts with it.
    const line = m.pv.split(" ");
    assert.equal(line[0], m.bestUci);
    const chess = new Chess(fen);
    for (const u of line) chess.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] });
    assert.ok(line.length <= 8);
    assert.equal(m.accept[0], m.bestUci);
    for (const a of m.accept)
      assert.ok(legalIn(fen, new Chess(fen).move({ from: a.slice(0, 2), to: a.slice(2, 4), promotion: a[4] }).san));
    // Numbers trace to the arrays.
    const g = grades[m.ply]!;
    assert.equal(m.judgement, g.code);
    assert.equal(m.winBefore, Math.round(g.winBefore * 10) / 10);
    assert.equal(m.winAfter, Math.round(g.winAfter * 10) / 10);
    assert.equal(m.playedUci, replay.uci[m.ply]);
    const cost = m.why.at(-1)!.t.match(/about (\d+) win% point/);
    if (cost) assert.equal(Number(cost[1]), Math.round(g.loss), `${where}: cost number at ${m.ply}`);
    const askNo = m.ask.match(/^Move (\d+)\./);
    assert.ok(askNo, `${where}: ask starts with the move number`);
    assert.equal(Number(askNo[1]), moveNo(m.ply, input.startPly));
  }

  const acc = review.summary[0]!.t.match(/^You played at (\d+) accuracy(?:; your opponent at (\d+))?\.$/);
  if (acc) {
    const opp = side === "w" ? "b" : "w";
    assert.equal(Number(acc[1]), Math.round(result.accuracy[side] as number), `${where}: accuracy`);
    if (acc[2] !== undefined) assert.equal(Number(acc[2]), Math.round(result.accuracy[opp] as number));
  }
  for (const x of review.summary) {
    const turned = x.t.match(/^The game turned on move (\d+), when (\S+) (?:missed (\S+)\.)?/);
    if (turned) {
      const m: ReviewMoment | undefined = review.moments.find(
        (k) => moveNo(k.ply, input.startPly) === Number(turned[1]),
      );
      assert.ok(m, `${where}: the turning point is one of the moments`);
      const fen = replay.fens[m.ply] as string;
      assert.equal(
        new Chess(fen).move(turned[2] as string).lan,
        m.playedUci,
        `${where}: the turning point names the played move`,
      );
      if (turned[3]) assert.ok(legalIn(fen, turned[3]), `${where}: the missed move is legal at the moment`);
    }
  }
  assert.equal(review.isClean, review.moments.length === 0 || review.isClean);
  if (review.bestPly !== null) assert.ok(review.bestPly >= 0 && review.bestPly < replay.uci.length);

  for (const x of texts) {
    assert.ok(x.t.length > 0 && x.t.length <= x.max, `${where}: ${x.label} length ${x.t.length} > ${x.max}: "${x.t}"`);
    assert.ok(!FORBIDDEN.test(x.t), `${where}: ${x.label} has "!" or an emoji: "${x.t}"`);
    assert.ok(!/\s{2}|\s[.,;]/.test(x.t), `${where}: ${x.label} spacing: "${x.t}"`);
    assert.ok(
      x.label === "phaseLine" || x.label === "headline" || /[.?]$/.test(x.t),
      `${where}: ${x.label} ends a sentence`,
    );
    assertSansLegal(x.t, replay, input.startPly, x.positions, `${where} ${x.label}`);
  }
}

describe("review invariants", () => {
  for (const name of Object.keys(REVIEW_INPUTS) as (keyof typeof REVIEW_INPUTS)[]) {
    it(`${name}: SANs legal, numbers traced, limits held`, () => {
      const input = REVIEW_INPUTS[name]();
      for (const m of input.members) checkReview(input, m.side, name);
    });
  }

  it("the 30 oracle games, both sides as members", () => {
    let moments = 0;
    for (const g of loadOracleGames()) {
      const replay = oracleReplay(g);
      const evals = oracleEvals(g);
      // Lichess publishes no eval for a final checkmate position; grade the plies it does cover.
      const input: AnalysisInput = {
        startFen: replay.startFen,
        startPly: 0,
        moves: replay.uci.slice(0, evals.length - 1),
        evals,
        second: [],
        best: oracleBest(g, replay),
        members: [
          { side: "w", result: null },
          { side: "b", result: null },
        ],
      };
      for (const side of ["w", "b"] as const) {
        checkReview(input, side, `${g.id}/${side}`);
        moments += gradeAnalysis(input).reviews[side]!.moments.length;
      }
    }
    assert.ok(moments >= 60, `the oracle games produce moments to check (${moments})`);
  });

  it("a promotion inside a key moment (§12.4): the missed e8=Q+ is taught with its SAN and UCI", () => {
    // White to move wins with e8=Q+; Kd1 lets the rook stop the pawn (constructed evals: +900 → 0).
    const input: AnalysisInput = {
      startFen: "k7/4P3/8/8/8/8/6r1/4K3 w - - 0 1",
      startPly: 0,
      moves: ["e1d1", "g2e2", "d1c1"],
      evals: [900, 0, 0, 0],
      second: [],
      best: [encodeMove("e7e8q"), encodeMove("g2e2"), encodeMove("e2e7")],
      members: [{ side: "w", result: "draw" }],
    };
    checkReview(input, "w", "promotion");
    const review = gradeAnalysis(input).reviews.w!;
    assert.equal(review.moments.length, 1);
    const m = review.moments[0]!;
    assert.deepEqual([m.ply, m.bestUci, m.pv, m.accept], [0, "e7e8q", "e7e8q", ["e7e8q"]]);
    assert.equal(m.why[0]?.t, "e8=Q+ gives check.");
    assert.equal(m.ask, "Move 1. You are better here. What would you play?");
    assert.equal(review.headline, "Blunder · move 1");
  });

  it("the edge games (mates, promotions, FEN starts, stalemate and threefold endings)", () => {
    for (const f of loadEdgeFiles()) {
      for (const game of f.games) {
        const g = edgeGradeInput(game);
        const input: AnalysisInput = {
          startFen: g.replay.startFen,
          startPly: 0,
          moves: g.replay.uci,
          evals: g.evals,
          second: g.second ?? [],
          best: g.best ?? [],
          ...(g.isBook ? { isBook: g.isBook } : {}),
          members: [
            { side: "w", result: "draw" },
            { side: "b", result: "draw" },
          ],
        };
        for (const side of ["w", "b"] as const) checkReview(input, side, `${f.name}/${game.id}/${side}`);
      }
    }
  });
});
