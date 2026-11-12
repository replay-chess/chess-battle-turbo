import type { Metadata } from "next";
import Link from "next/link";
import { ViewportStage } from "@/components/layout/ViewportStage";
import { AppShellView } from "@/components/shell/AppShellView";
import { PracticeDemo } from "@/features/practice/demo/PracticeDemo";
import {
  isPracticeDemoSource,
  isPracticeDemoState,
  PRACTICE_DEMO_SOURCES,
  PRACTICE_DEMO_STATES,
} from "@/features/practice/demo/states";
import { GalleryFrame } from "../_components/Specimen";
import { stageUser } from "../stage/demo-data";

export const metadata: Metadata = { title: "Practice Demo", robots: { index: false, follow: false } };

type SearchParams = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/**
 * `/dev/ui/practice` (phase-03 plan §4.10): the Practice screen in each state of DR/V3Practice, with no server. Fails
 * closed outside dev/test (app/dev/layout.tsx).
 *   state=default|engine_loading|engine_failed|offline|over   (no state: the index)
 *   source=game|position|fen   (default game: a legend game, so Compare shows)
 *   stress=1      a 20-character name, the longest title
 *   chrome=none   no app shell      device=auto   accepted for the device suite
 */
export default async function PracticeDemoPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const p = await searchParams;
  const s = one(p.state);
  const stress = one(p.stress) === "1";
  if (!isPracticeDemoState(s) && !stress) return <StateIndex />;
  const state = isPracticeDemoState(s) ? s : "default";
  const src = one(p.source);
  const source = isPracticeDemoSource(src) ? src : "game";
  const demo = <PracticeDemo key={`${state}-${source}-${stress}`} state={state} source={source} stress={stress} />;
  if (one(p.chrome) === "none") return <ViewportStage>{demo}</ViewportStage>;
  return (
    <AppShellView user={stageUser({ payment: false, stress })} demo currentKey="review" backTo={{ key: "review", href: "/dev/ui/review", label: "Review" }} navFlags={{ "review-v3": true }}>
      {demo}
    </AppShellView>
  );
}

function StateIndex() {
  return (
    <GalleryFrame title="Practice Demo">
      <p className="mb-4 text-body text-cb-text-soft">Practice from a position (phase-03 plan §4.8) in each state, on fixtures.</p>
      <ul className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-1" data-testid="practice-demo-index">
        {PRACTICE_DEMO_STATES.map((s) => (
          <li key={s}>
            <Link className="font-mono text-label underline" href={`/dev/ui/practice?state=${s}`} prefetch={false}>
              {s}
            </Link>
          </li>
        ))}
        {PRACTICE_DEMO_SOURCES.map((src) => (
          <li key={src}>
            <Link className="font-mono text-label underline" href={`/dev/ui/practice?state=default&source=${src}`} prefetch={false}>
              source={src}
            </Link>
          </li>
        ))}
        <li>
          <Link className="font-mono text-label underline" href="/dev/ui/practice?state=default&stress=1" prefetch={false}>
            stress=1
          </Link>
        </li>
      </ul>
    </GalleryFrame>
  );
}
