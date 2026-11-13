// Onboarding v3 steps (phase-04 plan §4.0, §8.1). Client-safe and zod-free: the frame's header, the resolver, the
// per-page guard and middleware all read these lists.
//
// Two spellings of one list:
// - the DB enum `OnboardingStep` (uppercase, `ORDER`), which the resolver, the guards and the monotonic PATCH use;
// - the page (URL segment) = the lowercase wire value (`welcome` … `done`), which the routes and the stepper use.
import {
  ONBOARDING_STEPS,
  PENDING_CHECKOUT_TTL_MS,
  type OnboardingStepDb,
  type OnboardingStepWire,
} from "@repo/contracts/http/p04-plain";

export type OnbStep = OnboardingStepDb;
export type OnbPage = OnboardingStepWire;

/** DB order; `onboardingStep` only ever moves right (§7.2 SQL). */
export const ORDER = ["WELCOME", "LINK", "CONFIRM", "LEVEL", "GOALS", "PLAN", "ACTIVATING", "DONE"] as const satisfies readonly OnbStep[];

/** The URL segments under /onboarding, in the same order. */
export const PAGES = ONBOARDING_STEPS;

/** A pending checkout older than this is abandoned (§8.1 ACTIVATING); the contracts' zod-free module is the source. */
export { PENDING_CHECKOUT_TTL_MS };

export const ONBOARDING_ROOT = "/onboarding";

/** Where a finished member lands when nothing better is known (D4-13; P5 swaps in /home). */
export const DEFAULT_DESTINATION = "/games";

export function isOnbPage(value: unknown): value is OnbPage {
  return typeof value === "string" && (PAGES as readonly string[]).includes(value);
}

export function isOnbStep(value: unknown): value is OnbStep {
  return typeof value === "string" && (ORDER as readonly string[]).includes(value);
}

export function pageOf(step: OnbStep): OnbPage {
  return step.toLowerCase() as OnbPage;
}

export function stepOf(page: OnbPage): OnbStep {
  return page.toUpperCase() as OnbStep;
}

/** Position in ORDER of a step or page (0 = welcome … 7 = done). */
export function stepIndex(step: OnbStep | OnbPage): number {
  return ORDER.indexOf(step.toUpperCase() as OnbStep);
}

/** `/onboarding/<page>`. */
export function stepPath(page: OnbPage): string {
  return `${ONBOARDING_ROOT}/${page}`;
}

/** The four numbered stepper items of the frame (§4.0). */
export const STEPPER = [
  { n: 1, label: "Accounts" },
  { n: 2, label: "Level" },
  { n: 3, label: "Goals" },
  { n: 4, label: "Plan" },
] as const;

export type StepperItem = (typeof STEPPER)[number];

/**
 * Stepper position of a page: WELCOME, LINK, CONFIRM → 1, LEVEL → 2, GOALS → 3, PLAN, ACTIVATING → 4, DONE → 5
 * (every item done). Welcome is 0: no item current yet (V3OnbWelcome shows four plain numbers).
 */
export function stepperPosition(page: OnbPage): number {
  switch (page) {
    case "welcome":
      return 0;
    case "link":
    case "confirm":
      return 1;
    case "level":
      return 2;
    case "goals":
      return 3;
    case "plan":
    case "activating":
      return 4;
    case "done":
      return 5;
  }
}

export type StepperState = "done" | "current" | "todo";

/** State of stepper item `n` (1–4) on `page`. */
export function stepperState(page: OnbPage, n: number): StepperState {
  const at = stepperPosition(page);
  if (n < at) return "done";
  if (n === at) return "current";
  return "todo";
}

/** The page a done stepper item links back to. */
export function stepperTarget(n: number): OnbPage {
  return n === 1 ? "link" : n === 2 ? "level" : n === 3 ? "goals" : "plan";
}

/** The mobile header label: "Welcome" on the welcome step, else "Step N of 4 · Name", "All set" on done. */
export function stepLabel(page: OnbPage): string {
  const at = stepperPosition(page);
  if (at === 0) return "Welcome";
  if (at > STEPPER.length) return "All set";
  return `Step ${at} of ${STEPPER.length} · ${STEPPER[at - 1]!.label}`;
}

/**
 * The previous step's page for the back arrow and Alt+← when the page gives no better target (Level passes the
 * confirm URL of the linked account). Null on welcome and done (nothing to go back to).
 */
export function defaultBackPage(page: OnbPage): OnbPage | null {
  switch (page) {
    case "welcome":
    case "done":
      return null;
    case "link":
      return "welcome";
    case "confirm":
    case "level":
      return "link";
    case "goals":
      return "level";
    case "plan":
      return "goals";
    case "activating":
      return "plan";
  }
}
