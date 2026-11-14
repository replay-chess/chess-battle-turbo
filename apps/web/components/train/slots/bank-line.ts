// The game-over Mistake Bank line (phase-05 plan §4.8 "Game-over card", COV C-01, P2 hand-off H-01). Pure (no React,
// no zod): the slot reads A2's `bank` (`qk.review.status(ref)`), written live from `analysis:done.bankAdded` or seeded
// by A2 after a reload.
//
//   "+1 position added to your Mistake Bank (move 13)."
//   "+2 positions added to your Mistake Bank (moves 13, 19)."
//
// Hidden while the analysis is queued or running, when nothing was added (count 0: the count is the BANK cards that
// exist now for this game's moments, so an opt-out in the review lowers it), and when `bank` is null (the `train` flag
// is off, or the worker lost its batch response and A2 has not answered yet).
import type { ReviewStatusDTO } from "@repo/contracts/http/review";
import type { ReviewBank } from "@repo/contracts/http/train";

/** The full-move number of a moment ply (the review's moveNumber: floor((startPly + ply) / 2) + 1). */
export function bankMoveNumber(startPly: number, ply: number): number {
  return Math.floor((startPly + ply) / 2) + 1;
}

/** The line for a non-empty bank, or null. Move numbers are ascending and unique. */
export function bankLineText(bank: ReviewBank | null | undefined, startPly: number): string | null {
  if (!bank || bank.count <= 0) return null;
  const n = bank.count;
  const moves = [...new Set(bank.plies.map((p) => bankMoveNumber(startPly, p)))].sort((a, b) => a - b);
  const what = `+${n} ${n === 1 ? "position" : "positions"} added to your Mistake Bank`;
  if (moves.length === 0) return `${what}.`;
  return `${what} (${moves.length === 1 ? "move" : "moves"} ${moves.join(", ")}).`;
}

/** What the slot shows for a status: the line once the analysis is done and cards exist, else nothing. */
export function bankSlotLine(status: ReviewStatusDTO | undefined, startPly: number): string | null {
  if (!status || status.analysis.status !== "done") return null;
  return bankLineText(status.bank, startPly);
}

/** The telemetry mode of a game (`game_over_bank_line_shown.mode`). */
export function gameOverMode(mode: string): "bot" | "friend" | "online" | "tournament" {
  if (mode === "BOT") return "bot";
  if (mode === "FRIEND") return "friend";
  if (mode === "TOURNAMENT") return "tournament";
  return "online";
}
