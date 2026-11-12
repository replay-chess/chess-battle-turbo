// The /dev/ui/review demo states (server- and client-safe; the pages validate their params with them). Every enum
// value of the P3 review boards is reachable here (phase-03 plan §4.10): V3Review* `analysing | failed | clean |
// summary | moment` (with the design's names as aliases), the moment sub-states, the complete page's
// `default | nothing | partial | noMoments` and the share page's `generating | ready | copied | error | rate_limited |
// revoked`.

import type { DesignState } from "@repo/game-core/client/viewState";

export const REVIEW_DEMO_STATES = [
  "none",
  "queued",
  "running",
  "analysing",
  "writing",
  "failed",
  "terminal",
  "skipped",
  "done",
  "summary",
  "moves",
  "clean",
  "clean_loss",
  "no_moments",
  "moment",
] as const;
export type ReviewDemoState = (typeof REVIEW_DEMO_STATES)[number];

export function isReviewDemoState(s: string | undefined): s is ReviewDemoState {
  return (REVIEW_DEMO_STATES as readonly string[]).includes(s ?? "");
}

/** `?phase=` for `state=moment` (plan §4.1 `moment.*`). */
export const MOMENT_DEMO_PHASES = ["ask", "tried", "pickLine", "found", "found_retry", "reveal", "line"] as const;
export type MomentDemoPhase = (typeof MOMENT_DEMO_PHASES)[number];

export function isMomentDemoPhase(s: string | undefined): s is MomentDemoPhase {
  return (MOMENT_DEMO_PHASES as readonly string[]).includes(s ?? "");
}

/** `/dev/ui/review/complete?state=` (V3RvComplete / V3RvCompleteClean + the plan's variants). */
export const COMPLETE_DEMO_STATES = ["default", "nothing", "partial", "noMoments"] as const;
export type CompleteDemoState = (typeof COMPLETE_DEMO_STATES)[number];

export function isCompleteDemoState(s: string | undefined): s is CompleteDemoState {
  return (COMPLETE_DEMO_STATES as readonly string[]).includes(s ?? "");
}

/** `/dev/ui/review/share?state=` (V3RvShare `generating | ready` + the plan's new states). */
export const SHARE_DEMO_STATES = ["generating", "ready", "copied", "error", "rate_limited", "revoked"] as const;
export type ShareDemoState = (typeof SHARE_DEMO_STATES)[number];

export function isShareDemoState(s: string | undefined): s is ShareDemoState {
  return (SHARE_DEMO_STATES as readonly string[]).includes(s ?? "");
}

/** `/dev/ui/game-over?slot=` (P2's card with P3's slots, plan §4.7). */
export const GAME_OVER_DEMO_SLOTS = [
  "analysing",
  "queued",
  "done",
  "clean",
  "failed",
  "terminal",
  "skipped",
  "legend",
  "legend_followed",
  "legend_opponent",
  "legend_pending",
] as const;
export type GameOverDemoSlot = (typeof GAME_OVER_DEMO_SLOTS)[number];

export function isGameOverDemoSlot(s: string | undefined): s is GameOverDemoSlot {
  return (GAME_OVER_DEMO_SLOTS as readonly string[]).includes(s ?? "");
}

/**
 * The P2 game-over card under each slot, picked so the card and the slot tell the same story (FIX-1: the done slot
 * cited move 19 under a 2-ply resignation, and the legend slot said "you drew" under "You won by checkmate"). The P2
 * demo games: `over_checkmate_loss` / `over_checkmate_win` are the Opera Game from Morphy's position (10.Nxb5 …
 * 17.Rd8#; the viewer Black or White) and `over_resign_loss` two plies then a resignation (too short to analyse: the
 * skipped slot). The legend slots that left Morphy's line are P3's own games from the same position
 * (game-over-games.ts, FIX-2): `legend` / `legend_pending` a draw by repetition at move 17 after 12.Ba4 (as the board
 * V3GameOverLegend), `legend_opponent` 11…Kd8 then a resignation.
 */
export const GAME_OVER_DEMO_BASE: Readonly<Record<GameOverDemoSlot, DesignState>> = {
  analysing: "over_checkmate_loss",
  queued: "over_checkmate_loss",
  done: "over_checkmate_loss",
  clean: "over_checkmate_win",
  failed: "over_checkmate_loss",
  terminal: "over_checkmate_loss",
  skipped: "over_resign_loss",
  legend: "over_threefold",
  legend_followed: "over_checkmate_win",
  legend_opponent: "over_resign_win",
  legend_pending: "over_threefold",
};

/**
 * The review status the demo seeds, fitted to the game on screen: the plies are the game's own, and the coach lines
 * name moves of that game (the done slot: Black's 14…Qe6 of the Opera Game, where 14…Qb4 was legal; the clean slot:
 * White's 16.Qb8+, the Opera Game's queen sacrifice before 17.Rd8#).
 */
export const GAME_OVER_DEMO_COACH = {
  done: "The game turned on move 14, when Qe6 missed Qb4.",
  clean: "Your best decision: 16.Qb8+, a sacrifice that forced mate.",
  // The legend games: 12.Ba4 left Morphy's 12.O-O-O (the draw); the Opera Game followed to 17.Rd8#; 12.O-O-O+ after
  // the opponent's 11…Kd8.
  legend: "The game turned on move 12, when Ba4 missed O-O-O.",
  legend_followed: "17.Rd8# finished it the way Morphy did in 1858.",
  legend_opponent: "Your best decision: 12.O-O-O+.",
} as const;

/** Moments of each slot's review, fitted to its game (the accuracy eyebrow "Accuracy 85 · 1 moment"). */
const GAME_OVER_DEMO_MOMENTS: Partial<Record<GameOverDemoSlot, number>> = {
  legend: 1,
  legend_pending: 1,
  legend_followed: 0,
  legend_opponent: 0,
};

const COACH_OF: Partial<Record<GameOverDemoSlot, string>> = {
  done: GAME_OVER_DEMO_COACH.done,
  clean: GAME_OVER_DEMO_COACH.clean,
  legend: GAME_OVER_DEMO_COACH.legend,
  legend_pending: GAME_OVER_DEMO_COACH.legend,
  legend_followed: GAME_OVER_DEMO_COACH.legend_followed,
  legend_opponent: GAME_OVER_DEMO_COACH.legend_opponent,
};

export function fitStatusToGame<
  S extends {
    analysis: { status: string; gradedPlies: number; totalPlies: number; failedAtPly: number | null };
    review: { coachLine: string | null; momentsCount?: number; isClean?: boolean };
  },
>(slot: GameOverDemoSlot, status: S, plies: number): S {
  if (slot === "skipped") return { ...status, analysis: { ...status.analysis, totalPlies: plies } };
  const scale = (n: number) => Math.min(plies, Math.round((n / Math.max(1, status.analysis.totalPlies)) * plies));
  const analysis = {
    ...status.analysis,
    totalPlies: plies,
    gradedPlies: status.analysis.status === "done" ? plies : scale(status.analysis.gradedPlies),
    failedAtPly: status.analysis.failedAtPly === null ? null : scale(status.analysis.failedAtPly),
  };
  const coachLine = COACH_OF[slot] ?? status.review.coachLine;
  const moments = GAME_OVER_DEMO_MOMENTS[slot];
  const review = { ...status.review, coachLine, ...(moments === undefined ? {} : { momentsCount: moments, isClean: moments === 0 }) };
  return { ...status, analysis, review };
}
