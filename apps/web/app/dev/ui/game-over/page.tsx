import type { Metadata } from "next";
import Link from "next/link";
import { DESIGN_STATES, isDesignState } from "@/features/game/demo/fixtures";
import { ViewportStage } from "@/components/layout/ViewportStage";
import { AppShellView } from "@/components/shell/AppShellView";
import { GameOverDemo } from "@/features/review/demo/GameOverDemo";
import { GAME_OVER_DEMO_BASE, GAME_OVER_DEMO_SLOTS, isGameOverDemoSlot } from "@/features/review/demo/states";
import { GalleryFrame } from "../_components/Specimen";
import { stageUser } from "../stage/demo-data";

export const metadata: Metadata = { title: "Game Over Demo", robots: { index: false, follow: false } };

type SearchParams = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/**
 * `/dev/ui/game-over` (phase-03 plan §4.10): P2's game-over card with P3's slots (WP-E), no server. Params:
 *   slot=<analysing|queued|done|clean|failed|terminal|skipped|legend|legend_followed|legend_opponent|legend_pending>
 *   state=<an over_* design state>   the P2 card underneath (default: GAME_OVER_DEMO_BASE, the game that fits the slot)
 *   chrome=none   no app shell        device=…   accepted for the device suite
 */
export default async function GameOverDemoPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const p = await searchParams;
  const slot = one(p.slot);
  if (!isGameOverDemoSlot(slot)) return <SlotIndex />;
  const requested = one(p.state);
  const fallback = GAME_OVER_DEMO_BASE[slot];
  const state = isDesignState(requested) && requested.startsWith("over_") ? requested : fallback;
  const demo = <GameOverDemo key={`${slot}:${state}`} slot={slot} state={state} />;
  if (one(p.chrome) === "none") return <ViewportStage>{demo}</ViewportStage>;
  return (
    // navFlags: the shell must not read `review-v3` from the demo viewer GameOverDemo seeds while it renders (the
    // server rendered the nav before the seed, the client after: React #418 on the production build;
    // regression: game-over-demo-hydration). The other P3 demo routes pass it the same way.
    <AppShellView user={stageUser({ payment: false, stress: false })} demo hideTabBar backTo="play" navFlags={{ "review-v3": true }}>
      {demo}
    </AppShellView>
  );
}

function SlotIndex() {
  return (
    <GalleryFrame title="Game Over Demo">
      <p className="mb-4 text-body text-cb-text-soft">P2&apos;s game-over card with P3&apos;s review slots (phase-03 plan §4.7).</p>
      <ul className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-1" data-testid="game-over-demo-index">
        {GAME_OVER_DEMO_SLOTS.map((s) => (
          <li key={s}>
            <Link className="font-mono text-label underline" href={`/dev/ui/game-over?slot=${s}`} prefetch={false}>
              {s}
            </Link>
          </li>
        ))}
      </ul>
      <p className="mt-4 text-ui text-cb-text-soft">{DESIGN_STATES.filter((s) => s.startsWith("over_")).length} over_* states can sit under any slot (state=…).</p>
    </GalleryFrame>
  );
}
