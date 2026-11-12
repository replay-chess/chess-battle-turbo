"use client";

// In-game status chips (plan 4.2 rule 4, 4.7): server restarting (V3Maintenance `in_game`), silent auth refresh
// (V3SessionExpired `in_game_refresh` → `in_game_ok`, which also holds the session-expired modal until the game
// ends), and "Update ready" for an old bundle. At the top of the panel
// (V3Maintenance `in_game`: the page's top right, over the panel; the strip under the board in stack mode), in flow:
// they never cover the board or the clocks and never take input focus.

import { useEffect, useState } from "react";
import { formatCountdown } from "@repo/game-core/clock/format";
import { restartStage } from "@repo/game-core/client/viewState";
import { holdSessionExpired } from "@/components/system/session-guard";
import { useAuthStatus, useConnection } from "@/lib/realtime/useConnection";
import { CHIPS } from "../copy";
import { useController, useGame } from "./GameContext";

function useTicker(active: boolean, ms = 250): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(id);
  }, [active, ms]);
  return now;
}

export function InGameChips() {
  const controller = useController();
  const game = useGame((g) => g);
  const restarting = game.restarting;
  const conn = useConnection();
  const auth = useAuthStatus();
  const live = controller.kind === "live";
  // The restart chip is store state, so the demo route shows it too; the auth and update chips read the tab's
  // socket and exist on live games only.
  const showRestart = controller.kind !== "local" && restarting !== null;
  // While the viewer plays a live game the "You've Been Signed Out" modal waits for the end (plan 4.7, 5.5.1): the
  // auth chip below stands in for it and the board stays usable.
  const holdModal = live && game.state.you.role === "player" && game.state.phase !== "ended";
  useEffect(() => (holdModal ? holdSessionExpired() : undefined), [holdModal]);
  const ticking = showRestart || (live && (auth.kind === "refreshing" || auth.kind === "recovered"));
  const now = useTicker(ticking);

  const chips: React.ReactNode[] = [];
  if (showRestart && restarting) {
    // The same stage the panel banner reads (ReconnectZone): once the restart has begun (socket down, game frozen or
    // the time has come) the chip drops its countdown and "Keep playing" (clocks are paused).
    const serverNow = controller.serverNow();
    const stage = restartStage(game, serverNow);
    chips.push(
      <span key="restart" className="g-chip" data-tone="warn" role="status" data-testid="chip-restarting" data-stage={stage}>
        <span className="g-spin" aria-hidden="true" />
        {stage === "announced" ? CHIPS.restarting(formatCountdown(restarting.restartAt - serverNow)) : CHIPS.restartingNow}
      </span>,
    );
  }
  if (live && auth.kind === "refreshing") {
    chips.push(
      <span key="auth" className="g-chip" data-tone="warn" role="status" data-testid="chip-auth-refresh">
        <span className="g-spin" aria-hidden="true" />
        {CHIPS.authRefreshing(formatCountdown(auth.retryAt - now))}
      </span>,
    );
  } else if (live && auth.kind === "recovered" && auth.until > now) {
    chips.push(
      <span key="auth-ok" className="g-chip" data-tone="good" role="status" data-testid="chip-auth-ok">
        {CHIPS.authOk}
      </span>,
    );
  }
  if (live && conn === "upgrade_required") {
    chips.push(
      <span key="upgrade" className="g-chip" role="status" data-testid="chip-upgrade">
        {CHIPS.upgrade}
      </span>,
    );
  }
  if (!chips.length) return null;
  return <div className="g-chips">{chips}</div>;
}
