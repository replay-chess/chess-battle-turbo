// Review complete copy and view model (phase-03 plan §4.2; boards V3RvComplete `default`, V3RvCompleteClean
// `nothing`, plus the plan's `partial` and `noMoments` variants). Pure: no React, no zod. Every number is computed
// from the ReviewCompleteView (getReviewComplete, §5.3); P7's coach row is not here.
//
// P5 (phase-05 plan §4.8 "Review complete", V3RvComplete; owner WP-H): with the `train` flag on, the view carries the
// bank fields (`added`, `nextDueLabel`, `drillHref`, `inBank` per moment) and the page gains the Mistake Bank line in the
// lead, the To Drill tile, the "Added" / "Not added" tags and the Drill These {n} Mistakes primary. Without them
// (`added` absent: `train` off) everything renders exactly as in P3.

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
  toDrill: "To drill",
  added: "Added",
  notAdded: "Not added",
  backToHome: "Back to Home",
} as const;

/** The bank fields of a view, when the `train` flag gave it some (P5). */
export function bankOf(v: Pick<ReviewCompleteView, "added" | "nextDueLabel" | "drillHref">): { added: number; nextDueLabel: string | null; drillHref: string | null } | null {
  if (v.added === undefined) return null;
  return { added: v.added, nextDueLabel: v.nextDueLabel ?? null, drillHref: v.drillHref ?? null };
}

/** " · 3 added to your Mistake Bank. The first one comes back tomorrow." / " · nothing added to your Mistake Bank." */
export function bankLeadTail(bank: { added: number; nextDueLabel: string | null }): string {
  if (bank.added === 0) return " · nothing added to your Mistake Bank.";
  const back = bank.nextDueLabel ? ` The first one comes back ${bank.nextDueLabel}.` : "";
  return ` · ${bank.added} added to your Mistake Bank.${back}`;
}

/** Drill These 3 Mistakes · ~2 min (40 s a position, rounded up); one: Drill This Mistake · ~1 min. */
export function drillLabel(n: number): string {
  const min = Math.max(1, Math.ceil((n * 40) / 60));
  return n === 1 ? `Drill This Mistake · ~${min} min` : `Drill These ${n} Mistakes · ~${min} min`;
}

export type CompletePrimary = { kind: "drill" | "home" | "play"; label: string; href: string };

/**
 * The primary (and the Enter key): Drill These {n} Mistakes when cards were added; Back to Home when the member opted
 * every moment out; Play Again otherwise (clean game, no moments, or `train` off).
 */
export function completePrimary(
  v: Pick<ReviewCompleteView, "added" | "nextDueLabel" | "drillHref" | "moments">,
  state: CompleteState,
  links: { playAgain: string; home: string },
): CompletePrimary {
  const bank = bankOf(v);
  const momentsState = state === "default" || state === "partial";
  if (bank && momentsState && bank.added > 0 && bank.drillHref) return { kind: "drill", label: drillLabel(bank.added), href: bank.drillHref };
  if (bank && momentsState && bank.added === 0 && v.moments.length > 0) return { kind: "home", label: COMPLETE_COPY.backToHome, href: links.home };
  return { kind: "play", label: COMPLETE_COPY.playAgain, href: links.playAgain };
}

/** The h1 of each state. */
export function completeTitle(state: CompleteState): string {
  if (state === "nothing") return COMPLETE_COPY.titleClean;
  if (state === "noMoments") return COMPLETE_COPY.titleNoMoments;
  return COMPLETE_COPY.titleDone;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** The lead under the h1: "3 moments reviewed.", "2 of 3 moments reviewed.", the best decision of a clean game. */
export function completeLead(
  v: Pick<ReviewCompleteView, "moments" | "reviewed" | "bestDecision" | "isClean"> & Partial<Pick<ReviewCompleteView, "added" | "nextDueLabel" | "drillHref">>,
  state: CompleteState,
): string {
  const bank = bankOf(v);
  switch (state) {
    case "nothing": {
      const best = v.bestDecision ?? COMPLETE_COPY.noMomentsLead;
      return bank ? `Nothing went into your Mistake Bank. ${best}` : best;
    }
    case "noMoments":
      return COMPLETE_COPY.noMomentsLead;
    case "partial": {
      const head = `${v.reviewed} of ${plural(v.moments.length, "moment", "moments")} reviewed`;
      return bank ? `${head}${bankLeadTail(bank)}` : `${head}.`;
    }
    case "default": {
      const head = `${plural(v.moments.length, "moment", "moments")} reviewed`;
      return bank ? `${head}${bankLeadTail(bank)}` : `${head}.`;
    }
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
  const bank = bankOf(v);
  // P5 (V3RvComplete): Accuracy · To drill · Moments; clean: Accuracy · To drill 0 · Brilliant.
  if (bank && (state === "default" || state === "partial")) {
    return [acc, { id: "to-drill", value: String(bank.added), label: COMPLETE_COPY.toDrill }, { id: "moments", value: String(v.moments.length), label: COMPLETE_COPY.moments }];
  }
  if (bank && state === "nothing") {
    return [acc, { id: "to-drill", value: "0", label: COMPLETE_COPY.toDrill }, { id: "brilliant", value: String(v.brilliant), label: COMPLETE_COPY.brilliant }];
  }
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

/** A moment's bank tag ("Added" / "Not added"), or null without the bank fields. */
export function momentBankTag(m: Pick<CompleteMoment, "inBank">): { label: string; added: boolean } | null {
  if (m.inBank === undefined) return null;
  return m.inBank ? { label: COMPLETE_COPY.added, added: true } : { label: COMPLETE_COPY.notAdded, added: false };
}
