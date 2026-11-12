// The game under each /dev/ui/game-over slot (phase-03 plan §4.10): P2's demo game for the design state, except the
// legend slots that left Morphy's line, which are P3's own games from his position (game-over-games.ts, FIX-2).
import type { DesignState } from "@repo/game-core/client/viewState";
import { buildDemoFixture, type DemoFixture } from "@/features/game/demo/fixtures";
import { legendDrawGame, legendOpponentLeftGame } from "./game-over-games";
import type { GameOverDemoSlot } from "./states";

export function gameOverDemoFixture(slot: GameOverDemoSlot, state: DesignState): DemoFixture {
  if (slot === "legend" || slot === "legend_pending") return legendDrawGame();
  if (slot === "legend_opponent") return legendOpponentLeftGame();
  return buildDemoFixture({ state, side: null, mode: "live", variant: null, stress: false });
}
