// The game-over card's review slots as data (phase-03 plan §4.7, §5.8; P3-D29; boards V3GameOverLegend, V3Game
// `over_analysing` / `over_legend` / the `result.coach` field of the over_* states). Pure, so every state is unit-tested:
//
//   seed     `game:result.review` (live) or the bot `complete` answer → a ReviewStatusDTO in qk.review.status(ref),
//            never regressing a state the cache already has (an A2 answer or a socket event may have arrived first);
//   model    status + game facts → what each slot shows:
//              analysing  disabled primary "Analysing · 64%" with a spinner; the accuracy slot's progress bar
//              done       "Accuracy 91 · 1 moment to learn from", the coach line, primary See What the Coach Thinks
//              failed     "Review paused · retrying" and the primary Open Review (the review shows the failed state)
//              skipped    nothing (too short or aborted)
//              none       a finish that has not reached the cache yet (≤ 60 s after the end, ≥ 6 plies) reads as
//                         analysing 0 %; an older game that was never analysed gets Open Review (A3 enqueues there)
//   legend   the `over_legend` block from LegendSummaryDTO, whatever the analysis state.
// Types only from @repo/contracts: no zod in this chunk (AP-12). Numbers in copy are always computed (P1 rule).
import { ANALYSIS_MIN_PLIES } from "@repo/contracts/http/plain";
import type { LegendSummaryDTO, ReviewStatusDTO } from "@repo/contracts/http/review";
import { queuedLine, runningLine } from "../copy";
import { movesProgress } from "../progress";

export type AnalysisStatus = ReviewStatusDTO["analysis"]["status"];

/** Shorter games are not analysed (the contract's ANALYSIS_MIN_PLIES, from the zod-free module). */
export const GAME_OVER_MIN_PLIES = ANALYSIS_MIN_PLIES;
/** How long after the end a missing status still means "the finish is on its way" (then: never analysed). */
export const GAME_OVER_FRESH_MS = 60_000;

export const GAME_OVER_COPY = {
  coachCta: "See What the Coach Thinks",
  openReview: "Open Review",
  analysing: (pct: number) => `Analysing · ${pct}%`,
  paused: "Review paused · retrying",
  pausedTerminal: "Review paused",
  legendLabel: "Legend comparison",
  compareWith: (name: string) => `Compare with ${name}`,
  replayFrom: (move: number) => `Replay from Move ${move}`,
  coachMarker: "C",
  progressLabel: "Analysing your game",
  ready: "Analysis ready",
} as const;

// ── seeding ─────────────────────────────────────────────────────────────────────────────────────────────────────
export type ReviewSeed = {
  status: AnalysisStatus;
  etaSec?: number | null;
  /** The bot complete's legend block (undefined = unknown, keep what the cache has). */
  comparison?: LegendSummaryDTO | null;
};

/**
 * The status DTO a seed stands for, or null to keep `prev`: a cache that already holds a real state (anything but
 * `none`) is newer than a seed, except that a seed's legend block fills a missing one.
 */
export function statusFromSeed(prev: ReviewStatusDTO | undefined, seed: ReviewSeed, totalPlies: number): ReviewStatusDTO | null {
  if (prev && prev.analysis.status !== "none") {
    if (seed.comparison && !prev.comparison) return { ...prev, comparison: seed.comparison };
    return null;
  }
  if (seed.status === "none" && prev) return seed.comparison && !prev.comparison ? { ...prev, comparison: seed.comparison } : null;
  const live = seed.status === "queued" || seed.status === "running";
  return {
    v: 1,
    analysis: {
      status: seed.status,
      gradedPlies: 0,
      totalPlies: Math.max(0, totalPlies, prev?.analysis.totalPlies ?? 0),
      failedAtPly: null,
      retryable: false,
      retryAt: null,
      code: null,
      etaSec: live ? (seed.etaSec ?? null) : null,
    },
    review: { ready: false, accuracy: null, momentsCount: 0, isClean: false, coachLine: null },
    comparison: seed.comparison !== undefined ? seed.comparison : (prev?.comparison ?? null),
    bank: null,
  };
}

// ── the view model ──────────────────────────────────────────────────────────────────────────────────────────────
export type GameOverInput = {
  /** qk.review.status(ref); undefined before the first A2 answer or seed. */
  status: ReviewStatusDTO | undefined;
  /** Plies played in this game (ResultView.ply). */
  plies: number;
  /** The game ended less than GAME_OVER_FRESH_MS ago (its finish may still be on the way). */
  fresh: boolean;
};

export type AccuracySlot =
  | { kind: "analysing"; label: string; pct: number }
  | { kind: "done"; label: string }
  | { kind: "paused"; label: string };

export type PrimarySlot =
  | { kind: "analysing"; pct: number }
  | { kind: "coach" }
  | { kind: "open" };

export interface GameOverModel {
  /** The status the click telemetry reports (`none` while nothing is known). */
  status: AnalysisStatus;
  primary: PrimarySlot | null;
  accuracy: AccuracySlot | null;
  coachLine: string | null;
  legend: LegendSummaryDTO | null;
}

