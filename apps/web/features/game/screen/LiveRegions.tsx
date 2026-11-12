"use client";

// The two screen-reader live regions of the game (P2 plan 4.4): polite for moves and the connection, assertive for
// a move that checks the viewer, ten seconds left, the opponent disconnecting and game over. Text comes from the
// pure `announce()` (features/game/announce.ts) on every store change. Both regions are always in the DOM (a live
// region added together with its text is often not read); each message empties again after LIVE_HOLD_MS
// (features/game/liveText.ts), so no stale text stays behind.

import { useEffect, useState } from "react";
import { announce, LOW_TIME_ANNOUNCEMENT } from "../announce";
import { useLowTimeAlert } from "../clock/useLowTimeAlert";
import { createLiveText } from "../liveText";
import { useController } from "./GameContext";

export function LiveRegions() {
  const controller = useController();
  const [polite, setPolite] = useState("");
  const [assertive, setAssertive] = useState("");
  const [regions] = useState(() => ({ polite: createLiveText(setPolite), assertive: createLiveText(setAssertive) }));

  useEffect(() => {
    const unsubscribe = controller.store.subscribe((next, prev) => {
      const a = announce(prev, next, controller.serverNow());
      if (a.polite) regions.polite.say(a.polite);
      if (a.assertive) regions.assertive.say(a.assertive);
    });
    return () => {
      unsubscribe();
      regions.polite.dispose();
      regions.assertive.dispose();
    };
  }, [controller, regions]);

  useLowTimeAlert(() => regions.assertive.say(LOW_TIME_ANNOUNCEMENT));

  return (
    <>
      <div className="sr-only" aria-live="polite" aria-atomic="true" data-testid="game-live-polite">
        {polite}
      </div>
      <div className="sr-only" aria-live="assertive" aria-atomic="true" data-testid="game-live-assertive">
        {assertive}
      </div>
    </>
  );
}
