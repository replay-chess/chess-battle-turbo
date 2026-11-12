// Review screen copy (phase-03 plan §4.1 "States and transitions", "Copy notes"; boards V3Review*, V3iPhoneReview,
// V3iPadLReview, V3iPadPReview). P1 rules: Title Case on buttons, tabs and menu items; sentence case for descriptions,
// statuses and toasts; every number in a string is computed, never typed. Pure strings only: no React, no zod.
import type { AnalysisStatusWire } from "@repo/contracts/http/review";

export const BUTTONS = {
  retry: "Retry Analysis",
  whatHappened: "What Happened?",
  reportProblem: "Report a Problem",
  backToGames: "Back to My Games",
  startReview: (moments: number) => `Start Review · ${moments} ${moments === 1 ? "Moment" : "Moments"}`,
  seeBestMove: "See Your Best Move",
  done: "Done",
  tryAgain: "Try Again",
  first: "First Move",
  prev: "Previous Move",
  next: "Next Move",
  last: "Last Move",
  more: "More Options",
  flip: "Flip Board",
  share: "Share Analysis",
  downloadPgn: "Download PGN",
  compareWith: (legend: string) => `Compare with ${legend}`,
  howWeGrade: "How We Grade Moves",
  backToSummary: "Back to the Summary",
  backToGame: "Back to the Game",
  coachTab: "Coach",
  movesTab: "Moves",
  listen: "Listen to the Coach",
  pause: "Pause the Coach",
  resume: "Resume the Coach",
} as const;

export const COPY = {
  panelLabel: "Review panel",
  tabsLabel: "Review views",
  movesRegion: "Moves",
  coachRegion: "Coach",
  graphGroup: "Jump to a move",
  graphLabel: "Evaluation graph. Ticks mark your errors; select a move on the graph to jump.",
  graphStart: "Move 1",
  graphHint: "Click the graph to jump",
  graphEnd: "End",
  stepThrough:
    "You can step through the moves already. Badges and the coach appear as each move is graded, usually in under 10 seconds.",
  writing: "Finding your key moments…",
  failedTitle: "Couldn’t finish analysis",
  terminal: "We couldn’t analyse this game. Your moves are still here.",
  skipped: "This game is too short to review.",
  noMoments: "No turning points to review in this game.",
  cleanLead: "Clean game. Nothing to drill from this one.",
  startFailed: "Couldn’t start the analysis. Try again.",
  retryFailed: "Retry failed. Try again in a minute.",
  refreshFailed: "Couldn’t refresh the review. Your progress is saved.",
  notGradedYet: "Not graded yet",
  notGraded: "Not graded",
  notReached: "The engine did not reach this move.",
  startPosition: "Start position",
  moreBelow: "More below",
  countsMove: "Move",
  countsYou: "You",
  countsOpp: "Opp",
} as const;

/** "Waiting for the engine · about 20 s" (rct-a Q12), "about 2 min" past a minute. */
export function queuedLine(etaSec: number | null): string {
  if (etaSec === null) return "Waiting for the engine";
  if (etaSec < 60) return `Waiting for the engine · about ${Math.max(1, Math.round(etaSec))} s`;
  return `Waiting for the engine · about ${Math.round(etaSec / 60)} min`;
}

/** "Analysing · move 23 of 61" (the percentage renders beside it). */
export function runningLine(movesDone: number, movesTotal: number): string {
  return `Analysing · move ${movesDone} of ${movesTotal}`;
}

/** "Stockfish 18 · depth 18 · on our server". */
export function engineLine(engineLabel: string, depthLabel: string): string {
  return [engineLabel, depthLabel, "on our server"].filter(Boolean).join(" · ");
}

/** "Trying again in 25 s." while an automatic retry is scheduled; "Trying again now." once it is due. */
export function retryCountdownLine(secondsLeft: number): string {
  return secondsLeft > 0 ? `Trying again in ${secondsLeft} s.` : "Trying again now.";
}

/** Where the accuracy line stands: final (DONE), still coming (queued, running), or never coming (none, failed, skipped). */
export type AccuracyPhase = "done" | "grading" | "none";

export function accuracyPhase(status: AnalysisStatusWire): AccuracyPhase {
  if (status === "done") return "done";
  return status === "queued" || status === "running" ? "grading" : "none";
}

/**
 * "Accuracy 85 · opp 89" (DONE), "Accuracy …" while grading, nothing when no accuracy will come (a failed, skipped or
 * never-analysed game: a placeholder there would never resolve; regression: accuracy-placeholder-forever, FIX-2).
 */
export function accuracyLine(you: number | null, opp: number | null, phase: AccuracyPhase): string | null {
  if (phase === "grading") return "Accuracy …";
  if (phase === "none" || you === null) return null;
  return opp === null ? `Accuracy ${you}` : `Accuracy ${you} · opp ${opp}`;
}

/**
 * An ungraded move's label and reason by the analysis status: "Not graded yet" while the engine can still reach it,
 * "Not graded" with the reason when it never will. A skipped game never ran the engine, so it never says the engine
 * "did not reach" the move (regression: skipped-says-not-reached, FIX-2).
 */
export function ungradedMove(status: AnalysisStatusWire): { label: string; reason: string | null } {
  if (status === "queued" || status === "running") return { label: COPY.notGradedYet, reason: null };
  if (status === "skipped") return { label: COPY.notGraded, reason: COPY.skipped };
  return { label: COPY.notGradedYet, reason: COPY.notReached };
}

/** "Review · vs tal_fan_77". */
export function reviewTitle(opponent: string): string {
  return `Review · vs ${opponent}`;
}

/** "Two Knights Defense: Main Line" → "Two Knights" (the meta line keeps the family name, as the boards do). */
export function shortOpening(name: string): string {
  const family = (name.split(":")[0] ?? name).trim();
  return family.replace(/\s+(Defense|Defence|Opening|System)$/i, "").trim() || family;
}

/** "Rapid 10+0 · C59 Two Knights · 0–1 resigned". */
export function reviewMeta(tcLabel: string, opening: { eco: string; name: string } | null, endLabel: string): string {
  const parts = [tcLabel];
  if (opening) parts.push(`${opening.eco} ${shortOpening(opening.name)}`);
  parts.push(endLabel);
  return parts.filter(Boolean).join(" · ");
}

/** Move-quality labels (DS MoveQualityBadge; V2Badge). */
export { QUALITY_LABEL } from "./quality-labels";

/** "Black" / "White". */
export const COLOUR_NAME = { w: "White", b: "Black" } as const;
