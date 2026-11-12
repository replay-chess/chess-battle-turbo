// Grading inputs for the review-text snapshots, the regrade test and the seeds (phase-03 plan §12.1 `text/*.test.ts`,
// `regrade.test.ts`; WP-B's review seed may use them to write what the worker would write).
//
// - GAME: the design mock (labels/design-mock.ts), member White (lost), with the design's three moment lines as the
//   pass-2 facts of plies 32, 36 and 40 (accept = the best move alone: the mock gives no MultiPV-3 data).
// - CLEAN: the Opera Game mock, member White (won).
// - OPERA_FROM_10: the same Opera Game played as a legend game from Morphy's position before 10.Nxb5 (the seed's
//   legend position), member White following Morphy to 17.Rd8#, with the comparison facts of the `followed` legend
//   fixture: the "legend-followed" coach line and headline.

import { gradeAnalysis, type AnalysisInput } from "../src/analysis";
import { INITIAL_FEN } from "../src/board";
import { replaySan } from "../src/replay";
import type { LineFacts } from "../src/review";
import { GAME_MOMENTS, mockGradeInput } from "./labels/design-mock";
import { legendFixture, legendFixtureFacts } from "./legend";

function lineFacts(fen: string, sans: readonly string[]): LineFacts {
  const pv = replaySan(fen, sans).uci;
  return { pv, accept: [pv[0] as string] };
}

export function gameAnalysisInput(): AnalysisInput {
  const g = mockGradeInput("GAME");
  const lines: Record<number, LineFacts> = {};
  for (const m of GAME_MOMENTS) lines[m.ply] = lineFacts(g.replay.fens[m.ply] as string, m.line);
  return {
    startFen: INITIAL_FEN,
    startPly: 0,
    moves: g.replay.uci,
    evals: g.evals,
    second: g.second ?? [],
    best: g.best ?? [],
    lines,
    ...(g.isBook ? { isBook: g.isBook } : {}),
    members: [{ side: "w", result: "loss" }],
  };
}

export function cleanAnalysisInput(): AnalysisInput {
  const g = mockGradeInput("CLEAN");
  return {
    startFen: INITIAL_FEN,
    startPly: 0,
    moves: g.replay.uci,
    evals: g.evals,
    second: g.second ?? [],
    best: g.best ?? [],
    ...(g.isBook ? { isBook: g.isBook } : {}),
    members: [{ side: "w", result: "win" }],
  };
}

/** The Opera mock from ply 18 (Morphy's position before 10.Nxb5), as a legend game the member followed. */
export function operaFrom10AnalysisInput(): AnalysisInput {
  const g = mockGradeInput("CLEAN");
  const from = 18;
  const fixture = legendFixture("followed");
  return {
    startFen: g.replay.fens[from] as string,
    startPly: from,
    moves: g.replay.uci.slice(from),
    evals: g.evals.slice(from),
    second: (g.second ?? []).slice(from),
    best: (g.best ?? []).slice(from),
    members: [{ side: "w", result: "win", legend: { facts: legendFixtureFacts(fixture), year: fixture.year } }],
  };
}

export const REVIEW_INPUTS = {
  GAME: gameAnalysisInput,
  CLEAN: cleanAnalysisInput,
  OPERA_FROM_10: operaFrom10AnalysisInput,
} as const;

/** The review document the worker would write for a fixture's member (White). */
export function fixtureReview(name: keyof typeof REVIEW_INPUTS) {
  const review = gradeAnalysis(REVIEW_INPUTS[name]()).reviews.w;
  if (!review) throw new Error(`no review for ${name}`);
  return review;
}
