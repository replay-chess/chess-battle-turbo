// The summary's pure rules (phase-05 plan §4.7, §5.2 S7): the saving state, the stat tiles and the grade bars.
import type { GradeRow, SessionSummary } from "@repo/contracts/http/train";

/** R3 refetches while saving (§5.2 S7: every 1 s, up to 5 times). */
export const SAVING_POLLS = 5;
export const SAVING_POLL_MS = 1_000;

export type SavingState = "none" | "saving" | "partial";

/** Saving while the server holds fewer attempts than the device graded, until the polls run out. */
export function savingState(summary: SessionSummary, clientGraded: number | null, polls: number): SavingState {
  if (clientGraded === null || summary.graded >= clientGraded) return "none";
  return polls < SAVING_POLLS ? "saving" : "partial";
}

export type Tile = { id: string; value: string; label: string };

export function statTiles(s: SessionSummary): Tile[] {
  const tiles: Tile[] = [
    { id: "solved", value: `${s.stats.solved} / ${s.stats.total}`, label: "Solved" },
    { id: "first-try", value: String(s.stats.firstTry), label: "First try" },
    { id: "hints", value: String(s.stats.withHint), label: s.variant === "perfect" ? "Hints" : "With a hint" },
  ];
  if (s.stats.skipped > 0) tiles.push({ id: "skipped", value: String(s.stats.skipped), label: "Skipped" });
  return tiles;
}

export function barWidth(n: number, rows: readonly GradeRow[]): number {
  const most = Math.max(3, ...rows.map((r) => r.n));
  return Math.round((n / most) * 90);
}

