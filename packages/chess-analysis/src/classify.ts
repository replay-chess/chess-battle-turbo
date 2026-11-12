// Move classification, GRADING_VERSION 1 (phase-03 plan §8.4; RES §4.3; first matching rule wins).
//
// Runs on stored data only (evals, second, best, the replay, optional pass-2 PVs), so a regrade never needs the
// engine (P3-D28). All Win% values are from the mover's point of view.
//
//  1 FORCED      the position had exactly one legal move
//  2 BOOK        initial start, ply < 30, the resulting EPD is in the book set, and every earlier ply's resulting
//                EPD was too (the chain is on book membership, so a forced move inside theory keeps it; see below)
//  3 mate rules  MateCreated (no mate score before; the mover is being mated after):
//                    cpBefore < −999 → INACCURACY; < −700 → MISTAKE; else BLUNDER
//                MateLost (the mover had a forced mate; no longer has one):
//                    the mover is now being mated → BLUNDER; else cpAfter > 999 → INACCURACY; > 700 → MISTAKE;
//                    else BLUNDER
//                MateDelayed (a mate for the mover before and after) → no negative label; skip to rule 6
//  4 severity    d ≥ 15 → BLUNDER; d ≥ 10 → MISTAKE; d ≥ 5 → INACCURACY        (d = max(0, Wb − Wa); ≥, R-CLS-03)
//  5 MISS        replaces a MISTAKE or BLUNDER from 3–4 when the opponent's previous ply lost ≥ 10 AND (the mover had
//                a mate at position i, OR cpBefore ≥ 200 AND wc(before) > wc(before the opponent's ply) + 0.6)
//  6 positive    only when nothing above matched and d < 5:
//                BRILLIANT d ≤ 2, Wa ≥ 50, sacrifice(i), and cpBefore ≤ +300 OR the move forces mate (see below)
//                GREAT     played = best, a second move exists, Wbest − Wsecond ≥ 10, the outcome class drops
//                          (< 30 lose, < 70 hold, ≥ 70 win), and 10 ≤ Wb ≤ 90
//                BEST      played = best (or d < 0.5 when the best move is unknown, e.g. Lichess-eval imports)
//                EXCELLENT d ≤ 2
//                GOOD      2 < d < 5
//    INTERESTING is never emitted in GRADING_VERSION 1 (P3-D15).
//
// sacrifice(i): the opponent's reply (the pass-2 PV's second move when the PV starts with the played move, else the
// stored best move of position i + 1) is a capture, and after it the mover's material balance (1/3/3/5/9), plus
// whatever the mover wins back by a static exchange on the capture square (see.ts), is at least 2 below the balance
// before the move. The exchange term keeps a plain trade (Nxd5 Nxd5 Bxd5) from counting as a sacrifice.
//
// Decisions where the plan's text and its own fixtures disagree (each one recorded with its numbers in
// `fixtures/labels/design-mock.ts`):
// - BRILLIANT and mate. §8.4 lists `16.Qb8+` of the Opera Game (CLEAN ply 30) as BRILLIANT and tests "not BRILLIANT
//   when cpBefore > +300", but the position before 16.Qb8+ is already a forced mate (mock eval +880), so the literal
//   rule could never give a mating sacrifice BRILLIANT, and the best-decision template "{…}, a sacrifice that forced
//   mate" (§8.6) could never be produced. Resolution: the +300 "not already winning" guard applies to centipawn
//   evaluations; a sacrifice after which the mover has a forced mate (evalAfter is a mate score for the mover) is
//   exempt. A non-mating sacrifice at cpBefore > +300 is still not BRILLIANT.
// - GREAT keeps 10 ≤ Wb ≤ 90 exactly as written. The plan expects CLEAN `26.Rd1` (mock eval +680 before it, so
//   Wb = 92.4) to come out GREAT; with the rule as written it is BEST. Relaxing the guard would change the How we
//   grade numbers, so the fixture records Rd1 as a documented difference instead and GREAT is covered by the edge
//   fixtures (a gap ≥ 10 with an outcome-class change inside the 10–90 band).
// - BOOK chain on membership, not on the label: "every earlier ply is BOOK" would let a single forced reply inside
//   opening theory end the book; the chain therefore follows "every earlier resulting EPD is in the book set".

