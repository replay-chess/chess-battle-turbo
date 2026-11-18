import type { Metadata } from "next";
import Link from "next/link";
import { ViewportStage } from "@/components/layout/ViewportStage";
import { AppShellView } from "@/components/shell/AppShellView";
import { WEAKNESS_DEMO_STATES } from "@/components/train/weakness/demo-state-names";
import { WeaknessDemo } from "@/components/train/weakness/WeaknessDemo";
import { isStress, pickState } from "../_fixtures/train";
import { GalleryFrame } from "../_components/Specimen";
import { stageUser } from "../stage/demo-data";

export const metadata: Metadata = { title: "Weakness Profile Demo", robots: { index: false, follow: false } };

type SearchParams = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/**
 * `/dev/ui/weakness` (phase-06 plan §4.1, §7.6, §7.10): /train/weakness in each state of DR/V3WeaknessInsufficient,
 * V3WeaknessComputing, V3WeaknessProfile, V3WeaknessDrill and the iPhone, Android, iPad L and iPad P profile boards,
 * from WP1's fixtures, with no server. Fails closed outside dev/test (app/dev/layout.tsx). Params:
 *   state=<one of WEAKNESS_DEMO_STATES>   (no state: the index)
 *   lesson=1      the P8 legend-lesson slots filled (row link, drill-config row, week-plan row)
 *   stress=1      the longest labels, names and 3-digit counts (TE X9)
 *   chrome=none   no app shell
 *   device=auto   accepted for the device suite; the viewport decides the layout
 */
export default async function WeaknessDemoPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const p = await searchParams;
  const raw = one(p.state);
  const stress = isStress(p);
  const lesson = one(p.lesson) === "1";
  if (!raw && !stress && !lesson) return <StateIndex />;
  const state = pickState(WEAKNESS_DEMO_STATES, raw ?? "ready");
  const demo = <WeaknessDemo key={`${state}-${stress}-${lesson}`} state={state} lesson={lesson} stress={stress} />;
  if (one(p.chrome) === "none") return <ViewportStage>{demo}</ViewportStage>;
  return (
    <AppShellView user={stageUser({ payment: false, stress })} demo currentKey="train" navFlags={{ "review-v3": true, train: true, home: true }}>
      {demo}
    </AppShellView>
  );
}

function StateIndex() {
  return (
    <GalleryFrame title="Weakness Profile Demo">
      <p className="mb-4 text-body text-cb-text-soft">/train/weakness (phase-06 plan §4) in each design state, on WP1&apos;s payload fixtures.</p>
      <ul className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-1" data-testid="weakness-demo-index">
        {WEAKNESS_DEMO_STATES.map((s) => (
          <li key={s}>
            <Link className="font-mono text-label underline" href={`/dev/ui/weakness?state=${s}`} prefetch={false}>
              {s}
            </Link>
          </li>
        ))}
        <li>
          <Link className="font-mono text-label underline" href="/dev/ui/weakness?state=ready&lesson=1" prefetch={false}>
            ready + lesson=1
          </Link>
        </li>
        <li>
          <Link className="font-mono text-label underline" href="/dev/ui/weakness?state=drill&lesson=1" prefetch={false}>
            drill + lesson=1
          </Link>
        </li>
        <li>
          <Link className="font-mono text-label underline" href="/dev/ui/weakness?state=ready&stress=1" prefetch={false}>
            ready + stress=1
          </Link>
        </li>
      </ul>
    </GalleryFrame>
  );
}
