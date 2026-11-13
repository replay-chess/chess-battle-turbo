// /dev/ui/onboarding/activating?state= (V3OnbActivating): polling (the import waits for the trial, D4-07), stalled,
// success (the import running, 212 / 480); then paid_polling / paid_success (a checkout without a trial) and failed
// (the live step replaces it with /onboarding/plan?status=failed at once; drawn here so its fallback is reachable).
import { StaticBoard } from "@/components/board/StaticBoard";
import type { ActivationCardPhase } from "@/components/billing/ActivationCard";
import { ImportProgressCard } from "@/components/import/ImportProgressCard";
import { ActivatingPanel } from "@/components/onboarding/ActivatingStep";
import { LEGEND_POSITION } from "@/lib/onboarding/sample-puzzles";
import { demoCard, demoRun } from "./import-fixtures";
import type { OnboardingDemo } from "./types";

function phaseOf(state: string): ActivationCardPhase {
  if (state === "stalled" || state === "success" || state === "failed") return state;
  if (state === "paid_success") return "success";
  return "polling";
}

export const activatingDemo: OnboardingDemo = {
  page: "activating",
  board: "V3OnbActivating",
  states: ["polling", "stalled", "success", "paid_polling", "paid_success", "failed"],
  render: (state, { stress }) => {
    const phase = phaseOf(state);
    const isTrial = !state.startsWith("paid_");
    const view =
      phase === "success"
        ? demoCard("activating", demoRun({}, stress))
        : demoCard("activating", demoRun({ status: "waiting_for_membership", phase: null, imported: 0, total: null, seen: 0 }, stress), { entitled: false });
    return (
      <ActivatingPanel
        phase={phase}
        isTrial={isTrial}
        chargeDateLabel="6 Nov"
        checking={false}
        supportHref={`/contact?topic=billing&ref=${encodeURIComponent(stress ? "sub_8F2KXQ9P…Q1" : "sub_8F2K…Q1")}`}
        planHref="/onboarding/plan?status=failed&plan=monthly"
        importCard={<ImportProgressCard view={view} />}
        board={<StaticBoard fen={LEGEND_POSITION.fen} label={LEGEND_POSITION.label} />}
      />
    );
  },
};