import type { Color, JudgementCode } from "./codec";
import { J, JUDGEMENT_COUNT_SLOTS, decodeMove, evalFor, hasSecond, isMateEval, moverAt, NO_SECOND } from "./codec";
import { isInitialPosition, materialBalance } from "./board";
import type { Replay } from "./replay";
import { see } from "./see";
import { ENGINE_PROFILE } from "./version";
import { winningChances, winPct } from "./winpct";
import { Chess } from "chess.js";

/** Win% loss thresholds (rule 4; ≥). */
export const SEVERITY = { INACCURACY: 5, MISTAKE: 10, BLUNDER: 15 } as const;
/** Mate-rule centipawn thresholds (rule 3, before clamping). */
export const MATE_RULE_CP = { INACCURACY: 999, MISTAKE: 700 } as const;
/** MISS (rule 5). */
export const MISS_RULE = { OPP_MIN_LOSS: 10, MIN_CP: 200, MIN_WC_GAIN: 0.6 } as const;
/** BRILLIANT (rule 6). */
export const BRILLIANT_RULE = { MAX_LOSS: 2, MIN_WIN_AFTER: 50, MAX_CP_BEFORE: 300, MIN_MATERIAL_DROP: 2 } as const;
/** GREAT (rule 6). */
export const GREAT_RULE = { MIN_GAP: 10, MIN_WIN_BEFORE: 10, MAX_WIN_BEFORE: 90 } as const;
/** Outcome classes of GREAT: below 30 lose, below 70 hold, else win. */
export const OUTCOME_CLASS = { HOLD_FROM: 30, WIN_FROM: 70 } as const;
/** EXCELLENT up to this loss; GOOD above it and below SEVERITY.INACCURACY. */
export const EXCELLENT_MAX_LOSS = 2;
/** BEST without a known best move: loss below this. */
export const BEST_UNKNOWN_MAX_LOSS = 0.5;

/** Which rule produced a label (for reason texts and debugging). */
export type GradeRule =
  | "forced"
  | "book"
  | "mate_created"
  | "mate_lost"
  | "severity"
  | "miss"
  | "brilliant"
  | "great"
  | "best"
  | "excellent"
  | "good";

/** Everything rule 1–6 read for one ply. Evals are stored values (White POV); see codec.ts. */
export interface PlyContext {
  ply: number;
  mover: Color;
  fenBefore: string;
  /** UCI of the played move. */
  played: string;
  /** Legal moves in the position before the ply. */
  legalCount: number;
  evalBefore: number;
  evalAfter: number;
  /** MultiPV-2 score of the position before the ply, or NO_SECOND. */
  second: number;
  /** UCI of the engine's best move in the position before the ply, or null when unknown. */
  best: string | null;
  /** The opponent's reply used by the sacrifice check, or null when unknown (no sacrifice then). */
  reply: string | null;
  /** Rule 2 already evaluated (initial start, ply < 30, the book chain). */
  book: boolean;
  /** The opponent's previous ply, when there is one: its loss d and the eval before it (stored, White POV). */
  oppPrev: { loss: number; evalBefore: number } | null;
}

export interface PlyGrade {
  ply: number;
  code: JudgementCode;
  /** The label without the MISS replacement (what a grader without MISS would say). */
  base: JudgementCode;
  rule: GradeRule;
  /** Mover's Win% before and after, and the loss d = max(0, Wb − Wa). */
  winBefore: number;
  winAfter: number;
  loss: number;
}

function outcomeClass(w: number): 0 | 1 | 2 {
  return w < OUTCOME_CLASS.HOLD_FROM ? 0 : w < OUTCOME_CLASS.WIN_FROM ? 1 : 2;
}

/** The mover's Win% loss of a ply from its stored before/after evals. */
export function plyLoss(evalBefore: number, evalAfter: number, mover: Color): number {
  return Math.max(0, winPct(evalFor(evalBefore, mover)) - winPct(evalFor(evalAfter, mover)));
}

/**
 * sacrifice(i) (see the header): the reply captures, and the mover's balance after it plus what the mover wins
 * back on that square is at least MIN_MATERIAL_DROP below the balance before the move.
 */
