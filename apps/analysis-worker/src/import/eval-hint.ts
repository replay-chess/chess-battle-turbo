// Lichess evaluations as pass 1 (phase-04 plan §8.7 `evalHint`, §8.9 last line; R-LI-08; interface check §0.7).
// An imported Lichess game whose export carried a server analysis for EVERY ply comes with
// `AnalyzeGamePayloadV1.evalHint = {source: "lichess", cp}`: one White-POV eval per position after each ply, in P3's
// stored encoding (cp clamped ±9999, mate = sign · (30000 − n)). The analysis then skips pass 1's engine searches:
//
//   - position 0 (the start, before any ply) is the one value the hint lacks: it is evaluated as usual (the eval
//     cache answers it for the standard start);
//   - positions 1..n take the hint, except a terminal position, which keeps P3's own terminal value (mate 0 / draw);
//   - `second` and `best` are unknown there (NO_SECOND, MOVE_UNKNOWN): the grader then calls a 0-loss move BEST and
//     never GREAT, and checks no sacrifice without a reply, exactly as for any position it has no line for;
//   - pass 2 runs as usual on its ≤ 6 candidate positions (the key moments and brilliant candidates), whose engine
//     results overwrite the hinted values there.
//
// `game_analyses."evalSource"` records where the stored evals came from: LICHESS when pass 2 searched nothing (every
// graded value is Lichess's), MIXED when pass 2 replaced some, ENGINE for every analysis without a hint. A hint that
// does not cover the game exactly (another length, or a run that resumes from a checkpoint) is ignored.
import { MOVE_UNKNOWN, NO_SECOND } from "@repo/chess-analysis/codec";
import type { EvalHint } from "@repo/contracts/internal/jobs";

export type EvalSourceDb = "ENGINE" | "LICHESS" | "MIXED";

/** The hint's values for positions 1..plies, or null when the hint cannot stand in for pass 1. */
export function usableHint(hint: EvalHint | undefined, plies: number, resumedFrom: number): readonly number[] | null {
  if (!hint || hint.source !== "lichess" || resumedFrom > 0 || plies === 0) return null;
  return hint.cp.length === plies ? hint.cp : null;
}

export interface HintedArrays {
  evals: number[];
  second: number[];
  best: number[];
}

/**
 * Pass 1 from the hint: `start` is the searched position 0, `terminal[i]` P3's stored value of a terminal position
 * (else null).
 */
export function hintedPass1(
  cp: readonly number[],
  start: { eval: number; second: number; best: number },
  terminal: readonly (number | null)[],
): HintedArrays {
  const evals = [start.eval];
  const second = [start.second];
  const best = [start.best];
  for (let i = 1; i <= cp.length; i++) {
    evals.push(terminal[i] ?? cp[i - 1]!);
    second.push(NO_SECOND);
    best.push(MOVE_UNKNOWN);
  }
  return { evals, second, best };
}

/** Where the stored evals of an analysis came from. */
export function evalSourceOf(hinted: boolean, pass2Searched: number): EvalSourceDb {
  if (!hinted) return "ENGINE";
  return pass2Searched > 0 ? "MIXED" : "LICHESS";
}
