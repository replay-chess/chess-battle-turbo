// One member's review document (phase-03 plan §6.6 `ReviewContentV1`, §8.5–§8.8): key moments with their ask, why,
// plan feedback and line, the narrated summary, the phase line, the archive headline, the clean-game best decision
// and the game-over coach line. Pure: the worker writes the result as `player_reviews.content` (after the zod check
// `buildReviewContent` in packages/db/src/json/review.ts), and a regrade rebuilds it from the stored arrays.
//
// Inputs are the graded game (classify.ts), the stored per-position arrays, the pass-2 facts of the plies that had
// one (`LineFacts`: the principal variation and the accept list, both UCI from the position before the ply), and,
// for a legend game, the member's comparison facts.
//
// A moment's best move is the pass-2 PV's first move when pass 2 ran on that ply, else the stored pass-1 best move;
// its line is the PV trimmed to 3–8 plies (moments.ts trimPv), or the best move alone without pass 2; its accept
// list is the pass-2 MultiPV moves within 2 Win% (best first), or the best move alone.

import type { PlyGrade } from "./classify";
import { decodeMove, evalFor, isMateEval, moveNo, type Color, type JudgementCode } from "./codec";
import { chipFeedback, intentOf, type Intent, type PlanChip } from "./intent";
import { followedLegend, followedToTheEnd, type ComparisonFacts } from "./legend/compare";
import { bestPly, isCleanGame, pickMoments, trimPv, worstMoment, type MomentPick } from "./moments";
import type { Replay } from "./replay";
import { askText } from "./text/ask";
import { bestDecisionText } from "./text/clean";
import { coachLineText } from "./text/coachline";
import { playLine, sentence, type Sentence } from "./text/facts";
import { headlineText } from "./text/headline";
import { phaseLine } from "./text/phase";
import { summarySentences, turningPointSentence, type MemberResult } from "./text/summary";
import { whySentences } from "./text/why";

/** Pass-2 facts of one ply (the position before it): the best line and the moves within 2 Win% of the best. */
export interface LineFacts {
  /** UCI, best move first. */
  pv: string[];
  /** UCI, best first, ≤ 3 (moments.ts acceptMoves). */
  accept: string[];
}

export interface ReviewMoment {
  ply: number;
  judgement: JudgementCode;
  playedUci: string;
  bestUci: string;
  accept: string[];
  pv: string;
  winBefore: number;
  winAfter: number;
  intent: Intent;
  ask: string;
  why: Sentence[];
  plan: Record<PlanChip, string>;
  mistakeRef: string | null;
}

/** The shape of `ReviewContentV1` (packages/db/src/json/review.ts). */
export interface ReviewContent {
  v: 1;
  source: "template";
  summary: Sentence[];
  coachLine: Sentence | null;
  phaseLine: string;
  headline: string | null;
  isClean: boolean;
  bestPly: number | null;
  bestDecision: string | null;
  moments: ReviewMoment[];
}

export interface LegendReviewInput {
  facts: ComparisonFacts;
  /** The legend game's year ("…the way Morphy did in 1858"), when known. */
  year: number | null;
}

export interface ReviewBuildInput {
  replay: Replay;
  /** games."startPly" (absolute ply of the start position). */
  startPly: number;
  /** Stored evals of positions 0 … n (White POV). */
  evals: readonly number[];
  /** MoveCode of the best move per position (0 = unknown). */
  best: readonly number[];
  grades: readonly PlyGrade[];
  lines: Readonly<Record<number, LineFacts>>;
  side: Color;
  result: MemberResult | null;
  /** Game accuracy per colour (unrounded). */
  accuracy: { w: number | null; b: number | null };
  /** The member's phase accuracy (−1 = not reached). */
  phaseAccuracy: readonly number[];
  division: { middlegamePly: number | null; endgamePly: number | null };
  /** White-POV Win% per position. */
  series: readonly number[];
  legend: LegendReviewInput | null;
}

const round1 = (x: number) => Math.round(x * 10) / 10;

function mateAgainst(evalAfter: number, side: Color): boolean {
  const e = evalFor(evalAfter, side);
  return isMateEval(e) && e < 0;
}

/** The stored or pass-2 best move of a ply (UCI), or null when unknown. */
export function bestMoveOf(input: Pick<ReviewBuildInput, "best" | "lines">, ply: number): string | null {
  const line = input.lines[ply];
  if (line && line.pv[0]) return line.pv[0];
  return decodeMove(input.best[ply] ?? 0);
}

