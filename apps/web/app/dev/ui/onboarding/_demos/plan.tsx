// /dev/ui/onboarding/plan?state= (V3OnbPlan): default, loading, yearly (the board's `plan` prop); then the undrawn
// rows: trial_used, failed (?status=failed), abandoned (?resume=abandoned), start_error (inline Retry + request id),
// not_configured (503).
import { PlanStep, type PlanStepProps } from "@/components/onboarding/PlanStep";
import { planBanner } from "@/lib/onboarding/plan-view";
import type { OnboardingDemo } from "./types";

const BASE: PlanStepProps = {
  demo: true,
  trialEligible: true,
  initialPlan: "monthly",
  banner: null,
  chargeDateLabel: "6 Nov",
  providers: "Chess.com",
  timeZone: "UTC",
  // 30 Oct + 7 days = 6 Nov, the board's date.
  nowIso: "2026-10-30T12:00:00.000Z",
  watch: null,
};

export const planDemo: OnboardingDemo = {
  page: "plan",
  board: "V3OnbPlan",
  states: ["default", "loading", "yearly", "trial_used", "failed", "abandoned", "start_error", "not_configured"],
  render: (state, { stress }) => {
    const props: PlanStepProps = { ...BASE, providers: stress ? "Chess.com and Lichess" : BASE.providers };
    switch (state) {
      case "loading":
        return <PlanStep {...props} demoState="loading" />;
      case "yearly":
        return <PlanStep {...props} initialPlan="yearly" />;
      case "trial_used":
        return <PlanStep {...props} trialEligible={false} chargeDateLabel={null} />;
      case "failed":
        return <PlanStep {...props} banner={planBanner({ status: "failed" })} />;
      case "abandoned":
        return <PlanStep {...props} banner={planBanner({ resume: "abandoned" })} />;
      case "start_error":
        return <PlanStep {...props} demoState="start_error" />;
      case "not_configured":
        return <PlanStep {...props} demoState="not_configured" />;
      default:
        return <PlanStep {...props} />;
    }
  },
};
