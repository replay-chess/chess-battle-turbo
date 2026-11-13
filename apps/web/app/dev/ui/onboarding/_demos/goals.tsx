// /dev/ui/onboarding/goals?state= (V3OnbGoals): default (Stop blundering + Study legends, 10 min), none_selected;
// then all_goals_5_min (every chip, the one-minute floor, Play friends "ANYTIME") and only_friends.
import { GoalsStep } from "@/components/onboarding/GoalsStep";
import { DEFAULT_GOALS, DEFAULT_MINUTES, GOAL_ORDER } from "@/lib/onboarding/day-preview";
import type { OnboardingDemo } from "./types";

export const goalsDemo: OnboardingDemo = {
  page: "goals",
  board: "V3OnbGoals",
  states: ["default", "none_selected", "all_goals_5_min", "only_friends"],
  render: (state) => {
    switch (state) {
      case "none_selected":
        return <GoalsStep demo initialGoals={[]} initialMinutes={DEFAULT_MINUTES} />;
      case "all_goals_5_min":
        return <GoalsStep demo initialGoals={[...GOAL_ORDER]} initialMinutes={5} />;
      case "only_friends":
        return <GoalsStep demo initialGoals={["PLAY_FRIENDS"]} initialMinutes={20} />;
      default:
        return <GoalsStep demo initialGoals={[...DEFAULT_GOALS]} initialMinutes={DEFAULT_MINUTES} />;
    }
  },
};