export function isSacrifice(fenBefore: string, played: string, reply: string | null): boolean {
  if (!reply) return false;
  const chess = new Chess(fenBefore);
  const mover = chess.turn();
  const before = materialBalance(fenBefore, mover);
  try {
    chess.move({ from: played.slice(0, 2), to: played.slice(2, 4), promotion: played[4] });
    const r = chess.move({ from: reply.slice(0, 2), to: reply.slice(2, 4), promotion: reply[4] });
    if (!r.isCapture()) return false;
  } catch {
    return false; // a reply that is not legal after the played move (stale PV) proves nothing
  }
  const fenAfter = chess.fen();
  const after = materialBalance(fenAfter, mover) + see(fenAfter, reply.slice(2, 4));
  return after <= before - BRILLIANT_RULE.MIN_MATERIAL_DROP;
}

/** Rule 4 alone: the severity label of a Win% loss (≥ each threshold), or null below 5. */
export function severityOf(loss: number): JudgementCode | null {
  if (loss >= SEVERITY.BLUNDER) return J.BLUNDER;
  if (loss >= SEVERITY.MISTAKE) return J.MISTAKE;
  if (loss >= SEVERITY.INACCURACY) return J.INACCURACY;
  return null;
}

/** Classifies one ply (rules 1–6). */
export function classifyPly(c: PlyContext): PlyGrade {
  const before = evalFor(c.evalBefore, c.mover);
  const after = evalFor(c.evalAfter, c.mover);
  const winBefore = winPct(before);
  const winAfter = winPct(after);
  const loss = Math.max(0, winBefore - winAfter);
  const grade = (code: JudgementCode, rule: GradeRule, base: JudgementCode = code): PlyGrade => ({
    ply: c.ply,
    code,
    base,
    rule,
    winBefore,
    winAfter,
    loss,
  });

  // 1, 2
  if (c.legalCount === 1) return grade(J.FORCED, "forced");
  if (c.book) return grade(J.BOOK, "book");

  // 3, 4
  const mateBefore = isMateEval(before);
  const mateAfter = isMateEval(after);
  const hadMate = mateBefore && before > 0;
  const keepsMate = mateAfter && after > 0;
  let negative: { code: JudgementCode; rule: GradeRule } | null = null;
  if (!mateBefore && mateAfter && after < 0) {
    const code =
      before < -MATE_RULE_CP.INACCURACY ? J.INACCURACY : before < -MATE_RULE_CP.MISTAKE ? J.MISTAKE : J.BLUNDER;
    negative = { code, rule: "mate_created" };
  } else if (hadMate && !keepsMate) {
    const code = mateAfter
      ? J.BLUNDER
      : after > MATE_RULE_CP.INACCURACY
        ? J.INACCURACY
        : after > MATE_RULE_CP.MISTAKE
          ? J.MISTAKE
          : J.BLUNDER;
    negative = { code, rule: "mate_lost" };
  } else if (!(hadMate && keepsMate)) {
    const code = severityOf(loss);
    if (code !== null) negative = { code, rule: "severity" };
  }

  // 5
  if (negative) {
    if (
      (negative.code === J.MISTAKE || negative.code === J.BLUNDER) &&
      c.oppPrev &&
      c.oppPrev.loss >= MISS_RULE.OPP_MIN_LOSS
    ) {
      const prevBefore = evalFor(c.oppPrev.evalBefore, c.mover);
      const chance =
        hadMate ||
        (!mateBefore &&
          before >= MISS_RULE.MIN_CP &&
          winningChances(before) > winningChances(prevBefore) + MISS_RULE.MIN_WC_GAIN);
      if (chance) return grade(J.MISS, "miss", negative.code);
    }
    return grade(negative.code, negative.rule);
  }

  // 6: reached only with loss < 5 (severityOf() labels every larger loss; a delayed mate loses nothing, both sides
  // of it count as ±1000 cp).
  const forcesMate = mateAfter && after > 0;
  if (
    loss <= BRILLIANT_RULE.MAX_LOSS &&
    winAfter >= BRILLIANT_RULE.MIN_WIN_AFTER &&
    ((!mateBefore && before <= BRILLIANT_RULE.MAX_CP_BEFORE) || forcesMate) &&
    isSacrifice(c.fenBefore, c.played, c.reply)
  ) {
    return grade(J.BRILLIANT, "brilliant");
  }
  const playedBest = c.best !== null && c.played === c.best;
  if (playedBest && hasSecond(c.second)) {
    const wBest = winBefore;
    const wSecond = winPct(evalFor(c.second, c.mover));
    if (
      wBest - wSecond >= GREAT_RULE.MIN_GAP &&
      outcomeClass(wBest) > outcomeClass(wSecond) &&
      winBefore >= GREAT_RULE.MIN_WIN_BEFORE &&
      winBefore <= GREAT_RULE.MAX_WIN_BEFORE
    ) {
      return grade(J.GREAT, "great");
    }
  }
  if (playedBest || (c.best === null && loss < BEST_UNKNOWN_MAX_LOSS)) return grade(J.BEST, "best");
  if (loss <= EXCELLENT_MAX_LOSS) return grade(J.EXCELLENT, "excellent");
  return grade(J.GOOD, "good");
}

