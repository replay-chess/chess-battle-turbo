// /dev/ui/onboarding/welcome?state= (V3OnbWelcome): default, trial_used, already_linked.
import { StaticBoard } from "@/components/board/StaticBoard";
import { WelcomeStep } from "@/components/onboarding/WelcomeStep";
import { LEGEND_POSITION } from "@/lib/onboarding/sample-puzzles";
import { STRESS_NAME, type OnboardingDemo } from "./types";

export const welcomeDemo: OnboardingDemo = {
  page: "welcome",
  board: "V3OnbWelcome",
  states: ["default", "trial_used", "already_linked"],
  render: (state, { stress }) => (
    <WelcomeStep
      demo
      name={stress ? STRESS_NAME : "knightowl_88"}
      trialEligible={state !== "trial_used"}
      linked={state === "already_linked"}
      board={<StaticBoard fen={LEGEND_POSITION.fen} label={LEGEND_POSITION.label} />}
    />
  ),
};
