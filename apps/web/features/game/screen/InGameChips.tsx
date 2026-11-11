"use client";

// In-game status chips (plan 4.2 rule 4, 4.7): server restarting (V3Maintenance `in_game`), silent auth refresh
// (V3SessionExpired `in_game_refresh` → `in_game_ok`), and "Update ready" for an old bundle. Top right of the board
// region, z 20; they never take input focus and never cover the clocks.

import { useEffect, useState } from "react";
import { formatCountdown } from "@repo/game-core/clock/format";
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
  const restarting = useGame((g) => g.restarting);
  const conn = useConnection();
  const auth = useAuthStatus();
  const live = controller.kind === "live";
  // The restart chip is store state, so the demo route shows it too; the auth and update chips read the tab's
  // socket and exist on live games only.
  const showRestart = controller.kind !== "local" && restarting !== null;
  const ticking = showRestart || (live && (auth.kind === "refreshing" || auth.kind === "recovered"));
  const now = useTicker(ticking);

  const chips: React.ReactNode[] = [];
  if (showRestart && restarting) {
    const left = restarting.restartAt - controller.serverNow();
    chips.push(
      <span key="restart" className="g-chip" data-tone="warn" role="status" data-testid="chip-restarting">
        <span className="g-spin" aria-hidden="true" />
        {left > 0 ? CHIPS.restarting(formatCountdown(left)) : CHIPS.restartingNow}
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
