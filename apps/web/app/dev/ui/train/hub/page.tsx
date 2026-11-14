import type { Metadata } from "next";
import Link from "next/link";
import { ViewportStage } from "@/components/layout/ViewportStage";
import { AppShellView } from "@/components/shell/AppShellView";
import { HubDemo } from "@/components/train/hub/HubDemo";
import { HUB_DEMO_STATES, isStress, pickState } from "../../_fixtures/train";
import { GalleryFrame } from "../../_components/Specimen";
import { stageUser } from "../../stage/demo-data";

export const metadata: Metadata = { title: "Train Hub Demo", robots: { index: false, follow: false } };

type SearchParams = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/**
 * `/dev/ui/train/hub` (phase-05 plan §2.1, §4.2): /train in each state of DR/V3TrainHub, V3TrainHubDone,
 * V3TrainHubLoading and the iPhone, Android, iPad L and iPad P hub boards, from contract fixtures, with no server.
 * Fails closed outside dev/test (app/dev/layout.tsx). Params:
 *   state=default|nothingdue|loading|cap_reached|partial|new_user   (no state: the index)
 *                     loading = the in-place plan skeleton (the board); add route=1 for loading.tsx's full skeleton
 *   stress=1          365-day streak, the longest labels and counts, an unusual zone
 *   chrome=none       no app shell
 *   device=auto       accepted for the device suite; the viewport decides the layout
 */
export default async function TrainHubDemoPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const p = await searchParams;
  const raw = one(p.state);
  const stress = isStress(p);
  if (!raw && !stress) return <StateIndex />;
  const state = pickState(HUB_DEMO_STATES, raw);
  const demo = <HubDemo key={`${state}-${stress}-${one(p.route)}`} state={state} stress={stress} routeSkeleton={one(p.route) === "1"} />;
  if (one(p.chrome) === "none") return <ViewportStage>{demo}</ViewportStage>;
  return (
    <AppShellView user={stageUser({ payment: false, stress })} demo currentKey="train" navFlags={{ "review-v3": true, train: true, home: true }}>
      {demo}
    </AppShellView>
  );
}

function StateIndex() {
  return (
    <GalleryFrame title="Train Hub Demo">
      <p className="mb-4 text-body text-cb-text-soft">/train (phase-05 plan §4.2) in each design state, on contract fixtures.</p>
      <ul className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-1" data-testid="train-hub-demo-index">
        {HUB_DEMO_STATES.map((s) => (
          <li key={s}>
            <Link className="font-mono text-label underline" href={`/dev/ui/train/hub?state=${s}`} prefetch={false}>
              {s}
            </Link>
          </li>
        ))}
        <li>
          <Link className="font-mono text-label underline" href="/dev/ui/train/hub?state=loading&route=1" prefetch={false}>
            loading (route)
          </Link>
        </li>
        <li>
          <Link className="font-mono text-label underline" href="/dev/ui/train/hub?state=default&stress=1" prefetch={false}>
            stress=1
          </Link>
        </li>
      </ul>
    </GalleryFrame>
  );
}
