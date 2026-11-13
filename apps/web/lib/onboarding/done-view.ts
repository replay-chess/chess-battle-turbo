// The Done step's copy (phase-04 plan §4.8; V3OnbDone, V3iPhoneOnbDone, V3iPadOnbDone). Pure and client-safe.
//
//   tag       "Trial · 7 days left" (a trial), nothing extra for a paid member, "Trial starting…" while the trial is
//             not confirmed yet (the member came through "Continue in Background"): completion waits for
//             `entitlement:changed`, Go to Home is disabled with the hint "Almost there…".
//   body      names the linked provider(s); "your games" with none.
//   completed the `onb_completed` properties (§10.1: no username, no FEN).
//   failed    a declined card while "Trial starting…" waited → the plan with `?status=failed` (FIX-1).

import type { ActivationData } from "@repo/contracts/http/billing";

export type DoneTag = { tone: "trial" | "starting"; text: string };

export type DoneEntitlement = {
  /** Entitled, admin or paywall off (the resolver's entitledLike). */
  entitled: boolean;
  trialActive: boolean;
  daysLeft: number | null;
};

export function doneTag(e: DoneEntitlement): DoneTag | null {
  if (!e.entitled) return { tone: "starting", text: "Trial starting…" };
  if (!e.trialActive) return null;
  if (e.daysLeft === null) return { tone: "trial", text: "Trial" };
  return { tone: "trial", text: `Trial · ${e.daysLeft} ${e.daysLeft === 1 ? "day" : "days"} left` };
}

/** `providers`: "Chess.com", "Chess.com and Lichess", or null (plan-view.ts providersLabel). */
export function doneBody(providers: string | null): string {
  const games = providers ? `your ${providers} games` : "your games";
  return `The coach is analysing ${games} now. Your first review and puzzle set land on Home. Warm up with a classic position while you wait.`;
}

export const ALMOST_THERE = "Almost there…";
export const LEGEND_ASIDE_LABEL = "Wijk aan Zee · 1999 · White to move";
export const LEGEND_ASIDE_CAPTION = "Kasparov vs Topalov. Kasparov found a rook sacrifice here. Can you?";
export const ACTIVATING_ASIDE_LABEL = "While you wait";
export const ACTIVATING_ASIDE_CAPTION = "Your first legend position is ready: Kasparov vs Topalov, White to move.";

/** The legacy position page of the legend aside (D4-14), or null (the CTA is hidden). */
export function legendPositionHref(ref: string | null): string | null {
  return ref ? `/position/${encodeURIComponent(ref)}` : null;
}

/** Milliseconds a stored onboarding start mark is trusted for (`onb_completed.total_ms` ≤ 1 day). */
export const ONB_TOTAL_MS_MAX = 86_400_000;

/** `onb_completed.total_ms` from the first step view of this browser (null mark → 0), clamped to the schema. */
export function totalOnboardingMs(startedAt: number | null, now: number): number {
  if (startedAt === null || !Number.isFinite(startedAt) || startedAt > now) return 0;
  return Math.min(ONB_TOTAL_MS_MAX, Math.round(now - startedAt));
}

/**
 * Where Done sends a member whose card was declined while "Trial starting…" waited (FIX-1): the plan with the failed
 * banner and the plan they picked, as Activating does (plan §4.7 "not drawn: failed").
 */
export function donePlanFailedHref(watch: Pick<ActivationData, "plan"> | null): string {
  const plan = watch?.plan?.interval === "year" ? "yearly" : "monthly";
  return `/onboarding/plan?status=failed&plan=${plan}`;
}
