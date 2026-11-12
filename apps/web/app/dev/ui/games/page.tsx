import type { Metadata } from "next";
import Link from "next/link";
import { ViewportStage } from "@/components/layout/ViewportStage";
import { AppShellView } from "@/components/shell/AppShellView";
import { GamesArchiveDemo } from "@/features/games/demo/GamesArchiveDemo";
import { DEMO_STATES, isDemoState } from "@/features/games/demo/fixtures";
import { GalleryFrame } from "../_components/Specimen";
import { stageUser } from "../stage/demo-data";

export const metadata: Metadata = { title: "My Games Demo", robots: { index: false, follow: false } };

type SearchParams = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/**
 * `/dev/ui/games` (phase-03 plan §4.10): the /games screen in each design state of DR/V3GamesArchive*, with no
 * server. Fails closed outside dev/test (app/dev/layout.tsx). Params:
 *   state=default|filters_open|empty|loading|error   (no state: the index; `import_running` is P4's)
 *   stress=1          120 rows, 20-character names, the longest opening
 *   next=error        the next page fails (the inline "Couldn't load more · Try Again" row)
 *   chrome=none       no app shell
 *   device=auto       accepted for the device suite; the viewport decides the layout
 */
export default async function GamesDemoPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const p = await searchParams;
  const stateParam = one(p.state);
  const stress = one(p.stress) === "1";
  if (!isDemoState(stateParam) && !stress) return <StateIndex />;
  const state = isDemoState(stateParam) ? stateParam : "default";
  const nextError = one(p.next) === "error";
  // A new key per parameter set: client navigation between states rebuilds the demo's local state.
  const demo = <GamesArchiveDemo key={`${state}-${stress}-${nextError}`} state={state} stress={stress} nextError={nextError} />;
  if (one(p.chrome) === "none") return <ViewportStage>{demo}</ViewportStage>;
  return (
    <AppShellView user={stageUser({ payment: false, stress })} demo currentKey="review" navFlags={{ "review-v3": true }}>
      {demo}
    </AppShellView>
  );
}

function StateIndex() {
  return (
    <GalleryFrame title="My Games Demo">
      <p className="mb-4 text-body text-cb-text-soft">
        The /games screen (phase-03 plan §4.9) in each design state, on fixtures.
      </p>
      <ul className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-1" data-testid="games-demo-index">
        {DEMO_STATES.map((s) => (
          <li key={s}>
            <Link className="font-mono text-label underline" href={`/dev/ui/games?state=${s}`} prefetch={false}>
              {s}
            </Link>
          </li>
        ))}
        <li>
          <Link className="font-mono text-label underline" href="/dev/ui/games?stress=1" prefetch={false}>
            stress=1
          </Link>
        </li>
        <li>
          <Link className="font-mono text-label underline" href="/dev/ui/games?state=default&next=error" prefetch={false}>
            next=error
          </Link>
        </li>
      </ul>
    </GalleryFrame>
  );
}
