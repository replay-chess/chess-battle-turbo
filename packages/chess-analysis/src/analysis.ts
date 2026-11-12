// The whole grading of one finished game from its per-position arrays (phase-03 plan §8.12 steps 6–8): judgements,
// counts, accuracy per colour, the phase division, phase accuracy, `lines` and one review document per member side.
//
// The worker calls this once pass 1 (and pass 2) are done; `regrade.ts` calls the same function with the arrays a
// `game_analyses` row stores. Pure and synchronous: the same arrays always give the same result, so a classifier
// change (a GRADING_VERSION bump) re-grades every stored game without the engine (P3-D28).
//
// `lines` (game_analyses.lines, LinesV1) holds the flagged plies only: every error (INACCURACY and worse), every
// BRILLIANT and GREAT, every key moment, and every ply pass 2 searched (at most ENGINE_PROFILE.pass2.maxPositions a game). The last group is what
// keeps a regrade equal to a fresh grading (P3-D28): the sacrifice check reads the opponent's reply from the pass-2
// PV, so a pass-2 BRILLIANT candidate that came out BEST must keep its PV, or the regrade would fall back to the
// stored best move of the next position and could disagree. Per ply: the best line (`pv`: the pass-2 PV when that ply had pass 2,
// else the pass-1 best move alone; at most LINE_PV_MAX characters of whole moves), the other moves within 2 Win% of
// the best (`alts`, from pass 2) and the Win% loss × 10 (`d`). A ply with no known best move is not stored.

import { gameAccuracy, phaseAccuracy } from "./accuracy";
import { classifyGame, countJudgements, gradeCodes, type PlyGrade } from "./classify";
import { decodeMove, J, type Color } from "./codec";
import type { ComparisonFacts } from "./legend/compare";
import { divide, type Division } from "./divider";
import { pickMoments } from "./moments";
import { replayUci, type Replay } from "./replay";
import { bestMoveOf, buildReviewContent, type LineFacts, type ReviewContent } from "./review";
import type { MemberResult } from "./text/summary";
import { winSeries } from "./winpct";

/** LineV1.pv is ≤ 200 characters. */
export const LINE_PV_MAX = 200;
/** LineV1.d is the Win% loss × 10, an integer in 0 … 1000. */
export const LINE_D_MAX = 1000;

/** One `game_analyses.lines` entry (LinesV1 in packages/db/src/json/review.ts). */
export interface StoredLine {
  pv: string;
  alts: string[];
  d: number;
}

export interface AnalysisMember {
  side: Color;
  result: MemberResult | null;
  /** The member's legend comparison facts (legend games only) and the legend game's year. */
  legend?: { facts: ComparisonFacts; year: number | null } | null;
}

export interface AnalysisInput {
  startFen: string;
  /** games."startPly". */
  startPly: number;
  /** The game's moves, UCI from startFen. */
  moves: readonly string[];
  /** Stored evals of positions 0 … n (White POV); all n + 1 are required. */
  evals: readonly number[];
  /** MultiPV-2 score per position (NO_SECOND = none); missing entries count as none. */
  second: readonly number[];
  /** MoveCode of the best move per position (0 = unknown). */
  best: readonly number[];
  /** Pass-2 facts by ply. */
  lines?: Readonly<Record<number, LineFacts>>;
  /** Book-set membership (book.ts); without it no ply is BOOK. */
  isBook?: (epd: string) => boolean;
  members: readonly AnalysisMember[];
}

export interface AnalysisResult {
  totalPlies: number;
  /** JudgementCode per ply. */
  judgements: number[];
  counts: { w: number[]; b: number[] };
  /** Unrounded; null for a colour that made no move or a game under 3 positions. */
  accuracy: { w: number | null; b: number | null };
  division: Division;
  phaseAccuracy: { w: [number, number, number]; b: [number, number, number] };
  lines: Record<string, StoredLine>;
  reviews: Partial<Record<Color, ReviewContent>>;
}

/** The grades of every ply, with the replay they were computed on (shared by gradeAnalysis and the worker). */
export function gradePlies(input: AnalysisInput): { replay: Replay; grades: PlyGrade[] } {
  const replay = replayUci(input.startFen, input.moves);
  if (input.evals.length !== replay.uci.length + 1) {
    throw new RangeError(`expected ${replay.uci.length + 1} evals, got ${input.evals.length}`);
  }
  const pvs: Record<number, readonly string[]> = {};
  for (const [ply, line] of Object.entries(input.lines ?? {})) pvs[Number(ply)] = line.pv;
  const grades = classifyGame({
    replay,
    evals: input.evals,
    second: input.second,
    best: input.best,
    pvs,
    ...(input.isBook ? { isBook: input.isBook } : {}),
  });
  return { replay, grades };
}

function pvText(pv: readonly string[]): string {
  let s = "";
  for (const m of pv) {
    const next = s === "" ? m : `${s} ${m}`;
    if (next.length > LINE_PV_MAX) break;
    s = next;
  }
  return s;
}

function storedLines(
  input: AnalysisInput,
  grades: readonly PlyGrade[],
  momentPlies: ReadonlySet<number>,
): Record<string, StoredLine> {
  const out: Record<string, StoredLine> = {};
  const lines = input.lines ?? {};
  for (const g of grades) {
    const flagged =
      g.code >= J.INACCURACY ||
      g.code === J.BRILLIANT ||
      g.code === J.GREAT ||
      momentPlies.has(g.ply) ||
      (lines[g.ply]?.pv.length ?? 0) > 0;
    if (!flagged) continue;
    const line = lines[g.ply];
    const best = line?.pv[0] ?? decodeMove(input.best[g.ply] ?? 0);
    if (!best) continue;
    const pv = line?.pv.length ? line.pv : [best];
    out[String(g.ply)] = {
      pv: pvText(pv),
      alts: (line?.accept ?? []).filter((m) => m !== best).slice(0, 3),
      d: Math.min(LINE_D_MAX, Math.max(0, Math.round(g.loss * 10))),
    };
  }
  return out;
}

/** Grades a finished game (see the header). */
export function gradeAnalysis(input: AnalysisInput): AnalysisResult {
  const { replay, grades } = gradePlies(input);
  const judgements = gradeCodes(grades);
  const startMover = replay.startMover;
  const series = winSeries(input.evals);
  const division = divide(replay.fens);
  const accuracy = {
    w: gameAccuracy(series, "w", startMover),
    b: gameAccuracy(series, "b", startMover),
  };
  const phase = {
    w: phaseAccuracy(series, "w", startMover, division),
    b: phaseAccuracy(series, "b", startMover, division),
  };
  const lines = input.lines ?? {};
  const hasBest = (ply: number) => bestMoveOf({ best: input.best, lines }, ply) !== null;
  const momentPlies = new Set<number>();
  const reviews: Partial<Record<Color, ReviewContent>> = {};
  for (const m of input.members) {
    for (const p of pickMoments(grades, m.side, startMover, { hasBest })) momentPlies.add(p.ply);
    reviews[m.side] = buildReviewContent({
      replay,
      startPly: input.startPly,
      evals: input.evals,
      best: input.best,
      grades,
      lines,
      side: m.side,
      result: m.result,
      accuracy,
      phaseAccuracy: phase[m.side],
      division,
      series,
      legend: m.legend ?? null,
    });
  }
  return {
    totalPlies: replay.uci.length,
    judgements,
    counts: countJudgements(judgements, startMover),
    accuracy,
    division,
    phaseAccuracy: phase,
    lines: storedLines(input, grades, momentPlies),
    reviews,
  };
}
