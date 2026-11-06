// Study phase length (plan 8.2, owner Q1): 30 s when the start position is not the initial one, else 0. Decided by
// the web at creation and stored in Game.studySeconds, so a policy change never affects games already created.
// Same rule as @repo/db/src/games/derive.ts (which keeps its own copy so the DB layer stays rules-free).

import { INITIAL_FEN, STUDY_SECONDS_NON_INITIAL } from "../constants";

/** Placement, side, castling and en passant: the move counters do not make a position non-initial. */
const positionPart = (fen: string) => fen.trim().split(/\s+/).slice(0, 4).join(" ");

export function studySecondsFor(startFen: string): number {
  return positionPart(startFen) === positionPart(INITIAL_FEN) ? 0 : STUDY_SECONDS_NON_INITIAL;
}
