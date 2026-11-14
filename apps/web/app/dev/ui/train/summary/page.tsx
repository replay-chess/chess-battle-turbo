import type { Metadata } from "next";
import Link from "next/link";
import { ViewportStage } from "@/components/layout/ViewportStage";
import { AppShellView } from "@/components/shell/AppShellView";
import { SummaryScreen } from "@/components/train/summary/SummaryScreen";
import { isStress, pickState, SUMMARY_DEMO_STATES, summaryDemo } from "../../_fixtures/train";
import { GalleryFrame } from "../../_components/Specimen";
import { stageUser } from "../../stage/demo-data";

export const metadata: Metadata = { title: "Session Summary Demo", robots: { index: false, follow: false } };

type SearchParams = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/**
 * `/dev/ui/train/summary` (phase-05 plan §2.1, §4.7): the session summary in each state of DR/V3SessionSummary and
 * V3SessionPerfect, plus the puzzles variant and the "Saving your results…" state, from contract fixtures, with no
 * server. Fails closed outside dev/test (app/dev/layout.tsx). Params:
 *   state=default|perfect|puzzles|saving   (no state: the index)
 *   stress=1          40 items, the longest labels
 *   chrome=none       no app shell
 *   device=auto       accepted for the device suite; the viewport decides the layout
 */
export default async function TrainSummaryDemoPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const p = await searchParams;
  const raw = one(p.state);
  const stress = isStress(p);
  if (!raw && !stress) return <StateIndex />;
  const state = pickState(SUMMARY_DEMO_STATES, raw);
  const d = summaryDemo(state, stress);
  const demo = <SummaryScreen key={`${state}-${stress}`} summary={d.summary} clientGraded={d.clientGraded} demo />;
  if (one(p.chrome) === "none") return <ViewportStage>{demo}</ViewportStage>;
  return (
    <AppShellView user={stageUser({ payment: false, stress })} demo currentKey="train" navFlags={{ "review-v3": true, train: true, home: true }}>
      {demo}
    </AppShellView>
  );
}

function StateIndex() {
  return (
    <GalleryFrame title="Session Summary Demo">
      <p className="mb-4 text-body text-cb-text-soft">/train/session/[ref]/summary (phase-05 plan §4.7) in each design state, on contract fixtures.</p>
      <ul className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-1" data-testid="train-summary-demo-index">
        {SUMMARY_DEMO_STATES.map((s) => (
          <li key={s}>
            <Link className="font-mono text-label underline" href={`/dev/ui/train/summary?state=${s}`} prefetch={false}>
              {s}
            </Link>
          </li>
        ))}
        <li>
          <Link className="font-mono text-label underline" href="/dev/ui/train/summary?state=default&stress=1" prefetch={false}>
            stress=1
          </Link>
        </li>
      </ul>
    </GalleryFrame>
  );
}
