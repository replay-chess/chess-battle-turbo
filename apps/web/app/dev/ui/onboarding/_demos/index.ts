// The onboarding demo registry (phase-04 plan §4.12). One file per step; add a step with its file and one line here.
import { activatingDemo } from "./activating";
import { confirmDemo } from "./confirm";
import { doneDemo } from "./done";
import { goalsDemo } from "./goals";
import { levelDemo } from "./level";
import { linkDemo } from "./link";
import { planDemo } from "./plan";
import type { OnboardingDemo } from "./types";
import { welcomeDemo } from "./welcome";

export type { OnboardingDemo } from "./types";

export const ONBOARDING_DEMOS: Readonly<Record<string, OnboardingDemo>> = {
  welcome: welcomeDemo,
  link: linkDemo,
  confirm: confirmDemo,
  level: levelDemo,
  goals: goalsDemo,
  plan: planDemo,
  activating: activatingDemo,
  done: doneDemo,
};
