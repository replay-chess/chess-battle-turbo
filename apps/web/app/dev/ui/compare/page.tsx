import type { Metadata } from "next";
import Link from "next/link";
import { ViewportStage } from "@/components/layout/ViewportStage";
import { AppShellView } from "@/components/shell/AppShellView";
import { CompareDemo } from "@/features/legend-compare/demo/CompareDemo";
import { COMPARE_DEMO_STATES, isCompareDemoState } from "@/features/legend-compare/demo/states";
import { COMPARE_TABS, isCompareTab } from "@/features/legend-compare/model";
import { GalleryFrame } from "../_components/Specimen";
import { stageUser } from "../stage/demo-data";

export const metadata: Metadata = { title: "Compare Demo", robots: { index: false, follow: false } };

type SearchParams = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/**
 * `/dev/ui/compare` (phase-03 plan §4.10): the Compare with the Legend screen in each design state of
 * DR/V3LegendCompare and the §4.6 variants, with no server. Fails closed outside dev/test (app/dev/layout.tsx).
 *   state=default|loading|no_explanation|audio_failed|error|followed|opponent_left|pending_evals   (no state: index)
 *   tab=explanation|your_moves|legend_moves|practice
 *   stress=1      20-character names, the longest legend title
 *   chrome=none   no app shell      device=auto   accepted for the device suite
 */
export default async function CompareDemoPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const p = await searchParams;
  const s = one(p.state);
  const t = one(p.tab);
  const stress = one(p.stress) === "1";
  if (!isCompareDemoState(s) && !isCompareTab(t) && !stress) return <StateIndex />;
  const state = isCompareDemoState(s) ? s : "default";
  const tab = isCompareTab(t) ? t : null;
  const demo = <CompareDemo key={`${state}-${tab}-${stress}`} state={state} tab={tab} stress={stress} />;
  if (one(p.chrome) === "none") return <ViewportStage>{demo}</ViewportStage>;
  return (
    <AppShellView user={stageUser({ payment: false, stress })} demo hideTabBar currentKey="review" backTo={{ key: "review", href: "/dev/ui/review", label: "Review" }} navFlags={{ "review-v3": true }}>
      {demo}
    </AppShellView>
  );
}

function StateIndex() {
  return (
    <GalleryFrame title="Compare Demo">
      <p className="mb-4 text-body text-cb-text-soft">Compare with the legend (phase-03 plan §4.6) in each design state, on fixtures.</p>
      <ul className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-1" data-testid="compare-demo-index">
        {COMPARE_DEMO_STATES.map((s) => (
          <li key={s}>
            <Link className="font-mono text-label underline" href={`/dev/ui/compare?state=${s}`} prefetch={false}>
              {s}
            </Link>
          </li>
        ))}
        {COMPARE_TABS.map((t) => (
          <li key={t}>
            <Link className="font-mono text-label underline" href={`/dev/ui/compare?state=default&tab=${t}`} prefetch={false}>
              tab={t}
            </Link>
          </li>
        ))}
        <li>
          <Link className="font-mono text-label underline" href="/dev/ui/compare?state=default&stress=1" prefetch={false}>
            stress=1
          </Link>
        </li>
      </ul>
    </GalleryFrame>
  );
}