function buildMoment(input: ReviewBuildInput, pick: MomentPick, grade: PlyGrade): ReviewMoment {
  const { replay } = input;
  const fenBefore = replay.fens[pick.ply] as string;
  const playedUci = replay.uci[pick.ply] as string;
  const bestUci = bestMoveOf(input, pick.ply);
  if (!bestUci) throw new RangeError(`moment at ply ${pick.ply} has no best move`);
  const line = input.lines[pick.ply];
  const pv = trimPv(fenBefore, line?.pv.length ? line.pv : [bestUci]);
  const legalAccept = (line?.accept ?? []).filter((m) => playLine(fenBefore, [m]).length === 1);
  const accept = [bestUci, ...legalAccept.filter((m) => m !== bestUci)].slice(0, 3);
  const intent = intentOf(fenBefore, bestUci);
  const lastMove =
    pick.ply > 0 ? { uci: replay.uci[pick.ply - 1] as string, san: replay.san[pick.ply - 1] as string } : null;
  const why = whySentences({
    fenBefore,
    member: input.side,
    playedUci,
    bestUci,
    evalBefore: input.evals[pick.ply] as number,
    replyUci: decodeMove(input.best[pick.ply + 1] ?? 0),
    code: grade.code,
    rule: grade.rule,
    loss: grade.loss,
    winBefore: grade.winBefore,
    winAfter: grade.winAfter,
    result: input.result,
    intent,
  });
  return {
    ply: pick.ply,
    judgement: grade.code,
    playedUci,
    bestUci,
    accept,
    pv: (pv.length ? pv : [bestUci]).join(" "),
    winBefore: round1(grade.winBefore),
    winAfter: round1(grade.winAfter),
    intent: intent.intent,
    ask: askText({ fenBefore, lastMove, moveNo: moveNo(pick.ply, input.startPly), winBefore: grade.winBefore }),
    why,
    plan: chipFeedback(intent, why[0]?.t ?? null),
    mistakeRef: null,
  };
}

/** The review document of one member side. */
export function buildReviewContent(input: ReviewBuildInput): ReviewContent {
  const { replay, side } = input;
  const startMover = replay.startMover;
  const hasBest = (ply: number) => bestMoveOf(input, ply) !== null;
  const picks = pickMoments(input.grades, side, startMover, { hasBest });
  const isClean = isCleanGame(input.grades, side, startMover, { hasBest });
  const gradeAt = (ply: number) => input.grades[ply] as PlyGrade;
  const moments = picks.map((p) => buildMoment(input, p, gradeAt(p.ply)));

  const worst = worstMoment(picks);
  const turningPoint = worst
    ? turningPointSentence({
        ply: worst.ply,
        startPly: input.startPly,
        fenBefore: replay.fens[worst.ply] as string,
        member: side,
        playedUci: replay.uci[worst.ply] as string,
        bestUci: bestMoveOf(input, worst.ply),
        replyUci: decodeMove(input.best[worst.ply + 1] ?? 0),
        code: worst.code,
        rule: gradeAt(worst.ply).rule,
        evalAfter: input.evals[worst.ply + 1] as number,
      })
    : null;

  const bp = bestPly(input.grades, side, startMover);
  const bestDecision =
    bp === null
      ? null
      : bestDecisionText({
          ply: bp,
          startPly: input.startPly,
          san: replay.san[bp] as string,
          code: gradeAt(bp).code,
          evalAfter: input.evals[bp + 1] as number,
          member: side,
        });

  const opp: Color = side === "w" ? "b" : "w";
  const summary = summarySentences({
    accuracy: input.accuracy[side],
    oppAccuracy: input.accuracy[opp],
    phaseAccuracy: input.phaseAccuracy,
    turningPoint,
    momentsCount: moments.length,
    isClean,
    result: input.result,
  });

  const facts = input.legend?.facts ?? null;
  const lastPly = replay.uci.length - 1;
  const coach = coachLineText({
    legendFinish:
      facts && input.legend && followedToTheEnd(facts) && lastPly >= 0
        ? {
            name: facts.historicalName,
            year: input.legend.year,
            ply: lastPly,
            startPly: input.startPly,
            san: replay.san[lastPly] as string,
          }
        : null,
    turningPoint,
    isClean,
    bestDecision,
    result: input.result,
  });

  const fills = picks.filter((p) => p.fill).length;
  const headline = headlineText({
    isClean,
    startPly: input.startPly,
    worst: worst
      ? {
          ply: worst.ply,
          code: worst.code,
          fill: worst.fill,
          fenBefore: replay.fens[worst.ply] as string,
          playedUci: replay.uci[worst.ply] as string,
          bestUci: bestMoveOf(input, worst.ply),
          replyUci: decodeMove(input.best[worst.ply + 1] ?? 0),
          mateAgainst: mateAgainst(input.evals[worst.ply + 1] as number, side),
        }
      : null,
    fillCount: fills,
    legend: facts
      ? {
          name: facts.historicalName,
          followed: followedLegend(facts),
          userDivergencePly: facts.divergenceBy === "user" ? facts.divergencePly : null,
        }
      : null,
  });

  return {
    v: 1,
    source: "template",
    summary,
    coachLine: sentence(coach),
    phaseLine: phaseLine({
      series: input.series,
      division: input.division,
      phaseAccuracy: input.phaseAccuracy,
      side,
    }),
    headline,
    isClean,
    bestPly: bp,
    bestDecision,
    moments,
  };
}
