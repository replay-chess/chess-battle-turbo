import type { Metadata } from "next";
import Link from "next/link";
import { HomeSkeleton } from "@/components/home/HomeSkeleton";
import { HomeView } from "@/components/home/HomeView";
import { ViewportStage } from "@/components/layout/ViewportStage";
import { AppShellView } from "@/components/shell/AppShellView";
import { GalleryFrame } from "../_components/Specimen";
import { HOME_DEMO_STATES, homeDemo, type HomeDemoState } from "../_fixtures/train";
import { stageUser } from "../stage/demo-data";

export const metadata: Metadata = { title: "Home Demo", robots: { index: false, follow: false } };

type SearchParams = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
const isState = (v: string | undefined): v is HomeDemoState => (HOME_DEMO_STATES as readonly string[]).includes(v ?? "");

/**
 * `/dev/ui/home` (phase-05 plan §4.1, §2.1 demo routes): the Home screen in each design state of DR/V3Home,
 * V3HomeNewUser and V3HomeLoading on the contract fixtures, with no server. Fails closed outside dev/test
 * (app/dev/layout.tsx). Params:
 *   state=populated|new_user|loading|import_running|payment_failed|trial|analysing|clean|nothing_due
 *   stress=1      the longest names, 4-digit counts, a 9,999-game import
 *   chrome=none   no app shell
 * `payment_failed` and `trial` are the shell's own rows (its payment banner, its trial tag), as on the live page.
 */
export default async function HomeDemoPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const p = await searchParams;
  const stateParam = one(p.state);
  const stress = one(p.stress) === "1";
  if (!isState(stateParam) && !stress) return <StateIndex />;
  const state: HomeDemoState = isState(stateParam) ? stateParam : "populated";
  const demo = homeDemo(state, stress);
  const screen = demo ? <HomeView data={demo.data} profileHref="#profile" /> : <HomeSkeleton />;
  if (one(p.chrome) === "none") return <ViewportStage>{screen}</ViewportStage>;
  const user = { ...stageUser({ payment: demo?.shell.paymentFailed ?? false, stress }), trialDaysLeft: demo?.shell.trialDaysLeft ?? null };
  return (
    <AppShellView user={user} demo currentKey="home" navFlags={{ "review-v3": true, home: true, train: true }}>
      {screen}
    </AppShellView>
  );
}

function StateIndex() {
  return (
    <GalleryFrame title="Home Demo">
      <p className="mb-4 text-body text-cb-text-soft">The /home screen (phase-05 plan §4.1) in each design state, on fixtures.</p>
      <ul className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-1" data-testid="home-demo-index">
        {HOME_DEMO_STATES.map((s) => (
          <li key={s}>
            <Link className="font-mono text-label underline" href={`/dev/ui/home?state=${s}`} prefetch={false}>
              {s}
            </Link>
          </li>
        ))}
        <li>
          <Link className="font-mono text-label underline" href="/dev/ui/home?stress=1" prefetch={false}>
            stress=1
          </Link>
        </li>
      </ul>
    </GalleryFrame>
  );
}
