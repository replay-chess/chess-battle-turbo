// /dev/ui/onboarding/done?state= (V3OnbDone): importing (saving, with the ETA), import_failed, imported; then the
// undrawn rows: importing_reading ("{seen} found"), nothing_linked, zero_games, trial_starting (Go to Home disabled,
// "Almost there…"), paid_member (no trial tag) and no_legend (D4-14: the legacy position is missing, CTA hidden).
import { StaticBoard } from "@/components/board/StaticBoard";
import { ImportProgressCard } from "@/components/import/ImportProgressCard";
import { DonePanel, type DonePanelProps } from "@/components/onboarding/DoneStep";
import { LEGEND_POSITION } from "@/lib/onboarding/sample-puzzles";
import { FIRST_REVIEW, demoCard, demoRun } from "./import-fixtures";
import type { OnboardingDemo } from "./types";

export const doneDemo: OnboardingDemo = {
  page: "done",
  board: "V3OnbDone",
  states: ["importing", "import_failed", "imported", "importing_reading", "nothing_linked", "zero_games", "trial_starting", "paid_member", "no_legend"],
  render: (state, { stress }) => {
    const board = <StaticBoard fen={LEGEND_POSITION.fen} label={LEGEND_POSITION.label} />;
    const base: Omit<DonePanelProps, "importCard"> = {
      entitled: true,
      trialActive: true,
      daysLeft: 7,
      providers: "Chess.com",
      board,
      legendHref: "/position/demo",
      leaving: null,
    };
    const run = (over: Parameters<typeof demoRun>[0]) => demoRun(over, stress);
    let props: DonePanelProps;
    switch (state) {
      case "import_failed":
        props = { ...base, importCard: <ImportProgressCard view={demoCard("done", run({ status: "failed", error: { code: "upstream", at: "2026-10-30T12:00:00.000Z", retryAt: null } }))} /> };
        break;
      case "imported":
        props = { ...base, importCard: <ImportProgressCard view={demoCard("done", run({ status: "done", phase: null, imported: stress ? 20_000 : 480 }), { firstReview: FIRST_REVIEW })} /> };
        break;
      case "importing_reading":
        props = { ...base, importCard: <ImportProgressCard view={demoCard("done", run({ phase: "reading", total: null, imported: 0, seen: stress ? 12_480 : 212 }))} /> };
        break;
      case "nothing_linked":
        props = { ...base, providers: null, importCard: <ImportProgressCard view={demoCard("done", null, { linked: [] })} /> };
        break;
      case "zero_games":
        props = { ...base, importCard: <ImportProgressCard view={demoCard("done", run({ status: "done", phase: null, imported: 0, total: 0, seen: 0 }))} /> };
        break;
      case "trial_starting":
        props = {
          ...base,
          entitled: false,
          trialActive: false,
          daysLeft: null,
          importCard: <ImportProgressCard view={demoCard("done", run({ status: "waiting_for_membership", phase: null, imported: 0, total: null, seen: 0 }), { entitled: false })} />,
        };
        break;
      case "paid_member":
        props = { ...base, trialActive: false, daysLeft: null, importCard: <ImportProgressCard view={demoCard("done", run({}), { etaSec: 130 })} /> };
        break;
      case "no_legend":
        props = { ...base, legendHref: null, importCard: <ImportProgressCard view={demoCard("done", run({}), { etaSec: 130 })} /> };
        break;
      default:
        props = { ...base, importCard: <ImportProgressCard view={demoCard("done", run({}), { etaSec: 130 })} /> };
    }
    return <DonePanel {...props} />;
  },
};
