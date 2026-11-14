import type { Metadata } from "next";
import Link from "next/link";
import { ViewportStage } from "@/components/layout/ViewportStage";
import { AppShellView } from "@/components/shell/AppShellView";
import { TrainerDemo } from "@/components/train/runner/TrainerDemo";
import { PUZZLE_DEMO_STATES, isStress, pickState, puzzlesDemo } from "../../_fixtures/train";
import { GalleryFrame } from "../../_components/Specimen";
import { stageUser } from "../../stage/demo-data";

export const metadata: Metadata = { title: "Puzzle Session Demo", robots: { index: false, follow: false } };

type SearchParams = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/**
 * `/dev/ui/train/puzzles` (phase-05 plan §2.1, §4.5, §4.6): the real TrainerRunner (puzzles mode) in each state of
 * DR/V3Puzzle{Solve,Hint,Wrong,Correct,Solution,Themes} and V3{iPhone,Android,iPadL,iPadP}Puzzle, from contract fixtures and a script of user actions, with no server, outbox or socket. Fails closed
 * outside dev/test (app/dev/layout.tsx). Params:
 *   state=solve|hint|hint_arrow|wrong|correct|solution|themes|done|saving|broken|resumed   (no state: the index)
 *   stress=1          20+ items, 40-character opponent names, three-digit move numbers,
 *                     a widened rating window
 *   chrome=none       no app shell
 *   device=auto       accepted for the device suite; the viewport decides the layout
 */
export default async function TrainPuzzlesDemoPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const p = await searchParams;
  const raw = one(p.state);
  const stress = isStress(p);
  if (!raw && !stress) return <StateIndex />;
  const state = pickState(PUZZLE_DEMO_STATES, raw);
  const d = puzzlesDemo(state, stress);
  const demo = <TrainerDemo key={`${state}-${stress}`} payload={d.payload} script={d.script} pendingOutbox={d.pendingOutbox} />;
  if (one(p.chrome) === "none") return <ViewportStage>{demo}</ViewportStage>;
  return (
    <AppShellView
      user={stageUser({ payment: false, stress })}
      demo
      hideTabBar
      currentKey="train"
      backTo={{ key: "train", href: "/dev/ui/train/hub", label: "Train" }}
      navFlags={{ "review-v3": true, train: true, home: true }}
    >
      {demo}
    </AppShellView>
  );
}

function StateIndex() {
  return (
    <GalleryFrame title="Puzzle Session Demo">
      <p className="mb-4 text-body text-cb-text-soft">/train/puzzles (phase-05 plan §4.5) in each design state, on contract fixtures.</p>
      <ul className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-1" data-testid="train-puzzles-demo-index">
        {PUZZLE_DEMO_STATES.map((s) => (
          <li key={s}>
            <Link className="font-mono text-label underline" href={`/dev/ui/train/puzzles?state=${s}`} prefetch={false}>
              {s}
            </Link>
          </li>
        ))}
        <li>
          <Link className="font-mono text-label underline" href="/dev/ui/train/puzzles?state=solve&stress=1" prefetch={false}>
            stress=1
          </Link>
        </li>
      </ul>
    </GalleryFrame>
  );
}
