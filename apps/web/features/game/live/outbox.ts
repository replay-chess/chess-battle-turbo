// The outbox (P2 plan 5.2.4): at most one own move waits while the socket is not live; it is shown as a ghost and
// sent on rejoin when it is still legal and still the player's turn, else dropped with the `rejected` toast. The
// queue itself lives in the game-core client reducer (`ClientGame.outbox`, flushed by the `join` replace); this
// module holds the client-side pieces around it.

import type { ClientGame } from "@repo/game-core/client/reducer";
import { RELOAD_BUTTON_AFTER_MS } from "@repo/game-core/constants";

export { nextClientMoveId } from "../store";

/** SAN of the queued move for the "Bxd7+ is queued and will be sent when you're back." copy. */
export function queuedSan(g: ClientGame): string | null {
  return g.outbox?.san ?? null;
}

/** "Reload game" shows 25 s after the connection dropped (client-data-layer 5.1). */
export function reloadVisible(g: ClientGame, now: number): boolean {
  return g.disconnectedAt !== null && now - g.disconnectedAt >= RELOAD_BUTTON_AFTER_MS;
}
