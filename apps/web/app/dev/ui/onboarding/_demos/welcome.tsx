// /dev/ui/onboarding/welcome?state= (V3OnbWelcome): default, trial_used, already_linked, plus trialing (already a
// member when setup starts: a trial bought at /pricing first, D9).
import { StaticBoard } from "@/components/board/StaticBoard";
import { WelcomeStep } from "@/components/onboarding/WelcomeStep";
import { LEGEND_POSITION } from "@/lib/onboarding/sample-puzzles";
import { STRESS_NAME, type OnboardingDemo } from "./types";

export const welcomeDemo: OnboardingDemo = {
  page: "welcome",
  board: "V3OnbWelcome",
  states: ["default", "trial_used", "already_linked", "trialing"],
  render: (state, { stress }) => (
    <WelcomeStep
      demo
      name={stress ? STRESS_NAME : "knightowl_88"}
      trialEligible={state !== "trial_used" && state !== "trialing"}
      membership={state === "trialing" ? { kind: "trial", daysLeft: 7 } : null}
      linked={state === "already_linked"}
      board={<StaticBoard fen={LEGEND_POSITION.fen} label={LEGEND_POSITION.label} />}
    />
  ),
};