export interface GradeGameInput {
  replay: Replay;
  /** Stored evals of positions 0 … k (White POV); plies 0 … k − 1 are graded. */
  evals: readonly number[];
  /** MultiPV-2 score per position; missing entries count as NO_SECOND. */
  second?: readonly number[];
  /** MoveCode of the best move per position; missing entries and 0 are unknown. */
  best?: readonly number[];
  /** Pass-2 principal variations by ply (UCI from the position before that ply), e.g. `lines[ply].pv`. */
  pvs?: Readonly<Record<number, readonly string[]>>;
  /** Book-set membership of an EPD (book.ts). Without it no ply is BOOK. */
  isBook?: (epd: string) => boolean;
}

function bestAt(best: readonly number[] | undefined, i: number): string | null {
  const code = best?.[i];
  return code === undefined ? null : decodeMove(code);
}

/**
 * Grades every ply whose after-eval is known (plies 0 … evals.length − 2, at most the game's length). Pure: the
 * same arrays always give the same grades, which is what makes regrades engine-free.
 */
export function classifyGame(input: GradeGameInput): PlyGrade[] {
  const { replay, evals } = input;
  const n = Math.min(replay.uci.length, evals.length - 1);
  const initial = isInitialPosition(replay.startFen);
  const out: PlyGrade[] = [];
  let bookChain = initial && input.isBook !== undefined;
  for (let i = 0; i < n; i++) {
    const mover = moverAt(i, replay.startMover);
    const played = replay.uci[i] as string;
    bookChain =
      bookChain &&
      i < ENGINE_PROFILE.bookMaxPly &&
      (input.isBook as (epd: string) => boolean)(replay.epds[i + 1] as string);
    const pv = input.pvs?.[i];
    const reply = pv && pv[0] === played && pv[1] ? pv[1] : bestAt(input.best, i + 1);
    const prev = out[i - 1];
    out.push(
      classifyPly({
        ply: i,
        mover,
        fenBefore: replay.fens[i] as string,
        played,
        legalCount: replay.legal[i] as number,
        evalBefore: evals[i] as number,
        evalAfter: evals[i + 1] as number,
        second: input.second?.[i] ?? NO_SECOND,
        best: bestAt(input.best, i),
        reply,
        book: bookChain,
        oppPrev: prev ? { loss: prev.loss, evalBefore: evals[i - 1] as number } : null,
      }),
    );
  }
  return out;
}

/** JudgementCode per ply. */
export function gradeCodes(grades: readonly PlyGrade[]): JudgementCode[] {
  return grades.map((g) => g.code);
}

/** 13 counters per side, index = JudgementCode ([0] unused): `game_analyses.countsWhite/countsBlack`. */
export function countJudgements(codes: readonly number[], startMover: Color): { w: number[]; b: number[] } {
  const w = new Array<number>(JUDGEMENT_COUNT_SLOTS).fill(0);
  const b = new Array<number>(JUDGEMENT_COUNT_SLOTS).fill(0);
  codes.forEach((code, i) => {
    if (code === J.UNGRADED) return;
    const side = moverAt(i, startMover) === "w" ? w : b;
    side[code] = (side[code] as number) + 1;
  });
  return { w, b };
}
