// Review complete copy and view model (phase-03 plan §4.2; boards V3RvComplete `default`, V3RvCompleteClean
// `nothing`, plus the plan's `partial` and `noMoments` variants). Pure: no React, no zod. Every number is computed
// from the ReviewCompleteView (getReviewComplete, §5.3); P5's Mistake Bank lines and P7's coach row are not here.

import type { CompleteMoment, MomentResult, ReviewCompleteView } from "@repo/contracts/http/review";
import { QUALITY_LABEL } from "../copy";

export type CompleteState = "default" | "nothing" | "partial" | "noMoments";

/** Which board state the view is (clean → `nothing`; no moments → `noMoments`; Finish before every answer → `partial`). */
export function completeStateOf(v: Pick<ReviewCompleteView, "isClean" | "moments" | "partial" | "reviewed">): CompleteState {
  if (v.isClean) return "nothing";
  if (v.moments.length === 0) return "noMoments";
  if (v.partial || v.reviewed < v.moments.length) return "partial";
  return "default";
}

export const COMPLETE_COPY = {
  titleDone: "Review complete",
  titleClean: "Clean game",
  titleNoMoments: "No turning points in this game.",
  noMomentsLead: "Nothing big to fix in this one.",
  momentsHeading: "The moments",
  standoutsHeading: "Your best moves",
  playAgain: "Play Again",
  share: "Share Analysis",
  reviewAgain: "Review Again",
  backToGames: "Back to My Games",
  finishLast: (n: number) => (n === 1 ? "Finish the Last Moment" : `Finish the Last ${n} Moments`),
  statsLabel: "Review stats",
  accuracy: "Accuracy",
  moments: "Moments",
  found: "Found",
  brilliant: "Brilliant",
  bestThisMonth: "Best this month",
  bestMove: "Best move",
  backToReview: "Back to the Review",
} as const;

/** The h1 of each state. */
export function completeTitle(state: CompleteState): string {
  if (state === "nothing") return COMPLETE_COPY.titleClean;
  if (state === "noMoments") return COMPLETE_COPY.titleNoMoments;
  return COMPLETE_COPY.titleDone;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** The lead under the h1: "3 moments reviewed.", "2 of 3 moments reviewed.", the best decision of a clean game. */
export function completeLead(v: Pick<ReviewCompleteView, "moments" | "reviewed" | "bestDecision" | "isClean">, state: CompleteState): string {
  switch (state) {
    case "nothing":
      return v.bestDecision ?? COMPLETE_COPY.noMomentsLead;
    case "noMoments":
      return COMPLETE_COPY.noMomentsLead;
    case "partial":
      return `${v.reviewed} of ${plural(v.moments.length, "moment", "moments")} reviewed.`;
    case "default":
      return `${plural(v.moments.length, "moment", "moments")} reviewed.`;
  }
}

export interface StatTile {
  id: string;
  value: string;
  label: string;
}

/**
 * The stat row (`<dl>`): default/partial = Accuracy · Moments · Found; nothing = Accuracy · Brilliant · Best this
 * month ✓ (only when true); noMoments = Accuracy · Best move (when a standout exists).
 */
export function statTiles(v: ReviewCompleteView, state: CompleteState): StatTile[] {
  const acc: StatTile = { id: "accuracy", value: v.accuracy === null ? "—" : String(v.accuracy), label: COMPLETE_COPY.accuracy };
  if (state === "nothing") {
    const tiles = [acc, { id: "brilliant", value: String(v.brilliant), label: COMPLETE_COPY.brilliant }];
    if (v.bestThisMonth) tiles.push({ id: "best-month", value: "✓", label: COMPLETE_COPY.bestThisMonth });
    return tiles;
  }
  if (state === "noMoments") {
    const best = v.standouts[0];
    return best ? [acc, { id: "best-move", value: `${best.moveLabel}${best.san}`, label: COMPLETE_COPY.bestMove }] : [acc];
  }
  return [acc, { id: "moments", value: String(v.moments.length), label: COMPLETE_COPY.moments }, { id: "found", value: String(v.found), label: COMPLETE_COPY.found }];
}

/** "You played 17.b3 · best was Qc1". */
export function momentPlayedLine(m: Pick<CompleteMoment, "moveLabel" | "playedSan" | "bestSan">): string {
  return `You played ${m.moveLabel}${m.playedSan} · best was ${m.bestSan}`;
}

const RESULT_TAIL: Record<MomentResult, string> = {
  found: "you found it",
  found_retry: "you found it on retry",
  revealed: "you saw the answer",
};

/** "Inaccuracy · you found it on retry"; "Blunder · not reviewed yet" for an open moment. */
export function momentResultLine(m: Pick<CompleteMoment, "judgement" | "result">): string {
  return `${QUALITY_LABEL[m.judgement]} · ${m.result ? RESULT_TAIL[m.result] : "not reviewed yet"}`;
}

/** The 1-based moment to resume for "Finish the Last Moment" (the first without a result), or null. */
export function firstOpenMomentNumber(moments: readonly Pick<CompleteMoment, "result">[]): number | null {
  const i = moments.findIndex((m) => m.result === null);
  return i < 0 ? null : i + 1;
}

/** "Accuracy 97 is your best this month." (only shown when true). */
export function bestMonthLine(accuracy: number | null): string | null {
  return accuracy === null ? null : `Accuracy ${accuracy} is your best this month.`;
}