/** Whole percent of graded plies, never 100 before `done` (the primary flips then). */
export function gradedPct(graded: number, total: number): number {
  if (total <= 0) return 0;
  return Math.max(0, Math.min(99, Math.floor((graded * 100) / total)));
}

/** "Accuracy 91 · 1 moment to learn from"; "Accuracy 97 · Clean game"; without an accuracy, the moments alone. */
export function accuracyHeadline(accuracy: number | null, moments: number, isClean: boolean): string {
  const tail = isClean || moments === 0 ? "Clean game" : `${moments} ${moments === 1 ? "moment" : "moments"} to learn from`;
  return accuracy === null ? tail : `Accuracy ${accuracy} · ${tail}`;
}

export function gameOverModel(input: GameOverInput): GameOverModel {
  const s = input.status;
  const long = input.plies >= GAME_OVER_MIN_PLIES;
  const legend = s?.comparison ?? null;
  const status: AnalysisStatus = s?.analysis.status ?? "none";
  const analysing = (pct: number, line: string): Pick<GameOverModel, "primary" | "accuracy"> => ({
    primary: { kind: "analysing", pct },
    accuracy: { kind: "analysing", label: line, pct },
  });

  switch (status) {
    case "queued": {
      const a = s!.analysis;
      return { status, ...analysing(0, queuedLine(a.etaSec)), coachLine: null, legend };
    }
    case "running": {
      const a = s!.analysis;
      const pct = gradedPct(a.gradedPlies, a.totalPlies);
      // The line counts moves, not plies (plan §4.1 "Copy notes"), as the review screen does.
      const { movesDone, movesTotal } = movesProgress(a.gradedPlies, a.totalPlies);
      return { status, ...analysing(pct, runningLine(movesDone, movesTotal)), coachLine: null, legend };
    }
    case "done": {
      const r = s!.review;
      return {
        status,
        primary: { kind: "coach" },
        accuracy: { kind: "done", label: accuracyHeadline(r.accuracy, r.momentsCount, r.isClean) },
        coachLine: r.coachLine ? r.coachLine.slice(0, 160) : null,
        legend,
      };
    }
    case "failed": {
      const retryable = s!.analysis.retryable;
      return {
        status,
        primary: { kind: "open" },
        accuracy: { kind: "paused", label: retryable ? GAME_OVER_COPY.paused : GAME_OVER_COPY.pausedTerminal },
        coachLine: null,
        legend,
      };
    }
    case "skipped":
      return { status, primary: null, accuracy: null, coachLine: null, legend };
    case "none":
      if (!long) return { status, primary: null, accuracy: null, coachLine: null, legend };
      if (input.fresh) return { status, ...analysing(0, queuedLine(null)), coachLine: null, legend };
      return { status, primary: { kind: "open" }, accuracy: null, coachLine: null, legend };
  }
}

// ── the legend block (`over_legend`) ────────────────────────────────────────────────────────────────────────────
export type LegendLine =
  | { kind: "followed"; text: string }
  | { kind: "diverged"; lead: string; matched: string; middle: string; yours: string; between: string; theirs: string; end: string };

/** The fullmove number of a move label ("12." → 12, "25…" → 25). */
export function moveNumberOf(label: string): number {
  const n = Number.parseInt(label, 10);
  return Number.isInteger(n) && n > 0 ? n : 1;
}

/**
 * The block's sentence, in parts so the matched count and the moves can be styled (the board bolds the count and sets
 * the moves in mono, the legend's in the legend colour). Gender-neutral: the board's "his path" becomes the name.
 *   user left:      You matched Morphy for **2 of 3** moves, then left Morphy’s path with 12.Ba4 (Morphy played 12.O-O-O).
 *   opponent left:  You matched Kasparov for **6 of 6** moves before the game left Kasparov’s path on 25…Kb6 (the
 *                   original game went 25…Kxd4).
 *   followed:       You followed Morphy to the end.
 */
export function legendLine(c: LegendSummaryDTO): LegendLine {
  const name = c.legendName;
  const d = c.divergence;
  if (!d) return { kind: "followed", text: `You followed ${name} to the end.` };
  const yours = `${d.moveLabel}${d.userSan}`;
  const theirs = `${d.moveLabel}${d.legendSan}`;
  const matched = `${c.matched} of ${c.compared}`;
  if (d.by === "opponent") {
    return {
      kind: "diverged",
      lead: `You matched ${name} for `,
      matched,
      middle: ` moves before the game left ${name}’s path on `,
      yours,
      between: " (the original game went ",
      theirs,
      end: ").",
    };
  }
  return {
    kind: "diverged",
    lead: `You matched ${name} for `,
    matched,
    middle: ` moves, then left ${name}’s path with `,
    yours,
    between: ` (${name} played `,
    theirs,
    end: ").",
  };
}

/** The Replay link (only when the member left the path; `replayHref` is null otherwise). */
export function replayLink(c: LegendSummaryDTO): { href: string; label: string; ply: number } | null {
  if (!c.replayHref || !c.divergence) return null;
  return { href: c.replayHref, label: GAME_OVER_COPY.replayFrom(moveNumberOf(c.divergence.moveLabel)), ply: c.divergence.ply };
}
