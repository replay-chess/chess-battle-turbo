import type { Metadata } from "next";
import Link from "next/link";
import { ViewportStage } from "@/components/layout/ViewportStage";
import { AppShellView } from "@/components/shell/AppShellView";
import { TrainerDemo } from "@/components/train/runner/TrainerDemo";
import { RUNNER_DEMO_STATES, isStress, pickState, runnerDemo } from "../../_fixtures/train";
import { GalleryFrame } from "../../_components/Specimen";
import { stageUser } from "../../stage/demo-data";

export const metadata: Metadata = { title: "Mistake Bank Drill Demo", robots: { index: false, follow: false } };

type SearchParams = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/**
 * `/dev/ui/train/runner` (phase-05 plan §2.1, §4.4): the real TrainerRunner (bank mode) in each state of
 * DR/V3BankSession (and the puzzle device boards with the bank header), from contract fixtures and a script of user actions, with no server, outbox or socket. Fails closed
 * outside dev/test (app/dev/layout.tsx). Params:
 *   state=solve|hint|hint_arrow|wrong|correct|solution|themes|done|saving|broken|review_position|resumed|caughtup|
 *                     cap_reached|nothing_matches   (no state: the index)
 *   stress=1          20+ items, 40-character opponent names, three-digit move numbers
 *   chrome=none       no app shell
 *   device=auto       accepted for the device suite; the viewport decides the layout
 */
export default async function TrainRunnerDemoPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const p = await searchParams;
  const raw = one(p.state);
  const stress = isStress(p);
  if (!raw && !stress) return <StateIndex />;
  const state = pickState(RUNNER_DEMO_STATES, raw);
  const d = runnerDemo(state, stress);
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
    <GalleryFrame title="Mistake Bank Drill Demo">
      <p className="mb-4 text-body text-cb-text-soft">/train/bank/session (phase-05 plan §4.4) in each design state, on contract fixtures.</p>
      <ul className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-1" data-testid="train-runner-demo-index">
        {RUNNER_DEMO_STATES.map((s) => (
          <li key={s}>
            <Link className="font-mono text-label underline" href={`/dev/ui/train/runner?state=${s}`} prefetch={false}>
              {s}
            </Link>
          </li>
        ))}
        <li>
          <Link className="font-mono text-label underline" href="/dev/ui/train/runner?state=solve&stress=1" prefetch={false}>
            stress=1
          </Link>
        </li>
      </ul>
    </GalleryFrame>
  );
}
