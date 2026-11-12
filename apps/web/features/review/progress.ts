// Analysis progress in moves (phase-03 plan §4.1 "Copy notes": progress counts moves, ceil(gradedPlies / 2) of
// ceil(totalPlies / 2)). Shared by the review screen (model.ts progressOf) and the game-over card, so neither prints
// plies as moves. No imports: the game-over slot is a lazy chunk of the game screen.

/** `movesDone` (at least 1 once there is a game) of `movesTotal`. */
export function movesProgress(gradedPlies: number, totalPlies: number): { movesDone: number; movesTotal: number } {
  const movesTotal = Math.ceil(totalPlies / 2);
  const movesDone = Math.min(movesTotal, Math.max(totalPlies > 0 ? 1 : 0, Math.ceil(gradedPlies / 2)));
  return { movesDone, movesTotal };
}
