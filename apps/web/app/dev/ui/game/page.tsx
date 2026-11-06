import type { Metadata } from "next";
import Link from "next/link";
import { ViewportStage } from "@/components/layout/ViewportStage";
import { AppShellView } from "@/components/shell/AppShellView";
import { GameDemo, type GameDemoProps } from "@/features/game/demo/GameDemo";
import { DEMO_VARIANTS, DESIGN_STATES, isDesignState, type DemoVariant } from "@/features/game/demo/fixtures";
import { GalleryFrame } from "../_components/Specimen";
import { stageUser } from "../stage/demo-data";

export const metadata: Metadata = { title: "Game Demo", robots: { index: false, follow: false } };

type SearchParams = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/**
 * `/dev/ui/game` (P2 plan 4.9): the real game screen in any of the 55 design states, with no server. Fails closed
 * outside dev/test (app/dev/layout.tsx). Params:
 *   state=<one of the 55>   (no state: the index of all states)
 *   side=w|b                the other seat when it reaches the same state
 *   mode=live|bot|spectate  spectate = the spectator's store; bot = the same position as a bot game
 *   variant=restart|engine_error|other_tab
 *   stress=1                120 plies, 20-character names, three-digit move numbers, the longest header
 *   flip=1                  board flipped     freeze=1   the server clock stands still
 *   toasts=auto             toasts clear after 4 s (default: they stay, so toast-led states stay put)
 *   chrome=none             no app shell      debug=1    state / zone / actions / board-size readout
 *   device=auto             accepted for the device suite; the viewport decides the layout
 */
export default async function GameDemoPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const p = await searchParams;
  const stateParam = one(p.state);
  const stress = one(p.stress) === "1";
  if (!isDesignState(stateParam) && !stress) return <StateIndex />;

  const state = isDesignState(stateParam) ? stateParam : "your_move";
  const sideParam = one(p.side);
  const modeParam = one(p.mode);
  const variantParam = one(p.variant);
  const props: GameDemoProps = {
    state,
    side: sideParam === "w" || sideParam === "b" ? sideParam : null,
    mode: modeParam === "bot" || modeParam === "spectate" ? modeParam : "live",
    variant: (DEMO_VARIANTS as readonly string[]).includes(variantParam ?? "") ? (variantParam as DemoVariant) : null,
    stress,
    flip: one(p.flip) === "1",
    freeze: one(p.freeze) === "1",
    toasts: one(p.toasts) === "auto" ? "auto" : "hold",
    debug: one(p.debug) === "1",
  };
  // A new key per parameter set: client-side navigation between states rebuilds the fixture and the controller.
  const key = JSON.stringify(props);
  const demo = <GameDemo key={key} {...props} />;
  if (one(p.chrome) === "none") return <ViewportStage>{demo}</ViewportStage>;
  return (
    <AppShellView user={stageUser({ payment: false, stress: false })} demo hideTabBar backTo="play">
      {demo}
    </AppShellView>
  );
}

function StateIndex() {
  return (
    <GalleryFrame title="Game Demo">
      <p className="mb-4 text-body text-cb-text-soft">
        The game screen in each of the 55 design states (P2 plan 4.3). Add <code>debug=1</code> for the state readout.
      </p>
      <ul className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-1" data-testid="game-demo-index">
        {DESIGN_STATES.map((s) => (
          <li key={s}>
            <Link className="font-mono text-label underline" href={`/dev/ui/game?state=${s}`} prefetch={false}>
              {s}
            </Link>
          </li>
        ))}
        <li>
          <Link className="font-mono text-label underline" href="/dev/ui/game?stress=1" prefetch={false}>
            stress=1
          </Link>
        </li>
      </ul>
    </GalleryFrame>
  );
}
