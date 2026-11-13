// The onboarding resolver and the per-page guard (phase-04 plan §8.1, §4.1). Pure: the server pages build an
// `OnbViewer` from the viewer and the onboarding row (lib/data/onboarding.ts) and pass the request clock
// (`requestNow()`, which honours `x-rc-now` only with test hooks), so the 30-minute abandoned-checkout rule is
// testable without waiting.
import { CHESSCOM_USERNAME_RE } from "@repo/contracts/http/p04-plain";
import {
  DEFAULT_DESTINATION,
  ORDER,
  PENDING_CHECKOUT_TTL_MS,
  stepIndex,
  stepPath,
  type OnbPage,
  type OnbStep,
} from "./steps";

/** What the resolver and the guards read. Built by `toOnbViewer()` in lib/data/onboarding.ts. */
export type OnbViewer = {
  /** users."onboardingStep" (monotonic). */
  step: OnbStep;
  /** users.onboarded. */
  onboardingDone: boolean;
  /** Billing truth (an active or trialing subscription). */
  entitled: boolean;
  isAdmin: boolean;
  /** BILLING_PAYWALL is not "off". */
  paywallOn: boolean;
  /** An ACTIVE linked account of either provider. */
  hasActiveLink: boolean;
  /** An ACTIVE Lichess link (the confirm step for Lichess shows it). */
  lichessLinked: boolean;
  /** users."pendingCheckoutAt" in epoch ms, or null. */
  pendingCheckoutAt: number | null;
  /** The safe destination after onboarding (`rc_onb_next` or `?redirect_url=`), or null. */
  next: string | null;
};

/** Members, admins and everyone while the paywall is off skip the plan (§8.1). */
export function entitledLike(v: Pick<OnbViewer, "entitled" | "isAdmin" | "paywallOn">): boolean {
  return v.entitled || v.isAdmin || !v.paywallOn;
}

/** A checkout was started less than 30 minutes ago. */
export function pendingCheckoutFresh(v: Pick<OnbViewer, "pendingCheckoutAt">, now: number): boolean {
  return v.pendingCheckoutAt !== null && now - v.pendingCheckoutAt < PENDING_CHECKOUT_TTL_MS;
}

export const ABANDONED_CHECKOUT_PATH = `${stepPath("plan")}?resume=abandoned`;

/** Where `/onboarding` sends this viewer (§8.1). */
export function resolveOnboardingRoute(v: OnbViewer, now: number): string {
  const member = entitledLike(v);
  if (v.onboardingDone && member) return v.next ?? DEFAULT_DESTINATION; // D4-13
  const at = ORDER.indexOf(v.step);
  if (member && at >= ORDER.indexOf("PLAN")) return stepPath("done"); // the plan is skipped for members
  switch (v.step) {
    case "WELCOME":
      return stepPath("welcome");
    case "LINK":
      return v.hasActiveLink ? stepPath("level") : stepPath("link");
    case "CONFIRM":
      return v.lichessLinked ? `${stepPath("confirm")}?provider=lichess` : stepPath("link");
    case "LEVEL":
      return stepPath("level");
    case "GOALS":
      return stepPath("goals");
    case "PLAN":
      return stepPath("plan");
    case "ACTIVATING":
      return pendingCheckoutFresh(v, now) ? stepPath("activating") : ABANDONED_CHECKOUT_PATH;
    case "DONE":
      return member ? stepPath("done") : stepPath("plan");
  }
}

/** The query a step page was opened with (only the keys the guards read). */
export type StepQuery = {
  provider?: string;
  u?: string;
  checkout?: string;
};

/**
 * The per-page guard (§8.1), called by every step page before it renders. Null = the page may render; otherwise
 * the path to redirect to.
 *
 * - A finished member is sent on (the resolver's answer): the flow is over.
 * - Up to PLAN, a page may be opened when it is at most one step ahead of the stored step (back navigation is
 *   always allowed); further ahead → the resolver. Members skip the plan (→ done).
 * - Confirm needs a valid Chess.com `u`, or a Lichess link for `provider=lichess`; else → link.
 * - Activating needs a fresh pending checkout, `checkout=success` or entitlement; else → the plan (with the
 *   abandoned banner when a checkout had been started).
 * - Done needs entitlement or a fresh pending checkout ("Trial starting…"); else → the plan.
 */
export function guardStep(page: OnbPage, v: OnbViewer, now: number, query: StepQuery = {}): string | null {
  const member = entitledLike(v);
  if (v.onboardingDone && member) return resolveOnboardingRoute(v, now);

  switch (page) {
    case "activating":
      if (pendingCheckoutFresh(v, now) || query.checkout === "success" || member) return null;
      return v.step === "ACTIVATING" || v.pendingCheckoutAt !== null ? ABANDONED_CHECKOUT_PATH : stepPath("plan");
    case "done":
      return member || pendingCheckoutFresh(v, now) ? null : stepPath("plan");
    default:
      break;
  }

  if (member && page === "plan") return stepPath("done");
  if (stepIndex(page) > stepIndex(v.step) + 1) return resolveOnboardingRoute(v, now);

  if (page === "confirm") {
    if (query.provider === "lichess") return v.lichessLinked ? null : stepPath("link");
    if (query.provider === "chesscom" && typeof query.u === "string" && CHESSCOM_USERNAME_RE.test(query.u)) return null;
    return stepPath("link");
  }
  return null;
}
