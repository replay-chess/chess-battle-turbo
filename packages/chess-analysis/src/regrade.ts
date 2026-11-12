// Engine-free re-grading (phase-03 plan §8.14, P3-D28). When GRADING_VERSION changes (thresholds, rules, templates)
// the worker re-grades a stored analysis from its `game_analyses` arrays alone: `evals`, `second`, `best` and
// `lines`. Nothing here can start an engine: the input is the stored row, the output is what `gradeAnalysis` gives
// for the same arrays, plus which plies changed label.
//
// Pass-2 facts survive a regrade through `lines`: a stored line's `pv` and `alts` become the ply's `LineFacts` again
// (accept = the PV's first move, then the alternatives), so key moments keep their engine line and accept list. A
// moment that only the new classifier picks, on a ply pass 2 never searched, falls back to the pass-1 best move
// alone, exactly as a fresh grading of the same arrays would.
//
// Only an analysis made with the current engine profile can be re-graded (`analysisFreshness` = "current" or
// "regrade"); another profile needs the engine to run again ("rerun"), and `regradeAnalysis` refuses it.

import { gradeAnalysis, type AnalysisMember, type AnalysisResult, type StoredLine } from "./analysis";
import { analysisFreshness, GRADING_VERSION } from "./version";
import type { LineFacts } from "./review";

/** The columns of a `game_analyses` row a regrade reads. */
export interface StoredAnalysisRow {
  version: number;
  engine: string;
  evals: readonly number[];
  second: readonly number[];
  best: readonly number[];
  judgements: readonly number[];
  /** LinesV1 (null = none stored). */
  lines: Readonly<Record<string, StoredLine>> | null;
}

export interface RegradeInput {
  stored: StoredAnalysisRow;
  game: { startFen: string; startPly: number; moves: readonly string[] };
  members: readonly AnalysisMember[];
  isBook?: (epd: string) => boolean;
}

export interface RegradeResult extends AnalysisResult {
  /** The GRADING_VERSION the result was graded with (the row's new `version`). */
  version: number;
  /** Plies whose JudgementCode differs from the stored one. */
  changedPlies: number[];
}

/** LinesV1 → pass-2 facts by ply. */
export function linesFromStored(lines: Readonly<Record<string, StoredLine>> | null): Record<number, LineFacts> {
  const out: Record<number, LineFacts> = {};
  for (const [key, line] of Object.entries(lines ?? {})) {
    const pv = line.pv === "" ? [] : line.pv.split(" ");
    if (pv.length === 0) continue;
    out[Number(key)] = { pv, accept: [pv[0] as string, ...line.alts.filter((m) => m !== pv[0])].slice(0, 3) };
  }
  return out;
}

/** Re-grades a stored analysis with the current classifier (see the header). Throws for another engine profile. */
export function regradeAnalysis(input: RegradeInput): RegradeResult {
  const freshness = analysisFreshness(input.stored);
  if (freshness === "rerun") {
    throw new RangeError(`analysis by ${input.stored.engine} needs the engine to run again, not a regrade`);
  }
  const result = gradeAnalysis({
    startFen: input.game.startFen,
    startPly: input.game.startPly,
    moves: input.game.moves,
    evals: input.stored.evals,
    second: input.stored.second,
    best: input.stored.best,
    lines: linesFromStored(input.stored.lines),
    members: input.members,
    ...(input.isBook ? { isBook: input.isBook } : {}),
  });
  const changedPlies: number[] = [];
  result.judgements.forEach((code, ply) => {
    if (input.stored.judgements[ply] !== code) changedPlies.push(ply);
  });
  return { ...result, version: GRADING_VERSION, changedPlies };
}
