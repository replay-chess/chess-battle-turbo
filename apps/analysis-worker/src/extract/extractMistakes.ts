// Mistake Bank extraction for one game (phase-05 plan §8.1, §7.6 J1; owner decisions D-1, D-9). The extraction itself
// lives in @repo/chess-training/extract, shared with the web's A6 switch (a moment added to the bank of a game side that
// was never extracted); this module binds the worker's pieces: JobAborted stops a line extension instead of keeping the
// puzzle's first move, and `mistakes."referenceId"` comes from @repo/db's newGameRef.
import {
  buildBankPlan as buildSharedBankPlan,
  type BankPlan,
  type ExtractDeps as SharedExtractDeps,
  type ExtractInput,
  type ExtractSource,
} from "@repo/chess-training/extract";
import { newGameRef } from "@repo/db/games";
import { JobAborted } from "../jobs/types";

export {
  ACCEPT_MATES_MAX,
  ACCEPT_MAX,
  acceptOf,
  bestAt,
  pgTimestamp,
  UNKNOWN_OPPONENT,
  type BankPlan,
  type ExtractInput,
  type ExtractMember,
  type ExtractSource,
  type MemberSummary,
} from "@repo/chess-training/extract";

/** The worker's extraction deps: the engine searches (null = no engine) and the line-error hook. */
export type ExtractDeps = Omit<SharedExtractDeps, "isAbort" | "newRef">;

/** The extraction of every given member side (see @repo/chess-training/extract). */
export function buildBankPlan(input: ExtractInput, deps: ExtractDeps, meta: { source: ExtractSource; clockMs: () => number }): Promise<BankPlan> {
  return buildSharedBankPlan(input, { ...deps, isAbort: (error) => error instanceof JobAborted, newRef: newGameRef }, meta);
}
